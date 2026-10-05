import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { z } from 'zod';

import { AppConfig } from '@/config';
import type { Prisma } from '@/generated/prisma/client';
import { PrismaService } from '@/infrastructure/database';

import { OutboxRegistry } from './outbox.registry';
import { PermanentJobError } from './outbox.types';

const BATCH_SIZE = 10;
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_CAP_SECONDS = 3600;

const claimedRowSchema = z.object({
  attempts: z.number().int(),
  id: z.string(),
  payload: z.unknown(),
  type: z.string(),
});

type ClaimedRow = z.infer<typeof claimedRowSchema>;

export function backoffSeconds(attempts: number): number {
  return Math.min(
    BACKOFF_BASE_SECONDS * 2 ** (attempts - 1),
    BACKOFF_CAP_SECONDS,
  );
}

// Error text goes to logs and `last_error`; SMTP errors can quote the recipient.
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, '[email]').slice(0, 1000);
}

export interface TickResult {
  dead: number;
  done: number;
  retried: number;
}

// Delivers outbox rows after their transaction committed (20-jobs). Claiming commits before
// handlers run, so a crash leaves a lease that expires and the row is retried. Every later write
// is conditioned on still owning the claim (`processing` + the claimed attempt number).
@Injectable()
export class OutboxDispatcher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly registry: OutboxRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.jobs.enabled) return;
    this.timer = setInterval(() => {
      this.poll();
    }, this.config.jobs.outboxPollIntervalMs);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<TickResult> {
    const result: TickResult = { dead: 0, done: 0, retried: 0 };
    result.dead += await this.buryAbandoned();
    for (const message of await this.claim()) {
      const outcome = await this.deliver(message);
      if (outcome) result[outcome] += 1;
    }
    return result;
  }

  // A row whose worker kept crashing mid-delivery would otherwise be re-claimed forever.
  private async buryAbandoned(): Promise<number> {
    const { count } = await this.prisma.outboxMessage.updateMany({
      data: {
        lastError: 'lease expired on the last attempt',
        lockedUntil: null,
        payload: {},
        status: 'dead',
      },
      where: {
        attempts: { gte: MAX_ATTEMPTS },
        lockedUntil: { lt: new Date() },
        status: 'processing',
      },
    });
    return count;
  }

  private async claim(): Promise<ClaimedRow[]> {
    const rows: unknown = await this.prisma.$queryRaw`
      UPDATE outbox_messages
         SET status = 'processing',
             locked_until = now() + make_interval(secs => ${LEASE_SECONDS}),
             attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox_messages
          WHERE attempts < ${MAX_ATTEMPTS}
            AND ((status = 'pending' AND next_attempt_at <= now())
              OR (status = 'processing' AND locked_until < now()))
          ORDER BY next_attempt_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, attempts`;
    return z.array(claimedRowSchema).parse(rows);
  }

  private async deliver(
    message: ClaimedRow,
  ): Promise<keyof TickResult | undefined> {
    const fields = {
      attempt: message.attempts,
      outboxId: message.id,
      type: message.type,
    };
    // Renew the lease per message: the batch is delivered one after another.
    const renewed = await this.updateOwned(message, {
      lockedUntil: new Date(Date.now() + LEASE_SECONDS * 1000),
    });
    if (!renewed) return undefined;

    const handler = this.registry.get(message.type);
    try {
      if (!handler)
        throw new PermanentJobError(`no handler for ${message.type}`);
      await handler(message.payload);
      // Payloads may carry one-time secrets (confirmation codes, links): drop them once sent.
      await this.updateOwned(message, {
        lockedUntil: null,
        payload: {},
        processedAt: new Date(),
        status: 'done',
      });
      return 'done';
    } catch (error: unknown) {
      const lastError = sanitizeError(error);
      if (
        error instanceof PermanentJobError ||
        message.attempts >= MAX_ATTEMPTS
      ) {
        await this.updateOwned(message, {
          lastError,
          lockedUntil: null,
          payload: {},
          status: 'dead',
        });
        this.logger.error(
          { ...fields, error: lastError },
          'outbox message dead',
        );
        return 'dead';
      }
      await this.updateOwned(message, {
        lastError,
        lockedUntil: null,
        nextAttemptAt: new Date(
          Date.now() + backoffSeconds(message.attempts) * 1000,
        ),
        status: 'pending',
      });
      this.logger.warn(
        { ...fields, error: lastError },
        'outbox message will be retried',
      );
      return 'retried';
    }
  }

  private poll(): void {
    if (this.running) return;
    this.running = true;
    this.tick()
      .catch((error: unknown) => {
        this.logger.error(
          { error: sanitizeError(error) },
          'outbox poll failed',
        );
      })
      .finally(() => {
        this.running = false;
      });
  }

  private async updateOwned(
    message: ClaimedRow,
    data: Prisma.OutboxMessageUpdateManyMutationInput,
  ): Promise<boolean> {
    const { count } = await this.prisma.outboxMessage.updateMany({
      data,
      where: {
        attempts: message.attempts,
        id: message.id,
        status: 'processing',
      },
    });
    if (count === 0) {
      this.logger.warn(
        { attempt: message.attempts, outboxId: message.id },
        'outbox claim lost to another worker',
      );
    }
    return count === 1;
  }
}
