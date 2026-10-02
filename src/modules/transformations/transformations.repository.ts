import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import type { PrismaService } from '@/infrastructure/database';

import type { TransformationType } from './converter';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  type HistoryItem,
  type HistoryQuery,
} from './history';

export interface NewTransformation {
  durationMs: number;
  errorCode: null | string;
  expiresAt: Date;
  fileSize: number;
  sourceFormat: null | string;
  status: 'error' | 'success';
  targetFormat: string;
  type: TransformationType;
  userId: string;
}

const historyRowsSchema = z.array(
  z.object({
    created_at: z.date(),
    duration_ms: z.number().int(),
    error_code: z.string().nullable(),
    file_size: z.number().int(),
    id: z.string(),
    result_file_id: z.string().nullable(),
    source_format: z.string().nullable(),
    status: z.enum(['error', 'success']),
    target_format: z.string(),
    type: z.enum(['file', 'image']),
  }),
);

const expiredRowsSchema = z.array(
  z.object({ result_file_id: z.string().nullable() }),
);

@Injectable()
export class TransformationsRepository {
  constructor(
    private readonly txHost: TransactionHost<
      TransactionalAdapterPrisma<PrismaService>
    >,
  ) {}

  async create(input: NewTransformation): Promise<string> {
    const row = await this.txHost.tx.transformation.create({
      data: input,
      select: { id: true },
    });
    return row.id;
  }

  async setResult(id: string, fileId: string): Promise<void> {
    await this.txHost.tx.transformation.update({
      data: { resultFileId: fileId },
      where: { id },
    });
  }

  // Notion "Просмотр истории" 1.3: one user's rows, newest first, expired ones hidden (they
  // are about to be cleaned up, F5). Raw SQL for the row comparison: it bounds the scan of the
  // (user_id, [type|status,] created_at, id) indexes, where Prisma's OR form only filters it.
  async list(
    userId: string,
    query: HistoryQuery,
  ): Promise<{ items: HistoryItem[]; nextCursor: null | string }> {
    const cursor = decodeHistoryCursor(query);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`user_id = ${userId}::uuid`,
      Prisma.sql`expires_at > now()`,
    ];
    if (query.type !== undefined) {
      conditions.push(Prisma.sql`type = ${query.type}::transformation_type`);
    }
    if (query.status !== undefined) {
      conditions.push(
        Prisma.sql`status = ${query.status}::transformation_status`,
      );
    }
    if (query.sourceFormat !== undefined) {
      conditions.push(Prisma.sql`source_format = ${query.sourceFormat}`);
    }
    if (query.targetFormat !== undefined) {
      conditions.push(Prisma.sql`target_format = ${query.targetFormat}`);
    }
    if (query.createdAtFrom !== undefined) {
      conditions.push(
        Prisma.sql`created_at >= ${query.createdAtFrom}::timestamptz`,
      );
    }
    if (query.createdAtTo !== undefined) {
      conditions.push(
        Prisma.sql`created_at <= ${query.createdAtTo}::timestamptz`,
      );
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(created_at, id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const rows = historyRowsSchema.parse(
      await this.txHost.tx.$queryRaw`
        SELECT id, type::text AS type, status::text AS status, source_format, target_format,
               file_size, duration_ms, error_code, result_file_id, created_at
          FROM transformations
         WHERE ${Prisma.join(conditions, ' AND ')}
         ORDER BY created_at DESC, id DESC
         LIMIT ${query.limit + 1}`,
    );
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        createdAt: row.created_at,
        downloadable: row.result_file_id !== null,
        durationMs: row.duration_ms,
        errorCode: row.error_code,
        fileSize: row.file_size,
        id: row.id,
        sourceFormat: row.source_format,
        status: row.status,
        targetFormat: row.target_format,
        type: row.type,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? encodeHistoryCursor(query, {
              createdAt: last.created_at,
              id: last.id,
            })
          : null,
    };
  }

  // A history row as a download needs it (Notion "Сохранение результатов" 1.3.2/1.3.3).
  findForDownload(id: string): Promise<null | {
    expiresAt: Date;
    resultFileId: null | string;
    userId: string;
  }> {
    return this.txHost.tx.transformation.findUnique({
      select: { expiresAt: true, resultFileId: true, userId: true },
      where: { id },
    });
  }

  // Cleanup (F5): one instance at a time cluster-wide, for the current transaction.
  async tryLockCleanup(): Promise<boolean> {
    const [row] = await this.txHost.tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('transformations.cleanup')) AS locked`;
    return row?.locked === true;
  }

  // Deletes up to `limit` expired rows (oldest first, rows in use skipped) and returns the
  // files they held, for the caller to remove in the same transaction.
  async deleteExpired(
    limit: number,
  ): Promise<{ count: number; fileIds: string[] }> {
    const rows = expiredRowsSchema.parse(
      await this.txHost.tx.$queryRaw`
        DELETE FROM transformations
         WHERE id IN (SELECT id FROM transformations
                       WHERE expires_at <= now()
                       ORDER BY expires_at
                       LIMIT ${limit}
                         FOR UPDATE SKIP LOCKED)
        RETURNING result_file_id`,
    );
    return {
      count: rows.length,
      fileIds: rows.flatMap((row) =>
        row.result_file_id === null ? [] : [row.result_file_id],
      ),
    };
  }

  // Account deletion (D1): the user's history goes; saved results are removed as files.
  async deleteForUser(userId: string): Promise<void> {
    await this.txHost.tx.transformation.deleteMany({ where: { userId } });
  }
}
