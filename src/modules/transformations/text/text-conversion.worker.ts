import { Piscina } from 'piscina';

import {
  convertText,
  TextConversionError,
  type TextFailure,
  type TextFormat,
} from './text-conversion';

export interface TextJob {
  input: Uint8Array;
  source: TextFormat;
  target: TextFormat;
}

// Errors do not survive the thread boundary as classes, so a failure is data; a success is the
// output bytes themselves, moved (not copied) to the main thread.
export type TextJobResult = Uint8Array | { code: TextFailure; ok: false };

// Runs in a piscina worker thread (decision F2): parsing a large file never blocks the event loop.
export default function run(job: TextJob): TextJobResult {
  try {
    const output = new TextEncoder().encode(
      convertText(job.input, job.source, job.target),
    );
    return Piscina.move(output) as unknown as Uint8Array;
  } catch (error: unknown) {
    if (error instanceof TextConversionError)
      return { code: error.code, ok: false };
    // Anything else (a stack overflow on absurd nesting) is a structure problem, not a crash.
    if (error instanceof RangeError)
      return { code: 'STRUCTURE_TOO_COMPLEX', ok: false };
    throw error;
  }
}
