import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import { HttpStatus, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Piscina } from 'piscina';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';

import type { ConversionJob, ConversionResult } from './conversion.worker';

// Each thread may hold this much heap; a text job beyond it ends as STRUCTURE_TOO_COMPLEX.
// Image data lives in libvips' own memory, bounded by MAX_INPUT_PIXELS instead.
const WORKER_HEAP_MB = 1024;
// Waiting jobs per thread (each holds its input); beyond it the request gets 503. Counted here:
// piscina's maxQueue does not apply to jobs that carry an abort signal.
const QUEUE_PER_THREAD = 4;

function failureOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return error.name;
}

// From source (tests) the worker is TypeScript and needs a loader; built, it is plain JS.
function workerFile(): string {
  return __filename.endsWith('.ts')
    ? join(__dirname, 'conversion.worker.dev.js')
    : join(__dirname, 'conversion.worker.js');
}

// Decision F2: every conversion — text parsing and raster encoding alike — runs in worker threads,
// aborted after the timeout (F6: 400 CONVERSION_TIMEOUT). An aborted job's thread is terminated,
// so a runaway parse or encode cannot linger. The timeout includes waiting in the (short) queue.
@Injectable()
export class ConversionPool implements OnModuleDestroy {
  private readonly pool: Piscina<ConversionJob, ConversionResult>;
  private readonly capacity: number;
  private inFlight = 0;

  constructor(private readonly config: AppConfig) {
    const threads =
      config.conversion.workers ??
      Math.max(1, Math.min(4, availableParallelism() - 1));
    this.capacity = threads * (1 + QUEUE_PER_THREAD);
    this.pool = new Piscina({
      filename: workerFile(),
      idleTimeout: 30_000,
      maxThreads: threads,
      // A conversion that would need more is refused, instead of growing the process.
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
  }

  get timeoutMs(): number {
    return this.config.conversion.timeoutMs;
  }

  async run(job: ConversionJob): Promise<ConversionResult> {
    if (this.inFlight >= this.capacity) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.inFlight += 1;
    try {
      return await this.pool.run(job, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw this.failed(job, error);
    } finally {
      this.inFlight -= 1;
    }
  }

  private failed(job: ConversionJob, error: unknown): Error {
    if (error instanceof Error && error.name === 'AbortError') {
      return new AppException(
        ErrorCode.CONVERSION_TIMEOUT,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (failureOf(error) === 'ERR_WORKER_OUT_OF_MEMORY') {
      // What the thread ran out of room for: a structure too deep, or an image too large.
      return job.kind === 'text'
        ? new AppException(
            ErrorCode.STRUCTURE_TOO_COMPLEX,
            HttpStatus.BAD_REQUEST,
          )
        : new AppException(ErrorCode.IMAGE_TOO_LARGE, HttpStatus.BAD_REQUEST);
    }
    // Only the kind of failure is passed on. No `cause`: pino appends a cause's message and stack
    // to `err.message`, and a parser or libvips message may quote the file (14-logging). The code
    // below is what diagnosis needs, and it carries no content.
    return new Error(
      `${job.kind} conversion worker failed (${failureOf(error) ?? 'unknown'})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.destroy();
  }
}
