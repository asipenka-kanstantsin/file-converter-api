import sharp from 'sharp';

import { LIBVIPS_BAD_INPUT } from './libvips-errors';

// Decompression bombs (Notion 1.4, 1.6): a raster may not decode to more than this, whatever its
// file size says.
export const MAX_INPUT_PIXELS = 50_000_000;

export type RasterFailure =
  'CONVERSION_TIMEOUT' | 'FILE_PARSE_ERROR' | 'IMAGE_TOO_LARGE';

export interface RasterJob {
  background: string;
  input: Uint8Array;
  quality: number;
  target: 'jpeg' | 'png';
  timeoutMs: number;
}

// libvips stops this much before the pool's abort, so a thread that ran long finishes by itself
// and is reused instead of terminated.
const SELF_STOP_MARGIN_MS = 1_000;

export class RasterConversionError extends Error {
  constructor(
    readonly code: RasterFailure,
    readonly context?: Record<string, number>,
  ) {
    super(code);
    this.name = 'RasterConversionError';
  }
}

function refuse(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (/timeout/i.test(message)) {
    throw new RasterConversionError('CONVERSION_TIMEOUT');
  }
  if (/pixel limit/i.test(message)) {
    throw new RasterConversionError('IMAGE_TOO_LARGE', {
      maxPixels: MAX_INPUT_PIXELS,
    });
  }
  if (LIBVIPS_BAD_INPUT.test(message)) {
    throw new RasterConversionError('FILE_PARSE_ERROR');
  }
  throw error;
}

// PNG ↔ JPEG. Runs in a worker thread (decision F2); only relative imports and libraries, so it
// loads without the app's path aliases.
export async function convertRaster(job: RasterJob): Promise<Uint8Array> {
  try {
    // EXIF orientation applied, then dropped (a phone photo stays upright).
    const pipeline = sharp(job.input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).rotate();
    // A valid header with a broken body fails here, not half-way through the encode.
    await pipeline.metadata();
    const encoded =
      job.target === 'jpeg'
        ? pipeline
            .flatten({ background: job.background })
            .jpeg({ mozjpeg: true, quality: job.quality })
        : pipeline.png();
    return await encoded
      .timeout({
        seconds: Math.max(
          1,
          Math.floor((job.timeoutMs - SELF_STOP_MARGIN_MS) / 1000),
        ),
      })
      .toBuffer();
  } catch (error: unknown) {
    refuse(error);
  }
}
