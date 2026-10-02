// Notion "Общие требования к трансформации" / "Абстракции в ООП": a new kind of conversion is a new
// subclass; the shared pipeline (TransformationsService) and the endpoints' contracts do not
// change. A subclass knows its formats, how to recognise them and how to convert.
export type TransformationType = 'file' | 'image';

export interface FormatPair {
  source: string;
  target: string[];
}

export abstract class Converter<F extends string = string> {
  abstract readonly formats: readonly F[];
  abstract readonly type: TransformationType;
  protected abstract readonly pairs: Readonly<Record<F, readonly F[]>>;

  // `options` are already validated by the endpoint.
  abstract convert(
    input: Buffer,
    source: F,
    target: F,
    options: unknown,
  ): Promise<Buffer>;

  // From the content, with the file name as a hint; undefined when not one of `formats`.
  abstract detect(input: Buffer, filename: string | undefined): F | undefined;

  abstract extensionOf(format: F): string;

  abstract mimeOf(format: F): string;

  isFormat(value: string): value is F {
    return (this.formats as readonly string[]).includes(value);
  }

  supports(source: F, target: F): boolean {
    return this.pairs[source].includes(target);
  }

  // GET …/formats (Notion 1.3.2).
  listPairs(): FormatPair[] {
    return this.formats
      .filter((source) => this.pairs[source].length > 0)
      .map((source) => ({ source, target: [...this.pairs[source]] }));
  }
}
