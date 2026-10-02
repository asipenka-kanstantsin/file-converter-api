import { sanitizeSvg, UnsafeSvgError } from './svg-sanitizer';

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

function reason(svg: string): string | undefined {
  try {
    sanitizeSvg(Buffer.from(svg));
  } catch (error: unknown) {
    if (error instanceof UnsafeSvgError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('sanitizeSvg (decision F11)', () => {
  it('keeps shapes, gradients, fragment references and text, re-serialised', () => {
    const out = sanitizeSvg(
      Buffer.from(
        `<?xml version="1.0"?><!-- c & d --><svg ${NS} width="4" height="4"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient><rect id="r" width="1" height="1"/></defs><use href="#r"/><use xlink:href="#r"/><rect width="4" height="4" fill="url(#g)"/><text>a &amp; b &#60;</text></svg>`,
      ),
    ).toString('utf8');

    expect(out.startsWith('<svg')).toBe(true);
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('a &amp; b &lt;');
    expect(out).not.toContain('c & d');
  });

  // Every payload the review found getting past a raw-text check (decoded by libxml2 or the CSS
  // parser only after it), plus the obvious ones.
  it.each([
    [
      'entity-encoded url()',
      `<rect width="1" height="1" fill="url&#40;data:image/svg+xml;base64,AA#p)"/>`,
    ],
    [
      'hex-entity url()',
      `<rect width="1" height="1" fill="url&#x28;data:x)"/>`,
    ],
    [
      'entity inside the word',
      `<rect width="1" height="1" fill="u&#x72;l(data:x)"/>`,
    ],
    ['a style attribute', `<rect width="1" height="1" style="fill:red"/>`],
    [
      'a style element with a CSS escape',
      `<style>rect{fill:u\\72l(data:x)}</style>`,
    ],
    [
      'a style element with an escaped @import',
      `<style>@\\69mport "data:text/css,x";</style>`,
    ],
    [
      'an image with a data: URI',
      `<image href="data:image/png;base64,AA" width="1" height="1"/>`,
    ],
    ['a use of another file', `<use href="other.svg#x"/>`],
    ['an absolute reference', `<use xlink:href="http://evil.example/#x"/>`],
    ['a script', `<script>alert(1)</script>`],
    ['an event handler', `<rect width="1" height="1" onload="alert(1)"/>`],
    ['foreignObject', `<foreignObject width="1" height="1"/>`],
    [
      'a filter (unbounded render time)',
      `<filter id="f"><feGaussianBlur stdDeviation="200"/></filter>`,
    ],
    ['xml:base', `<g xml:base="http://evil.example/"/>`],
    // CSS escapes in presentation attributes (librsvg decodes them as CSS).
    [
      'a CSS-escaped url() in fill',
      `<rect width="1" height="1" fill="\\75rl(data:image/svg+xml;base64,AA#p)"/>`,
    ],
    [
      'a CSS escape inside the word',
      `<rect width="1" height="1" fill="u\\72l(data:x)"/>`,
    ],
    [
      'an entity-encoded backslash',
      `<rect width="1" height="1" fill="&#92;75rl(data:x)"/>`,
    ],
    [
      'a CSS-escaped url() in mask',
      `<rect width="1" height="1" mask="\\75rl(data:x)"/>`,
    ],
    [
      'a function call in a paint',
      `<rect width="1" height="1" fill="image(data:x)"/>`,
    ],
    ['a non-transform in transform', `<g transform="url(data:x)"/>`],
    ['a padded reference', `<use href=" #a"/>`],
    ['an animation', `<animate attributeName="x" to="1"/>`],
  ])('refuses %s', (_label, inner) => {
    expect(
      reason(`<svg ${NS} width="4" height="4">${inner}</svg>`),
    ).toBeDefined();
  });

  it('rejects pathological values fast (no catastrophic backtracking)', () => {
    const spaces = ' '.repeat(5);
    const transform = `scale(1)${`${spaces}scale(1)`.repeat(40)} x`;
    const colour = `rgb(${' '.repeat(50_000)}x`;
    const started = Date.now();

    expect(reason(`<svg ${NS}><g transform="${transform}"/></svg>`)).toBe(
      'transform',
    );
    expect(reason(`<svg ${NS}><rect fill="${colour}"/></svg>`)).toBe(
      'value_too_long',
    );
    expect(reason(`<svg ${NS}><rect fill="${'r'.repeat(9_000)}"/></svg>`)).toBe(
      'value_too_long',
    );
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('accepts the legitimate forms of parentheses', () => {
    expect(
      reason(
        `<svg ${NS} width="4" height="4"><defs><linearGradient id="g" gradientTransform="rotate(45) scale(1.5, 2)"/></defs><g transform="translate(1,2) matrix(1 0 0 1 0 0)"><rect width="1" height="1" fill="url(#g) red" stroke="rgb(10, 20, 30)"/><rect width="1" height="1" fill="rgba(0,0,0,0.5)" clip-path="url(#g)"/></g></svg>`,
      ),
    ).toBeUndefined();
  });

  it('refuses a DTD, unknown entities, other roots and too many elements', () => {
    expect(reason(`<!DOCTYPE svg [<!ENTITY x "y">]><svg ${NS}/>`)).toBe('dtd');
    expect(reason(`<svg ${NS}><text>&nbsp;</text></svg>`)).toBe('entity');
    expect(reason(`<html><svg ${NS}/></html>`)).toBe('root');
    expect(reason(`<svg ${NS}>${'<g/>'.repeat(20_001)}</svg>`)).toBe(
      'too_many_elements',
    );
  });

  it('reports malformed XML and non-UTF-8 as such, not as unsafe', () => {
    expect(reason(`<svg ${NS}><g></svg>`)).toBe('xml');
    expect(
      (() => {
        try {
          sanitizeSvg(Buffer.from([0x3c, 0x73, 0xff]));
        } catch (error: unknown) {
          return (error as UnsafeSvgError).reason;
        }
        return undefined;
      })(),
    ).toBe('encoding');
  });
});
