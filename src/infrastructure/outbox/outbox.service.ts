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

  // Unsent messages whose idempotency key starts with one of the prefixes are dropped, in the
  // caller's transaction (account deletion, D1). Sent and dead rows already hold no payload.
  async discardUnsent(keyPrefixes: readonly string[]): Promise<number> {
    if (keyPrefixes.length === 0) return 0;
    const { count } = await this.txHost.tx.outboxMessage.deleteMany({
      where: {
        OR: keyPrefixes.map((prefix) => ({
          idempotencyKey: { startsWith: prefix },
        })),
        status: { in: ['pending', 'processing'] },
      },
    });
    return count;
  }

  // Joins the caller's transaction: no commit, no message. A duplicate idempotency key is
  // ignored, so retried business operations never enqueue twice.
  async enqueue(message: OutboxMessageInput): Promise<void> {
    await this.enqueueMany([message]);
  }

  // One insert for many messages (cleanup batches).
  async enqueueMany(messages: readonly OutboxMessageInput[]): Promise<void> {
    if (messages.length === 0) return;
    await this.txHost.tx.outboxMessage.createMany({
      data: messages.map((message) => ({
        idempotencyKey: message.idempotencyKey ?? null,
        payload: message.payload as Prisma.InputJsonObject,
        type: message.type,
      })),
      skipDuplicates: true,
    });
  }
}
