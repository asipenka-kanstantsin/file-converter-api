import sharp from 'sharp';

import { LIBVIPS_BAD_INPUT } from './libvips-errors';
import { sanitizeSvg, UnsafeSvgError } from './svg-sanitizer';

// The whole SVG → raster conversion runs in a child process per job (decision F11): parsing and
// checking (whose cost grows with the document), reading the size, and librsvg's render, which
// renders a document in one call that no in-process timeout can interrupt. The parent kills this
// process at the timeout, so none of that work ever lands on the API's event loop or thread pool.
// Only relative imports and libraries: it runs without the app's path aliases.

export interface SvgRenderJob {
  background: string;
  height?: number;
  input: Uint8Array;
  maxHeight: number;
  maxWidth: number;
  quality: number;
  target: 'jpeg' | 'png';
  width?: number;
}

export type SvgFailure = 'FILE_PARSE_ERROR' | 'IMAGE_TOO_LARGE' | 'SVG_UNSAFE';

// `error`: an unexpected failure (memory, a libvips limit, a bug) — the parent answers 500.
export type SvgRenderResult =
  | { code: SvgFailure; context?: Record<string, number>; ok: false }
  | { error: string; ok: false }
  | { ok: true; output: Uint8Array };

// Notion 1.3.1: without an intrinsic size, a default.
const DEFAULT_SIZE = { height: 150, width: 300 };
const MAX_DENSITY = 100_000;
// librsvg rasterises `intrinsic size x density / 72`, whatever size the caller asked for, and
// density has a floor of 1. A document declaring `width="1e7"` therefore paints ~139k x 139k
// pixels for a 100 px request — only the 30 s timeout stood between that and the machine's
// memory. The surface itself is bounded here; 50 MP is three times the largest output the
// settings allow (4096 x 4096).
const MAX_RENDER_PIXELS = 50_000_000;

class Refused extends Error {
  constructor(
    readonly code: SvgFailure,
    readonly context?: Record<string, number>,
  ) {
    super(code);
  }
}

export async function render(job: SvgRenderJob): Promise<Uint8Array> {
  let svg: Buffer;
  try {
    svg = sanitizeSvg(job.input);
  } catch (error: unknown) {
    if (error instanceof UnsafeSvgError) {
      throw new Refused(
        error.reason === 'xml' || error.reason === 'encoding'
          ? 'FILE_PARSE_ERROR'
          : 'SVG_UNSAFE',
      );
    }
    throw error;
  }
  // Reading the size renders nothing; what is rendered is bounded by the checks below (the
  // sanitised document cannot embed images).
  let meta: sharp.Metadata;
  try {
    meta = await sharp(svg, { limitInputPixels: false }).metadata();
  } catch {
    throw new Refused('FILE_PARSE_ERROR');
  }
  // librsvg's intrinsic size: the declared one, else the content bounds.
  const intrinsicWidth = meta.width || DEFAULT_SIZE.width;
  const intrinsicHeight = meta.height || DEFAULT_SIZE.height;
  const width = Math.max(
    1,
    job.width ??
      (job.height
        ? Math.round((job.height * intrinsicWidth) / intrinsicHeight)
        : intrinsicWidth),
  );
  const height = Math.max(
    1,
    job.height ??
      (job.width
        ? Math.round((job.width * intrinsicHeight) / intrinsicWidth)
        : intrinsicHeight),
  );
  if (width > job.maxWidth || height > job.maxHeight) {
    throw new Refused('IMAGE_TOO_LARGE', {
      maxHeight: job.maxHeight,
      maxWidth: job.maxWidth,
    });
  }
  // The density that renders the document at the target size directly (no upscaled bitmap).
  const scale = Math.max(width / intrinsicWidth, height / intrinsicHeight);
  const density = Math.min(MAX_DENSITY, Math.max(1, 72 * scale));
  // What librsvg will actually paint, which the output size alone does not bound.
  const surface =
    ((intrinsicWidth * density) / 72) * ((intrinsicHeight * density) / 72);
  if (surface > MAX_RENDER_PIXELS) {
    throw new Refused('IMAGE_TOO_LARGE', {
      maxHeight: job.maxHeight,
      maxWidth: job.maxWidth,
    });
  }
  const pipeline = sharp(svg, { density, limitInputPixels: false })
    .resize({ fit: 'fill', height, width })
    .flatten({ background: job.background });
  try {
    return await (job.target === 'jpeg'
      ? pipeline.jpeg({ mozjpeg: true, quality: job.quality }).toBuffer()
      : pipeline.png().toBuffer());
  } catch (error: unknown) {
    if (error instanceof Error && LIBVIPS_BAD_INPUT.test(error.message)) {
      throw new Refused('FILE_PARSE_ERROR');
    }
    throw error;
  }
}

process.once('message', (job: SvgRenderJob) => {
  render(job)
    .then(
      (output): SvgRenderResult => ({ ok: true, output }),
      (error: unknown): SvgRenderResult =>
        error instanceof Refused
          ? { code: error.code, context: error.context, ok: false }
          : {
              error: error instanceof Error ? error.message : String(error),
              ok: false,
            },
    )
    .then((result) => {
      process.send?.(result, () => process.exit(0));
    })
    // The parent reports a child that exits without a result.
    .catch(() => process.exit(1));
});
