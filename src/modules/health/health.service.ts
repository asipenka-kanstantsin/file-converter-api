import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { PrismaService } from '@/infrastructure/database';

import type { HealthReport } from './dto/health-report.dto';

const DATABASE_TIMEOUT_MS = 2_000;
// Probes must never be rate-limited (a 429 would take the instance out of service), so the ping
// itself is bounded instead: concurrent probes share one query and the verdict is reused for this
// long. An orchestrator polling every second still costs the database one query per second.
const STATUS_TTL_MS = 1_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private pending: Promise<'down' | 'up'> | undefined;
  private cached: { at: number; status: 'down' | 'up' } | undefined;

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    const database = await this.currentDatabaseStatus();
    if (database === 'down') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        { checks: { database } },
      );
    }
    return { checks: { database }, status: 'ok' };
  }

  live(): HealthReport {
    return { checks: {}, status: 'ok' };
  }

  private currentDatabaseStatus(): Promise<'down' | 'up'> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < STATUS_TTL_MS) {
      return Promise.resolve(this.cached.status);
    }
    this.pending ??= this.databaseStatus()
      .then((status) => {
        this.cached = { at: Date.now(), status };
        return status;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async databaseStatus(): Promise<'down' | 'up'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('database ping timed out'));
      }, DATABASE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.prisma.ping(), timeout]);
      return 'up';
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'database health check failed');
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
