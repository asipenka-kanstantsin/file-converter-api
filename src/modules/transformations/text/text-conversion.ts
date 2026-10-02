import { parse as parseCsv } from 'csv-parse/sync';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import XMLBuilder from 'fast-xml-builder';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parseAllDocuments, stringify as stringifyYaml } from 'yaml';

// Pure text conversion, run inside a worker thread (decision F2). Only relative imports and
// libraries: the worker loads this file without the app's path aliases. The rules for ambiguous
// pairs are documented in docs/conversion-rules.md (decision F3).

export type TextFormat = 'csv' | 'json' | 'xml' | 'yaml';

export type TextFailure =
  | 'FILE_EMPTY'
  | 'FILE_ENCODING_INVALID'
  | 'FILE_PARSE_ERROR'
  | 'STRUCTURE_TOO_COMPLEX';

export class TextConversionError extends Error {
  constructor(
    readonly code: TextFailure,
    readonly detail?: string,
  ) {
    super(code);
  }
}

// Resource limits (Notion 1.6 "ограничение глубины/размера структуры"; "защита от ресурсных
// атак"). Counted on the parsed model, so aliases and repetition are counted as written out.
export const MAX_DEPTH = 64;
export const MAX_NODES = 5_000_000;
// Total characters of all strings and keys: bounds what aliases or entities can expand to.
export const MAX_TEXT_CHARS = 50_000_000;
// The written result; JSON/XML indentation can grow a deep input.
export const MAX_OUTPUT_CHARS = 100_000_000;
// A CSV table: distinct columns, and rows × columns cells.
export const MAX_CSV_COLUMNS = 10_000;
export const MAX_CSV_CELLS = 10_000_000;
const MAX_YAML_ALIASES = 100;

type Json = Json[] | boolean | null | number | string | { [key: string]: Json };

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

function tooComplex(detail?: string): never {
  throw new TextConversionError('STRUCTURE_TOO_COMPLEX', detail);
}

function parseError(detail: string): never {
  throw new TextConversionError('FILE_PARSE_ERROR', detail);
}

// UTF-8 only; a UTF-8 BOM is dropped (Notion 1.4 "Ошибки кодировки", 1.6 "BOM").
export function decodeUtf8(input: Uint8Array): string {
  if (
    (input[0] === 0xff && input[1] === 0xfe) ||
    (input[0] === 0xfe && input[1] === 0xff)
  ) {
    throw new TextConversionError('FILE_ENCODING_INVALID', 'utf16');
  }
  let text: string;
  try {
    text = UTF8.decode(input);
  } catch {
    throw new TextConversionError('FILE_ENCODING_INVALID', 'not_utf8');
  }
  if (text.trim().length === 0) throw new TextConversionError('FILE_EMPTY');
  return text;
}

// The first meaningful character decides between XML and JSON; CSV and YAML cannot be told
// apart by content, so they need the file's extension (docs/conversion-rules.md).
export function sniffFormat(text: string): TextFormat | undefined {
  const first = text.trimStart()[0];
  if (first === '<') return 'xml';
  if (first === '{' || first === '[') return 'json';
  return undefined;
}

function assertBounded(value: unknown): void {
  let nodes = 0;
  let chars = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [unknown, number];
    nodes += 1;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) tooComplex('size');
    if (typeof node === 'string') {
      chars += node.length;
    } else if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        chars += key.length;
        stack.push([child, depth + 1]);
      }
    }
    if (chars > MAX_TEXT_CHARS) tooComplex('text');
  }
}

// XML 1.0 defines five entities; numeric references are characters. Anything else would need a
// DTD, which is refused, so it is an error rather than literal text.
const UNKNOWN_ENTITY = /&(?!(?:lt|gt|amp|apos|quot|#\d+|#x[0-9a-fA-F]+);)/;

// XML 1.0 Char: a reference to anything else (NUL, a surrogate) makes the document invalid.
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

const XML_OPTIONS = {
  attributeNamePrefix: '@',
  // Decodes the numeric references too; any other entity was refused above.
  htmlEntities: true,
  ignoreAttributes: false,
  // Processing instructions are not data.
  ignorePiTags: true,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  textNodeName: '#text',
  trimValues: true,
} as const;

function parseXml(text: string): Json {
  // No DTD at all: no external entities, no entity expansion (Notion 1.6 "запрет внешних
  // сущностей в XML").
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) parseError('xml_doctype');
  // CDATA, comments and processing instructions may hold a literal & (a URL); only markup and
  // text are checked.
  const markup = text
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  if (UNKNOWN_ENTITY.test(markup)) parseError('xml_entity');
  for (const match of markup.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)) {
    const reference = match[1] ?? '';
    const code = reference.startsWith('x')
      ? Number.parseInt(reference.slice(1), 16)
      : Number.parseInt(reference, 10);
    if (!isXmlChar(code)) parseError('xml_char_reference');
  }
  if (XMLValidator.validate(text) !== true) parseError('xml');
  let parsed: Record<string, Json>;
  try {
    parsed = new XMLParser(XML_OPTIONS).parse(text) as Record<string, Json>;
  } catch (error: unknown) {
    // The parser refuses element names such as `constructor` or `prototype` and very deep
    // nesting; its messages quote the content, so they are not passed on.
    if (error instanceof Error && /nested/i.test(error.message))
      tooComplex('xml_depth');
    parseError('xml_reserved_name');
  }
  // The XML declaration is not data.
  delete parsed['?xml'];
  return parsed;
}

function parseText(text: string, format: TextFormat): Json {
  switch (format) {
    case 'csv': {
      try {
        return parseCsv(text, {
          bom: true,
          columns: (header: string[]) => {
            if (header.some((name) => name.trim() === '')) {
              parseError('empty_header');
            }
            if (new Set(header).size !== header.length) {
              parseError('duplicate_header');
            }
            if (header.length > MAX_CSV_COLUMNS) tooComplex('csv_columns');
            return header;
          },
          max_record_size: 1_000_000,
          skip_empty_lines: true,
        });
      } catch (error: unknown) {
        if (error instanceof TextConversionError) throw error;
        return parseError('csv');
      }
    }
    case 'json': {
      try {
        return JSON.parse(text) as Json;
      } catch (error: unknown) {
        if (error instanceof RangeError) tooComplex('json_depth');
        return parseError('json');
      }
    }
    case 'xml':
      return parseXml(text);
    case 'yaml': {
      let documents: ReturnType<typeof parseAllDocuments>;
      try {
        documents = parseAllDocuments(text, { uniqueKeys: true });
      } catch {
        parseError('yaml');
      }
      if (!Array.isArray(documents) || documents.length !== 1) {
        parseError('yaml_documents');
      }
      const [document] = documents;
      if (!document || document.errors.length > 0) parseError('yaml');
      try {
        // Core schema: plain data only, no custom tags; aliases capped against "billion laughs"
        // (and their expanded size is bounded by assertBounded).
        return document.toJS({ maxAliasCount: MAX_YAML_ALIASES }) as Json;
      } catch {
        parseError('yaml');
      }
    }
  }
}

// --- serialisation ------------------------------------------------------------------------------

function isRecord(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// A table needs rows: single-key wrappers (an XML root, `{ "users": [...] }`) are unwrapped
// until an array or a multi-key object is reached.
function rowsOf(value: Json): Json[] {
  let current = value;
  while (isRecord(current)) {
    const keys = Object.keys(current);
    if (keys.length !== 1) break;
    const inner = current[keys[0] as string] as Json;
    if (!Array.isArray(inner) && !isRecord(inner)) break;
    current = inner;
  }
  if (Array.isArray(current)) return current;
  return [current];
}

// Spreadsheets run a cell starting with = + @ (or a tab/CR, or - not starting a number) as a
// formula; such cells get a leading apostrophe (OWASP "CSV injection", Notion 1.6 sanitisation).
const FORMULA_START = /^(?:[=+@\t\r]|-(?![\d.]))/;

function cell(value: Json): string {
  if (value === null) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
}

// Nested objects become dot-separated columns; arrays inside a row become JSON text.
function flatten(value: Json, prefix: string, out: Map<string, string>): void {
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && prefix) out.set(prefix, '');
    for (const [key, child] of entries) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.set(prefix || 'value', cell(value));
}

function toCsv(value: Json): string {
  const rows: Map<string, string>[] = [];
  const columns: string[] = [];
  const seen = new Set<string>();
  // Columns are counted while reading the rows, before any table is built: a few hundred
  // kilobytes of distinct keys must not become a quadratic table.
  for (const row of rowsOf(value)) {
    const flat = new Map<string, string>();
    flatten(row, '', flat);
    for (const key of flat.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
        if (columns.length > MAX_CSV_COLUMNS) tooComplex('csv_columns');
      }
    }
    rows.push(flat);
    if (rows.length * columns.length > MAX_CSV_CELLS) tooComplex('csv_cells');
  }
  if (rows.length * columns.length > MAX_CSV_CELLS) tooComplex('csv_cells');
  if (columns.length === 0) return '';
  return stringifyCsv(
    rows.map((row) => columns.map((column) => row.get(column) ?? '')),
    { columns: columns.map(cell), header: true, record_delimiter: 'windows' },
  );
}

const XML_NAME = /^[A-Za-z_][\w.-]*$/;
// Characters XML 1.0 does not allow anywhere in a document (control characters on purpose).
const XML_INVALID_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xmlName(key: string): string {
  return XML_NAME.test(key) ? key : `_${key.replace(/[^\w.-]/g, '_')}`;
}

// Names become valid XML names (invalid characters → `_`, a leading `_`), made unique within
// their element by a numeric suffix; text loses the characters XML cannot carry (U+FFFD). Built
// on null-prototype objects, so a key such as `__proto__` stays a key.
function xmlSafe(value: Json): Json {
  if (Array.isArray(value)) return value.map(xmlSafe);
  if (typeof value === 'string')
    return value.replace(XML_INVALID_CHARS, '\uFFFD');
  if (!isRecord(value)) return value;
  const out = Object.create(null) as { [key: string]: Json };
  for (const [key, child] of Object.entries(value)) {
    let name: string;
    if (key === '#text') name = key;
    else if (key.startsWith('@')) name = `@${xmlName(key.slice(1))}`;
    else name = xmlName(key);
    let unique = name;
    for (let n = 2; unique in out; n++) unique = `${name}_${String(n)}`;
    out[unique] = xmlSafe(child);
  }
  return out;
}

// One root element: an object with exactly one element key (not an attribute, not text, not an
// array) is that root; anything else is wrapped in <root>, and a top-level array becomes repeated
// <item> elements.
function toXml(value: Json): string {
  const safe = xmlSafe(value);
  let document: Json;
  const keys = isRecord(safe) ? Object.keys(safe) : [];
  const onlyKey = keys.length === 1 ? (keys[0] as string) : undefined;
  if (
    isRecord(safe) &&
    onlyKey !== undefined &&
    !onlyKey.startsWith('@') &&
    onlyKey !== '#text' &&
    !Array.isArray(safe[onlyKey])
  ) {
    document = safe;
  } else if (Array.isArray(safe)) {
    document = { root: { item: safe } };
  } else {
    document = { root: safe };
  }
  const xml = new XMLBuilder({
    attributeNamePrefix: '@',
    format: true,
    ignoreAttributes: false,
    indentBy: '  ',
    suppressEmptyNode: true,
    textNodeName: '#text',
  }).build(document);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

function serialise(value: Json, format: TextFormat): string {
  switch (format) {
    case 'csv':
      return toCsv(value);
    case 'json':
      return `${JSON.stringify(value, null, 2)}\n`;
    case 'xml':
      return toXml(value);
    case 'yaml':
      return stringifyYaml(value, { aliasDuplicateObjects: false });
  }
}

export function convertText(
  input: Uint8Array,
  source: TextFormat,
  target: TextFormat,
): string {
  const value = parseText(decodeUtf8(input), source);
  assertBounded(value);
  const output = serialise(value, target);
  if (output.length > MAX_OUTPUT_CHARS) tooComplex('output');
  return output;
}
