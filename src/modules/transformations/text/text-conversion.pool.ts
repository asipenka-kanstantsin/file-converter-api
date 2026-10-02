import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import { HttpStatus, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Piscina } from 'piscina';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';

import type { TextFormat } from './text-conversion';
import type { TextJob, TextJobResult } from './text-conversion.worker';

// Each thread may hold this much heap; a job beyond it ends as STRUCTURE_TOO_COMPLEX.
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
    ? join(__dirname, 'text-conversion.worker.dev.js')
    : join(__dirname, 'text-conversion.worker.js');
}

// Decision F2: text conversion in worker threads, aborted after the timeout (F6: 400
// CONVERSION_TIMEOUT). An aborted job's thread is terminated, so a runaway parse cannot linger.
// The timeout includes waiting in the (short) queue.
@Injectable()
export class TextConversionPool implements OnModuleDestroy {
  private readonly pool: Piscina<TextJob, TextJobResult>;
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

  async run(
    input: Uint8Array,
    source: TextFormat,
    target: TextFormat,
  ): Promise<TextJobResult> {
    if (this.inFlight >= this.capacity) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.inFlight += 1;
    try {
      return await this.pool.run(
        { input, source, target },
        { signal: AbortSignal.timeout(this.config.conversion.timeoutMs) },
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AppException(
          ErrorCode.CONVERSION_TIMEOUT,
          HttpStatus.BAD_REQUEST,
        );
      }
      if (failureOf(error) === 'ERR_WORKER_OUT_OF_MEMORY') {
        throw new AppException(
          ErrorCode.STRUCTURE_TOO_COMPLEX,
          HttpStatus.BAD_REQUEST,
        );
      }
      // Library messages may quote the content: only the kind of failure is passed on.
      throw new Error(
        `text conversion worker failed (${failureOf(error) ?? 'unknown'})`,
      );
    } finally {
      this.inFlight -= 1;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.destroy();
  }
}
