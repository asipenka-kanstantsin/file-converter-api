import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';

import type { Prisma } from '@/generated/prisma/client';
import type { PrismaService } from '@/infrastructure/database';

import type { OutboxMessageInput } from './outbox.types';

@Injectable()
export class OutboxService {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  // Joins the caller's transaction: no commit, no message. A duplicate idempotency key is
  // ignored, so retried business operations never enqueue twice.
  async enqueue(message: OutboxMessageInput): Promise<void> {
    await this.txHost.tx.outboxMessage.createMany({
      data: [
        {
          idempotencyKey: message.idempotencyKey ?? null,
          payload: message.payload as Prisma.InputJsonObject,
          type: message.type,
        },
      ],
      skipDuplicates: true,
    });
  }
}
