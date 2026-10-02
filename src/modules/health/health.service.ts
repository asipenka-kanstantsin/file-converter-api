import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { PrismaService } from '@/infrastructure/database';

import type { HealthReport } from './dto/health-report.dto';

const DATABASE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    const database = await this.databaseStatus();
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
