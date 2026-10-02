import sharp from 'sharp';

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

export type SvgRenderResult =
  | { code: SvgFailure; context?: Record<string, number>; ok: false }
  | { ok: true; output: Uint8Array };

// Notion 1.3.1: without an intrinsic size, a default.
const DEFAULT_SIZE = { height: 150, width: 300 };
const MAX_DENSITY = 100_000;

class Refused extends Error {
  constructor(
    readonly code: SvgFailure,
    readonly context?: Record<string, number>,
  ) {
    super(code);
  }
}

async function render(job: SvgRenderJob): Promise<Uint8Array> {
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
  const pipeline = sharp(svg, { density, limitInputPixels: false })
    .resize({ fit: 'fill', height, width })
    .flatten({ background: job.background });
  return job.target === 'jpeg'
    ? pipeline.jpeg({ mozjpeg: true, quality: job.quality }).toBuffer()
    : pipeline.png().toBuffer();
}

process.once('message', (job: SvgRenderJob) => {
  void render(job)
    .then((output): SvgRenderResult => ({ ok: true, output }))
    .catch((error: unknown): SvgRenderResult =>
      error instanceof Refused
        ? { code: error.code, context: error.context, ok: false }
        : { code: 'FILE_PARSE_ERROR', ok: false },
    )
    .then((result) => {
      process.send?.(result, () => process.exit(0));
    });
});
