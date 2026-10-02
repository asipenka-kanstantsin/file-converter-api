import { type ChildProcess, fork } from 'node:child_process';
import { join } from 'node:path';

import {
  type BeforeApplicationShutdown,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';

import type { SvgRenderJob, SvgRenderResult } from './svg-render.child';

// Renders at once; beyond it the request gets 503 (each render may hold up to the max raster).
const MAX_RENDERS = 2;

function childFile(): string {
  return __filename.endsWith('.ts')
    ? join(__dirname, 'svg-render.child.dev.js')
    : join(__dirname, 'svg-render.child.js');
}

// Decision F11: the whole SVG conversion (checking and rendering) in a child process killed at
// the timeout (400 CONVERSION_TIMEOUT), so no document can block the event loop, outlive the
// 30 s or starve the libuv pool that sign-ins (argon2) and storage share.
@Injectable()
export class SvgRenderer implements BeforeApplicationShutdown {
  private readonly children = new Set<ChildProcess>();
  private running = 0;

  constructor(private readonly config: AppConfig) {}

  // SIGTERM: no render outlives the app.
  beforeApplicationShutdown(): void {
    for (const child of this.children) child.kill('SIGKILL');
  }

  async render(job: SvgRenderJob): Promise<Buffer> {
    if (this.running >= MAX_RENDERS) {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.running += 1;
    try {
      return await this.run(job);
    } finally {
      this.running -= 1;
    }
  }

  private run(job: SvgRenderJob): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = fork(childFile(), [], {
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      this.children.add(child);
      child.once('exit', () => this.children.delete(child));
      let settled = false;
      const finish = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.exitCode === null) child.kill('SIGKILL');
        outcome();
      };
      const timer = setTimeout(() => {
        finish(() => {
          reject(
            new AppException(
              ErrorCode.CONVERSION_TIMEOUT,
              HttpStatus.BAD_REQUEST,
            ),
          );
        });
      }, this.config.conversion.timeoutMs);
      child.once('message', (result: SvgRenderResult) => {
        finish(() => {
          if (result.ok) {
            resolve(Buffer.from(result.output));
          } else {
            reject(
              new AppException(
                ErrorCode[result.code],
                HttpStatus.BAD_REQUEST,
                result.code === 'FILE_PARSE_ERROR'
                  ? { format: 'svg' }
                  : result.context,
              ),
            );
          }
        });
      });
      child.once('error', (error) => {
        finish(() => {
          reject(error);
        });
      });
      child.once('exit', () => {
        finish(() => {
          reject(new Error('svg render child exited without a result'));
        });
      });
      child.send(job);
    });
  }
}
