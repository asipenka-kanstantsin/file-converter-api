import { createHash, randomUUID } from 'node:crypto';

import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import type { PrismaService } from '@/infrastructure/database';
import { OutboxService, PermanentJobError } from '@/infrastructure/outbox';
import {
  STORAGE_PORT,
  type StoragePort,
  type StoredObject,
} from '@/infrastructure/storage';

export const STORAGE_DELETE = 'storage.delete';

export type FilePurpose = 'avatar' | 'transformation_result';

export interface StoredFile {
  checksum: string;
  id: string;
  key: string;
  mime: string;
  originalName: null | string;
  ownerId: string;
  purpose: FilePurpose;
  size: number;
}

export interface NewFile {
  body: Buffer;
  expiresAt?: Date;
  mime: string;
  originalName?: string;
  ownerId: string;
  purpose: FilePurpose;
}

const deletePayloadSchema = z.object({ key: z.string().min(1) });

// The `files` table is the source of truth for stored objects (12-storage). The object is written
// first, its row in the caller's transaction; deletes remove the row with the business change
// and leave the object to the outbox, so an object is never gone while a row still points at it.
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly outbox: OutboxService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  // The object is put first, outside any transaction; then its row and the caller's change
  // commit together. Any failure after the put removes the object again, so there is never a
  // row without its object nor (beyond a crash) an object without its row.
  async storeWithin<T>(
    input: NewFile,
    change: (file: StoredFile) => Promise<T>,
  ): Promise<T> {
    const id = randomUUID();
    const key = `${input.purpose}/${input.ownerId}/${id}`;
    await this.storage.putObject(key, input.body, { contentType: input.mime });
    try {
      return await this.txHost.withTransaction(async () => {
        const file = await this.txHost.tx.file.create({
          data: {
            checksum: createHash('sha256').update(input.body).digest('hex'),
            expiresAt: input.expiresAt ?? null,
            id,
            key,
            mime: input.mime,
            originalName: input.originalName ?? null,
            ownerId: input.ownerId,
            purpose: input.purpose,
            size: input.body.length,
          },
          select: {
            checksum: true,
            id: true,
            key: true,
            mime: true,
            originalName: true,
            ownerId: true,
            purpose: true,
            size: true,
          },
        });
        return change(file);
      });
    } catch (error: unknown) {
      await this.discard(key);
      throw error;
    }
  }

  // Best effort, outside any transaction: an object whose row was never committed.
  private async discard(key: string): Promise<void> {
    try {
      await this.storage.deleteObject(key);
    } catch (error: unknown) {
      this.logger.warn({ err: error, key }, 'orphan object not removed');
    }
  }

  // Null when the row or the object is missing; a row without its object is a desync and logged.
  async open(
    fileId: string,
  ): Promise<null | (StoredObject & { file: StoredFile })> {
    const file = await this.txHost.tx.file.findUnique({
      where: { id: fileId },
    });
    if (!file) return null;
    const object = await this.storage.getObject(file.key);
    if (!object) {
      this.logger.error({ fileId }, 'stored object missing for a file row');
      return null;
    }
    return { ...object, file };
  }

  async idsOwnedBy(ownerId: string): Promise<string[]> {
    const rows = await this.txHost.tx.file.findMany({
      select: { id: true },
      where: { ownerId },
    });
    return rows.map((row) => row.id);
  }

  // In the caller's transaction: the row goes now, the object after commit.
  async remove(fileId: string): Promise<void> {
    const file = await this.txHost.tx.file.findUnique({
      select: { key: true },
      where: { id: fileId },
    });
    if (!file) return;
    await this.txHost.tx.file.delete({ where: { id: fileId } });
    await this.outbox.enqueue({
      idempotencyKey: `${STORAGE_DELETE}:${file.key}`,
      payload: { key: file.key },
      type: STORAGE_DELETE,
    });
  }

  // remove() for many files in three statements (cleanup batches, F5).
  async removeMany(fileIds: readonly string[]): Promise<void> {
    if (fileIds.length === 0) return;
    const files = await this.txHost.tx.file.findMany({
      select: { key: true },
      where: { id: { in: [...fileIds] } },
    });
    await this.txHost.tx.file.deleteMany({
      where: { id: { in: [...fileIds] } },
    });
    await this.outbox.enqueueMany(
      files.map(({ key }) => ({
        idempotencyKey: `${STORAGE_DELETE}:${key}`,
        payload: { key },
        type: STORAGE_DELETE,
      })),
    );
  }

  // Outbox handler; idempotent, a missing object is success.
  async deleteObject(payload: unknown): Promise<void> {
    const parsed = deletePayloadSchema.safeParse(payload);
    if (!parsed.success)
      throw new PermanentJobError('invalid storage.delete payload');
    await this.storage.deleteObject(parsed.data.key);
  }
}
