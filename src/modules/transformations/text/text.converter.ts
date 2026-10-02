import { extname } from 'node:path';

import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';

import { Converter } from '../converter';
import { sniffFormat, type TextFormat } from './text-conversion';
import { TextConversionPool } from './text-conversion.pool';

const FORMATS = ['csv', 'json', 'xml', 'yaml'] as const;

const EXTENSIONS: Readonly<Record<string, TextFormat>> = {
  '.csv': 'csv',
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const MIME: Readonly<Record<TextFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yaml: 'application/yaml; charset=utf-8',
};

const others = (format: TextFormat): TextFormat[] =>
  FORMATS.filter((other) => other !== format);

// Notion "Трансформация текстовых форматов": CSV, JSON, XML, YAML, all 12 directions.
@Injectable()
export class TextConverter extends Converter<TextFormat> {
  readonly formats = FORMATS;
  readonly type = 'file' as const;
  protected readonly pairs = {
    csv: others('csv'),
    json: others('json'),
    xml: others('xml'),
    yaml: others('yaml'),
  };

  constructor(private readonly pool: TextConversionPool) {
    super();
  }

  async convert(
    input: Buffer,
    source: TextFormat,
    target: TextFormat,
  ): Promise<Buffer> {
    const result = await this.pool.run(input, source, target);
    if (!(result instanceof Uint8Array)) {
      throw new AppException(ErrorCode[result.code], HttpStatus.BAD_REQUEST, {
        format: source,
      });
    }
    // A view on the moved bytes: no copy.
    return Buffer.from(result.buffer, result.byteOffset, result.byteLength);
  }

  // The extension decides when it names a text format (the content must then parse as it);
  // otherwise the content tells XML and JSON apart. CSV and YAML need their extension
  // (docs/conversion-rules.md).
  detect(input: Buffer, filename: string | undefined): TextFormat | undefined {
    const byName = filename
      ? EXTENSIONS[extname(filename).toLowerCase()]
      : undefined;
    if (byName) return byName;
    // trimStart() in sniffFormat also drops a BOM (U+FEFF is whitespace to JavaScript).
    const head = new TextDecoder('utf-8').decode(input.subarray(0, 1024));
    return sniffFormat(head);
  }

  extensionOf(format: TextFormat): string {
    return format;
  }

  mimeOf(format: TextFormat): string {
    return MIME[format];
  }
}
