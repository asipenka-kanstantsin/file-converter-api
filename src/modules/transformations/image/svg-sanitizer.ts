import XMLBuilder from 'fast-xml-builder';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

// SVG safety (Notion "Трансформация изображений" 1.3.1, 1.6; decision F11). The document is parsed
// (DTD refused, entities decoded the way libxml2 would), checked against an allowlist after
// decoding, and re-serialised: what librsvg renders is exactly what was checked, so no encoding
// trick (`url&#40;`, CSS escapes) can hide anything. Only relative imports: also used by the
// render child process.

export class UnsafeSvgError extends Error {
  constructor(readonly reason: string) {
    super(`unsafe svg: ${reason}`);
  }
}

// Shapes, text, structure and paint servers. No <style>, <image>, <script>, <foreignObject>,
// <a>, animation, or filter primitives (unbounded render time, F11).
const ELEMENTS: ReadonlySet<string> = new Set([
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'g',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'svg',
  'switch',
  'symbol',
  'text',
  'textPath',
  'title',
  'tspan',
  'use',
]);

const ATTRIBUTES: ReadonlySet<string> = new Set([
  'class',
  'clip-path',
  'clip-rule',
  'clipPathUnits',
  'color',
  'cx',
  'cy',
  'd',
  'direction',
  'display',
  'dominant-baseline',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'fx',
  'fy',
  'gradientTransform',
  'gradientUnits',
  'height',
  'href',
  'id',
  'lengthAdjust',
  'letter-spacing',
  'marker-end',
  'marker-mid',
  'marker-start',
  'markerHeight',
  'markerUnits',
  'markerWidth',
  'mask',
  'maskContentUnits',
  'maskUnits',
  'offset',
  'opacity',
  'orient',
  'overflow',
  'paint-order',
  'pathLength',
  'patternContentUnits',
  'patternTransform',
  'patternUnits',
  'points',
  'preserveAspectRatio',
  'r',
  'refX',
  'refY',
  'rotate',
  'rx',
  'ry',
  'shape-rendering',
  'spreadMethod',
  'startOffset',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'textLength',
  'transform',
  'version',
  'viewBox',
  'visibility',
  'width',
  'word-spacing',
  'writing-mode',
  'x',
  'x1',
  'x2',
  'xlink:href',
  'xml:lang',
  'xml:space',
  'xmlns',
  'xmlns:xlink',
  'y',
  'y1',
  'y2',
]);

// The only references allowed: to an element of the document itself.
const FRAGMENT = /^#[A-Za-z_][\w.-]*$/;
const FRAGMENT_URL = /^url\(\s*#[A-Za-z_][\w.-]*\s*\)$/;
const MAX_ELEMENTS = 20_000;
// Longer attribute values are refused, except path geometry.
const MAX_VALUE_LENGTH = 8_192;
const GEOMETRY_ATTRIBUTES: ReadonlySet<string> = new Set(['d', 'points']);

const ATTRIBUTE_PREFIX = '@_';
const PARSE_OPTIONS = {
  allowBooleanAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  // A literal & in text that is not an entity is invalid XML; numeric references are decoded.
  htmlEntities: true,
  ignoreAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: true,
  trimValues: false,
} as const;

type Node = Record<string, unknown>;

const TRANSFORM_ATTRIBUTES: ReadonlySet<string> = new Set([
  'gradientTransform',
  'patternTransform',
  'transform',
]);
// A transform list: the SVG functions with numeric arguments only.
// One transform function, matched at a position (sticky): a list is checked token by token, in
// linear time. (One regex with a repeated group and overlapping optional whitespace backtracks
// exponentially on a crafted value.)
const TRANSFORM_FUNCTION =
  /\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d.,eE+\-\s]*\)\s*,?/y;
// A colour function with numeric arguments (one character class: linear).
const COLOR_FUNCTION = /^rgba?\([\d .,%]+\)$/;
// `url(#id)`, optionally with a fallback colour (a paint).
const PAINT_REFERENCE =
  /^url\(\s*#[A-Za-z_][\w.-]*\s*\)(?:\s+(?:none|currentColor|#[0-9a-fA-F]{3,8}|[a-zA-Z]+))?$/;

// librsvg reads presentation attributes as CSS, which decodes backslash escapes after this check
// (`\75rl(` is `url(`). So a value may contain no backslash at all, and a parenthesis only in a
// transform list, a colour function or an exact `url(#id)`; references are exact `#id`.
function isTransformList(text: string): boolean {
  TRANSFORM_FUNCTION.lastIndex = 0;
  while (TRANSFORM_FUNCTION.lastIndex < text.length) {
    const start = TRANSFORM_FUNCTION.lastIndex;
    if (
      !TRANSFORM_FUNCTION.test(text) ||
      TRANSFORM_FUNCTION.lastIndex === start
    ) {
      return text.slice(start).trim() === '';
    }
  }
  return true;
}

function checkValue(attribute: string, value: string): void {
  if (value.length > MAX_VALUE_LENGTH && !GEOMETRY_ATTRIBUTES.has(attribute)) {
    throw new UnsafeSvgError('value_too_long');
  }
  if (value.includes('\\')) throw new UnsafeSvgError('escape');
  if (attribute === 'href' || attribute === 'xlink:href') {
    if (!FRAGMENT.test(value)) throw new UnsafeSvgError('reference');
    return;
  }
  if (!value.includes('(')) return;
  const text = value.trim();
  if (TRANSFORM_ATTRIBUTES.has(attribute)) {
    if (!isTransformList(text)) throw new UnsafeSvgError('transform');
    return;
  }
  if (
    FRAGMENT_URL.test(text) ||
    PAINT_REFERENCE.test(text) ||
    COLOR_FUNCTION.test(text)
  ) {
    return;
  }
  throw new UnsafeSvgError('reference');
}

function check(nodes: Node[], counter: { elements: number }): void {
  for (const node of nodes) {
    for (const [name, value] of Object.entries(node)) {
      if (name === ':@' || name === '#text') continue;
      if (name === '#comment' || name === '__cdata') continue;
      counter.elements += 1;
      if (counter.elements > MAX_ELEMENTS)
        throw new UnsafeSvgError('too_many_elements');
      if (!ELEMENTS.has(name)) throw new UnsafeSvgError(`element_${name}`);
      const attributes = (node[':@'] ?? {}) as Record<string, string>;
      for (const [rawName, attributeValue] of Object.entries(attributes)) {
        const attribute = rawName.slice(ATTRIBUTE_PREFIX.length);
        if (!ATTRIBUTES.has(attribute))
          throw new UnsafeSvgError(`attribute_${attribute}`);
        checkValue(attribute, attributeValue);
      }
      if (Array.isArray(value)) check(value as Node[], counter);
    }
  }
}

// The root <svg>, safe, as UTF-8 bytes ready to render.
export function sanitizeSvg(input: Uint8Array): Buffer {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new UnsafeSvgError('encoding');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new UnsafeSvgError('dtd');
  if (
    /&(?!(?:lt|gt|amp|apos|quot|#\d+|#x[0-9a-fA-F]+);)/.test(
      text.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, ''),
    )
  ) {
    throw new UnsafeSvgError('entity');
  }
  if (XMLValidator.validate(text) !== true) throw new UnsafeSvgError('xml');
  let tree: Node[];
  try {
    tree = new XMLParser(PARSE_OPTIONS).parse(text) as Node[];
  } catch {
    throw new UnsafeSvgError('xml');
  }
  const roots = tree.filter((node) =>
    Object.keys(node).some((key) => !key.startsWith('#') && key !== ':@'),
  );
  if (roots.length !== 1 || !('svg' in (roots[0] as Node)))
    throw new UnsafeSvgError('root');
  check(roots, { elements: 0 });
  // Comments and CDATA are dropped; text is re-escaped by the builder.
  const xml = new XMLBuilder({
    attributeNamePrefix: ATTRIBUTE_PREFIX,
    ignoreAttributes: false,
    preserveOrder: true,
    suppressEmptyNode: true,
  }).build(stripNonElements(roots));
  return Buffer.from(xml, 'utf8');
}

function stripNonElements(nodes: Node[]): Node[] {
  return nodes
    .filter((node) => !('#comment' in node) && !('__cdata' in node))
    .map((node) => {
      const out: Node = Object.create(null) as Node;
      for (const [key, value] of Object.entries(node)) {
        out[key] = Array.isArray(value)
          ? stripNonElements(value as Node[])
          : value;
      }
      return out;
    });
}
