// Exports the Notion training spec (root page + every sub-page) to docs/requirements/ as Markdown.
// Uses Notion's public page API, so it works for pages shared by link without an integration token.
// The output is confidential (Innowise only) and git-ignored; re-run it before every task.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT_PAGE_ID = '3c6e8aa9-1a77-8094-a0fc-f6a05c046297';
const API = 'https://www.notion.so/api/v3/';
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'docs', 'requirements');

const blocks = new Map();

async function post(endpoint, body) {
  const response = await fetch(API + endpoint, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (requirements-export)',
    },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`${endpoint} → HTTP ${response.status}`);
  return response.json();
}

function unwrap(record) {
  let value = record?.value ?? record;
  while (
    value &&
    typeof value === 'object' &&
    value.value &&
    typeof value.value === 'object' &&
    !value.type
  ) {
    value = value.value;
  }
  return value;
}

function store(recordMap) {
  for (const [id, record] of Object.entries(recordMap?.block ?? {}))
    blocks.set(id, unwrap(record));
}

async function loadPage(pageId) {
  let cursor = { stack: [] };
  for (let chunkNumber = 0; ; chunkNumber++) {
    const result = await post('loadPageChunk', {
      chunkNumber,
      cursor,
      limit: 100,
      pageId,
      verticalColumns: false,
    });
    store(result.recordMap);
    cursor = result.cursor;
    if (!cursor?.stack?.length) return;
  }
}

async function loadMissing(ids) {
  const missing = ids.filter((id) => !blocks.has(id));
  if (missing.length === 0) return;
  const result = await post('syncRecordValues', {
    requests: missing.map((id) => ({
      pointer: { id, table: 'block' },
      version: -1,
    })),
  });
  store(result.recordMap);
}

function richText(segments = []) {
  return segments
    .map(([text, formats = []]) => {
      let out = text;
      for (const [kind, arg] of formats) {
        if (kind === 'a') out = `[${out}](${arg})`;
        else if (kind === 'c') out = `\`${out}\``;
        else if (kind === 'b') out = `**${out}**`;
        else if (kind === 'lm' && arg?.href)
          out = `[${arg.title ?? arg.href}](${arg.href})`;
        else if (kind === 'eoi')
          out = '[embedded external object — ask the mentor for the link]';
      }
      return out;
    })
    .join('');
}

const PREFIX = {
  bulleted_list: '- ',
  callout: '> ',
  header: '# ',
  numbered_list: '1. ',
  quote: '> ',
  sub_header: '## ',
  sub_sub_header: '### ',
  to_do: '- [ ] ',
  toggle: '- ',
};

function slug(title) {
  return (
    title
      .replace(/\*/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'page'
  );
}

async function render(blockId, depth, rootId, lines, subPages) {
  await loadMissing([blockId]);
  const block = blocks.get(blockId);
  if (!block) return;
  const props = block.properties ?? {};
  const title = richText(props.title);
  const indent = '  '.repeat(depth);

  if (block.type === 'page' && blockId !== rootId) {
    subPages.push(blockId);
    lines.push(
      `${indent}- 📄 [${title.replace(/\*/g, '')}](${slug(title)}.md)`,
    );
    return;
  }
  if (block.type === 'code') {
    lines.push(
      `${indent}\`\`\`${richText(props.language).toLowerCase()}`,
      title,
      `${indent}\`\`\``,
    );
  } else if (block.type === 'divider') {
    lines.push('---');
  } else if (block.type === 'table_row') {
    const table = blocks.get(block.parent_id);
    const order = table?.format?.table_block_column_order ?? Object.keys(props);
    lines.push(
      `${indent}| ${order.map((key) => richText(props[key])).join(' | ')} |`,
    );
  } else if (
    ['bookmark', 'embed', 'file', 'image', 'pdf', 'video'].includes(block.type)
  ) {
    lines.push(
      `${indent}[${block.type}] ${richText(props.link) || richText(props.source)} ${title}`,
    );
  } else if (
    block.type !== 'page' &&
    !['column', 'column_list', 'table'].includes(block.type)
  ) {
    const prefix = PREFIX[block.type] ?? '';
    lines.push(title || prefix ? `${indent}${prefix}${title}` : '');
  }

  const children = block.content ?? [];
  await loadMissing(children);
  const nested = ['column', 'column_list', 'page', 'table'].includes(block.type)
    ? depth
    : depth + 1;
  for (const child of children)
    await render(child, nested, rootId, lines, subPages);
}

async function main() {
  await rm(OUT_DIR, { force: true, recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  const queue = [ROOT_PAGE_ID];
  const index = [];
  const seen = new Set();
  while (queue.length > 0) {
    const pageId = queue.shift();
    if (seen.has(pageId)) continue;
    seen.add(pageId);
    await loadPage(pageId);
    const page = blocks.get(pageId);
    const title = richText(page.properties?.title).replace(/\*/g, '');
    const lines = [];
    const subPages = [];
    await render(pageId, 0, pageId, lines, subPages);
    const file = pageId === ROOT_PAGE_ID ? 'INDEX.md' : `${slug(title)}.md`;
    const edited = new Date(page.last_edited_time).toISOString();
    const header = `<!-- notion page ${pageId} · version ${page.version} · last edited ${edited} -->\n# ${title}\n\n`;
    await writeFile(
      path.join(OUT_DIR, file),
      header + lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n',
    );
    index.push(`${file}\t${page.version}\t${edited}\t${title}`);
    queue.push(...subPages);
  }
  await writeFile(
    path.join(OUT_DIR, 'VERSIONS.tsv'),
    `file\tversion\tlast_edited\ttitle\n${index.join('\n')}\n`,
  );
  console.log(
    `Exported ${index.length} pages to ${path.relative(process.cwd(), OUT_DIR)}`,
  );
}

await main();
