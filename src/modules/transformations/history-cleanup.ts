import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';

import { AppConfig } from '@/config';
import type { PrismaService } from '@/infrastructure/database';
import { FilesService } from '@/modules/files';

import { TransformationsRepository } from './transformations.repository';

const JOB = 'transformations.cleanup';
// Rows per transaction, set-based (a handful of statements whatever the size), well inside the
// transaction timeout even over a slow link.
const BATCH = 200;
const BATCH_TIMEOUT_MS = 60_000;

// Decision F5: every hour, expired history rows and their saved results go together (Notion
// "Сохранение результатов" 1.6: deleted at the same time). Row and file row in one transaction,
// the stored object after commit (outbox `storage.delete`). An advisory lock keeps it to one
// instance at a time; a failure is logged and the next run picks the rest up. On shutdown no new
// batch starts and the running one finishes before the database closes.
@Injectable()
export class HistoryCleanup implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HistoryCleanup.name);
  private running: Promise<null | number> | undefined;
  private stopping = false;

  constructor(
    private readonly config: AppConfig,
    private readonly files: FilesService,
    private readonly registry: SchedulerRegistry,
    private readonly repository: TransformationsRepository,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.jobs.enabled) this.registry.getCronJob(JOB).start();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.registry.getCronJob(JOB).stop();
    await this.running?.catch(() => undefined);
  }

  @Cron(CronExpression.EVERY_HOUR, {
    disabled: true,
    name: JOB,
    waitForCompletion: true,
  })
  async scheduled(): Promise<void> {
    try {
      await this.run();
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'history cleanup failed');
    }
  }

  // The number of rows removed; null when another instance holds the lock.
  async run(): Promise<null | number> {
    const run = this.runBatches();
    this.running = run;
    try {
      return await run;
    } finally {
      if (this.running === run) this.running = undefined;
    }
  }

  private async runBatches(): Promise<null | number> {
    const started = Date.now();
    let total = 0;
    for (;;) {
      const batch = await this.batch();
      if (batch === null) {
        if (total === 0) {
          this.logger.log('history cleanup skipped: running elsewhere');
          return null;
        }
        break;
      }
      total += batch.count;
      if (batch.count < BATCH || this.stopping) break;
    }
    this.logger.log(
      { durationMs: Date.now() - started, removed: total },
      'history cleanup done',
    );
    return total;
  }

  @Transactional<TransactionalAdapterPrisma<PrismaService>>({
    timeout: BATCH_TIMEOUT_MS,
  })
  private async batch(): Promise<null | { count: number }> {
    if (!(await this.repository.tryLockCleanup())) return null;
    const { count, fileIds } = await this.repository.deleteExpired(BATCH);
    await this.files.removeMany(fileIds);
    return { count };
  }
}
