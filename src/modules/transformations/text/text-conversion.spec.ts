import { parse as parseYaml } from 'yaml';

import {
  convertText,
  decodeUtf8,
  sniffFormat,
  TextConversionError,
  type TextFormat,
} from './text-conversion';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const SAMPLES: Record<TextFormat, string> = {
  csv: 'name,age\r\nAda,36\r\nAlan,41\r\n',
  json: '[{"name":"Ada","age":"36"},{"name":"Alan","age":"41"}]',
  xml: '<?xml version="1.0"?><people><person><name>Ada</name><age>36</age></person><person><name>Alan</name><age>41</age></person></people>',
  yaml: '- name: Ada\n  age: "36"\n- name: Alan\n  age: "41"\n',
};

function failure(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof TextConversionError) return error.code;
    throw error;
  }
  return undefined;
}

describe('text conversion (docs/conversion-rules.md)', () => {
  const formats: TextFormat[] = ['csv', 'json', 'xml', 'yaml'];

  it.each(
    formats.flatMap((source) =>
      formats
        .filter((target) => target !== source)
        .map((target) => [source, target] as const),
    ),
  )('%s → %s keeps the rows', (source, target) => {
    const output = convertText(enc(SAMPLES[source]), source, target);

    expect(output).toContain('Ada');
    expect(output).toContain('Alan');
    expect(output).toContain('41');
    // The output parses back as its own format.
    expect(() => convertText(enc(output), target, 'json')).not.toThrow();
  });

  it('CSV → JSON: an array of objects keyed by the header, values as strings', () => {
    expect(JSON.parse(convertText(enc(SAMPLES.csv), 'csv', 'json'))).toEqual([
      { age: '36', name: 'Ada' },
      { age: '41', name: 'Alan' },
    ]);
  });

  it('JSON → CSV: nested objects become dot columns, arrays JSON text, columns in first-seen order', () => {
    const csv = convertText(
      enc(
        '[{"id":1,"user":{"name":"Ada"},"tags":["a","b"]},{"id":2,"extra":true}]',
      ),
      'json',
      'csv',
    );

    expect(csv.split('\r\n')).toEqual([
      'id,user.name,tags,extra',
      '1,Ada,"[""a"",""b""]",',
      '2,,,true',
      '',
    ]);
  });

  it('XML → JSON: attributes as @name, text with attributes as #text, repeats as arrays', () => {
    const json = JSON.parse(
      convertText(
        enc('<root><item id="1">A &amp; B</item><item id="2">C</item></root>'),
        'xml',
        'json',
      ),
    ) as unknown;

    expect(json).toEqual({
      root: {
        item: [
          { '#text': 'A & B', '@id': '1' },
          { '#text': 'C', '@id': '2' },
        ],
      },
    });
  });

  it('JSON → XML: one key is the root, anything else is wrapped in <root>, arrays repeat', () => {
    expect(convertText(enc('{"a":{"b":[1,2]}}'), 'json', 'xml')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<a>\n  <b>1</b>\n  <b>2</b>\n</a>\n',
    );
    expect(convertText(enc('[1,2]'), 'json', 'xml')).toContain('<root>');
    expect(convertText(enc('{"1bad key":"x"}'), 'json', 'xml')).toContain(
      '<_1bad_key>x</_1bad_key>',
    );
  });

  it('YAML ↔ JSON keeps types', () => {
    const yaml = convertText(
      enc('{"n":1,"b":true,"x":null,"s":"1"}'),
      'json',
      'yaml',
    );

    expect(parseYaml(yaml)).toEqual({ b: true, n: 1, s: '1', x: null });
  });

  it('refuses a DTD, so no external entity or entity expansion is possible', () => {
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    const lol =
      '<!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><l>&b;</l>';

    expect(failure(() => convertText(enc(xxe), 'xml', 'json'))).toBe(
      'FILE_PARSE_ERROR',
    );
    expect(failure(() => convertText(enc(lol), 'xml', 'json'))).toBe(
      'FILE_PARSE_ERROR',
    );
  });

  it('caps YAML aliases (billion laughs) and refuses several documents', () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    ].join('\n');

    expect(failure(() => convertText(enc(bomb), 'yaml', 'json'))).toBe(
      'FILE_PARSE_ERROR',
    );
    expect(
      failure(() => convertText(enc('a: 1\n---\nb: 2\n'), 'yaml', 'json')),
    ).toBe('FILE_PARSE_ERROR');
  });

  it('refuses structures that are too deep', () => {
    const deep = `${'['.repeat(100)}${']'.repeat(100)}`;

    expect(failure(() => convertText(enc(deep), 'json', 'yaml'))).toBe(
      'STRUCTURE_TOO_COMPLEX',
    );
  });

  it('reports syntax errors per format', () => {
    expect(failure(() => convertText(enc('{"a":'), 'json', 'csv'))).toBe(
      'FILE_PARSE_ERROR',
    );
    expect(failure(() => convertText(enc('<a><b></a>'), 'xml', 'csv'))).toBe(
      'FILE_PARSE_ERROR',
    );
    expect(failure(() => convertText(enc('a,b\n1,2,3\n'), 'csv', 'json'))).toBe(
      'FILE_PARSE_ERROR',
    );
    expect(failure(() => convertText(enc('a,a\n1,2\n'), 'csv', 'json'))).toBe(
      'FILE_PARSE_ERROR',
    );
    expect(failure(() => convertText(enc('a: [1, 2'), 'yaml', 'json'))).toBe(
      'FILE_PARSE_ERROR',
    );
  });

  it('accepts UTF-8 with or without a BOM, refuses UTF-16 and invalid bytes, and empty input', () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    expect(convertText(enc('﻿[{"ü":"ß"}]'), 'json', 'csv')).toContain('ü');
    expect(
      failure(() => decodeUtf8(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))),
    ).toBe('FILE_ENCODING_INVALID');
    expect(failure(() => decodeUtf8(new Uint8Array([0x61, 0xc3, 0x28])))).toBe(
      'FILE_ENCODING_INVALID',
    );
    expect(failure(() => decodeUtf8(enc('  \n ')))).toBe('FILE_EMPTY');
  });

  it('tells XML and JSON apart by content; CSV and YAML need their extension', () => {
    expect(sniffFormat(' <a/>')).toBe('xml');
    expect(sniffFormat('\n[1]')).toBe('json');
    expect(sniffFormat('a,b')).toBeUndefined();
    expect(sniffFormat('a: 1')).toBeUndefined();
  });

  describe('resource limits', () => {
    it('refuses a CSV that would be a quadratic table (many distinct keys)', () => {
      const rows = Array.from(
        { length: 20_000 },
        (_, i) => `{"k${String(i)}":1}`,
      );

      expect(
        failure(() => convertText(enc(`[${rows.join(',')}]`), 'json', 'csv')),
      ).toBe('STRUCTURE_TOO_COMPLEX');
    });

    it('counts YAML aliases as expanded, so a small file cannot amplify', () => {
      const big = 'x'.repeat(1_000_000);
      const yaml = [
        `a: &a "${big}"`,
        ...Array.from({ length: 60 }, (_, i) => `k${String(i)}: *a`),
      ].join('\n');

      expect(failure(() => convertText(enc(yaml), 'yaml', 'json'))).toBe(
        'STRUCTURE_TOO_COMPLEX',
      );
    });

    it('maps very deep XML nesting to STRUCTURE_TOO_COMPLEX, not a crash', () => {
      const deep = `${'<a>'.repeat(200)}x${'</a>'.repeat(200)}`;

      expect(failure(() => convertText(enc(deep), 'xml', 'json'))).toBe(
        'STRUCTURE_TOO_COMPLEX',
      );
    });
  });

  describe('XML entities and names', () => {
    it('decodes numeric references and refuses unknown entities', () => {
      const json = JSON.parse(
        convertText(enc('<r a="&#60;">&#65;&#x42;&amp;</r>'), 'xml', 'json'),
      ) as unknown;

      expect(json).toEqual({ r: { '#text': 'AB&', '@a': '<' } });
      expect(
        failure(() => convertText(enc('<r>&nbsp;</r>'), 'xml', 'json')),
      ).toBe('FILE_PARSE_ERROR');
    });

    it('allows a literal & in CDATA and comments, refuses invalid character references', () => {
      const json = JSON.parse(
        convertText(
          enc('<r><!-- a & b --><u><![CDATA[x?a=1&b=2]]></u></r>'),
          'xml',
          'json',
        ),
      ) as unknown;

      expect(json).toEqual({ r: { u: 'x?a=1&b=2' } });
      expect(
        JSON.parse(convertText(enc('<?pi a&b?><r>x</r>'), 'xml', 'json')),
      ).toEqual({ r: 'x' });
      for (const reference of ['&#0;', '&#xD800;', '&#xFFFF;']) {
        expect(
          failure(() => convertText(enc(`<r>${reference}</r>`), 'xml', 'json')),
        ).toBe('FILE_PARSE_ERROR');
      }
    });

    it('refuses element names that are JavaScript internals with a 4xx code', () => {
      for (const name of ['constructor', 'prototype', '__proto__']) {
        expect(
          failure(() =>
            convertText(enc(`<r><${name}>1</${name}></r>`), 'xml', 'json'),
          ),
        ).toBe('FILE_PARSE_ERROR');
      }
    });

    it('always writes a root element and valid names, keeps __proto__ and colliding keys', () => {
      const attributeOnly = convertText(enc('{"@id":"1"}'), 'json', 'xml');
      const spaced = convertText(enc('{"x":{"@a b":"v"}}'), 'json', 'xml');
      const proto = convertText(
        enc('{"r":{"__proto__":{"p":"1"}}}'),
        'json',
        'xml',
      );
      const collide = convertText(
        enc('{"r":{"_x_y":1,"x y":2}}'),
        'json',
        'xml',
      );

      expect(attributeOnly).toContain('<root id="1"');
      expect(spaced).toContain('<x _a_b="v"');
      expect(proto).toContain('<__proto__>');
      expect(collide).toContain('<_x_y>1</_x_y>');
      expect(collide).toContain('<_x_y_2>2</_x_y_2>');
    });

    it('replaces characters XML 1.0 cannot carry', () => {
      const control = String.fromCharCode(1);
      const xml = convertText(
        enc(JSON.stringify({ a: `x${control}y` })),
        'json',
        'xml',
      );

      expect(xml).not.toContain(control);
      expect(xml).toContain(`x${String.fromCharCode(0xfffd)}y`);
    });
  });

  it('neutralises spreadsheet formulas in CSV cells, but not negative numbers', () => {
    const csv = convertText(
      enc(
        '[{"a":"=HYPERLINK(1)","b":"+1","c":"@x","d":"-5","e":"-x","f":"ok"}]',
      ),
      'json',
      'csv',
    );

    expect(csv.split('\r\n')[1]).toBe(`'=HYPERLINK(1),'+1,'@x,-5,'-x,ok`);
  });

  it('keeps __proto__ and constructor as data from JSON and YAML, polluting nothing', () => {
    const json = convertText(
      enc('{"__proto__":{"polluted":"yes"},"constructor":"c"}'),
      'json',
      'yaml',
    );
    const yaml = convertText(
      enc('__proto__:\n  polluted: yes\n'),
      'yaml',
      'json',
    );

    expect(json).toContain('__proto__');
    expect(yaml).toContain('__proto__');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
