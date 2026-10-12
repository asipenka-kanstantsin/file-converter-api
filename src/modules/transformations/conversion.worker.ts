import { Piscina } from 'piscina';
import sharp from 'sharp';

import {
  convertRaster,
  RasterConversionError,
  type RasterFailure,
  type RasterJob,
} from './image/raster-conversion';
import {
  convertText,
  TextConversionError,
  type TextFailure,
  type TextFormat,
} from './text/text-conversion';

export interface RasterConversionJob extends RasterJob {
  kind: 'raster';
}

export interface TextConversionJob {
  input: Uint8Array;
  kind: 'text';
  source: TextFormat;
  target: TextFormat;
}

export type ConversionJob = RasterConversionJob | TextConversionJob;

export type ConversionFailure = RasterFailure | TextFailure;

// Errors do not survive the thread boundary as classes, so a failure is data; a success is the
// output bytes themselves, moved (not copied) to the main thread.
export type ConversionResult =
  | Uint8Array
  | { code: ConversionFailure; context?: Record<string, number>; ok: false };

// Each thread renders one image at a time: the pool, not libvips, decides how much of the machine
// a conversion may take.
sharp.concurrency(1);

function text(job: TextConversionJob): ConversionResult {
  try {
    return new TextEncoder().encode(
      convertText(job.input, job.source, job.target),
    );
  } catch (error: unknown) {
    if (error instanceof TextConversionError)
      return { code: error.code, ok: false };
    // Anything else (a stack overflow on absurd nesting) is a structure problem, not a crash.
    if (error instanceof RangeError)
      return { code: 'STRUCTURE_TOO_COMPLEX', ok: false };
    throw error;
  }
}

async function raster(job: RasterConversionJob): Promise<ConversionResult> {
  try {
    // sharp hands back a view on a pooled buffer; a copy of its own is what can be moved.
    return new Uint8Array(await convertRaster(job));
  } catch (error: unknown) {
    if (error instanceof RasterConversionError)
      return { code: error.code, context: error.context, ok: false };
    throw error;
  }
}

// Runs in a piscina worker thread (decision F2): neither parsing a large file nor encoding an
// image ever blocks the event loop or the libuv pool that sign-ins and storage share.
export default async function run(
  job: ConversionJob,
): Promise<ConversionResult> {
  const result = job.kind === 'text' ? text(job) : await raster(job);
  return result instanceof Uint8Array
    ? (Piscina.move(result) as unknown as Uint8Array)
    : result;
}
