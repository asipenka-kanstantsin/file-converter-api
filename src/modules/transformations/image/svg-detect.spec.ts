import { looksLikeSvg } from './svg-detect';

describe('looksLikeSvg', () => {
  it('finds the root after a declaration, comments, processing instructions and a DTD', () => {
    expect(looksLikeSvg('<svg xmlns="x"/>')).toBe(true);
    expect(
      looksLikeSvg(
        '﻿ <?xml version="1.0"?>\n<!-- a --><?pi x?><!DOCTYPE svg [ <!ENTITY a "b"> ]>\n<!-- -- --><SVG>',
      ),
    ).toBe(true);
    expect(
      looksLikeSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg/>'),
    ).toBe(true);
  });

  it('refuses anything else', () => {
    for (const head of [
      '<html>',
      '<svgx>',
      '<!-- open',
      '<?xml',
      '<!DOCTYPE [',
      'text',
      '',
    ]) {
      expect(looksLikeSvg(head)).toBe(false);
    }
  });

  it('stays linear on crafted heads that hang a backtracking regex', () => {
    const started = Date.now();

    expect(looksLikeSvg(`${'<!---->'.repeat(1000)}x`)).toBe(false);
    expect(looksLikeSvg('<!DOCTYPE a [ ]] >'.repeat(500))).toBe(false);
    expect(looksLikeSvg('<!--]>--><!DOCTYPE[]>'.repeat(400))).toBe(false);
    expect(looksLikeSvg(`${'<!----> '.repeat(1000)}x`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(50);
  });
});
