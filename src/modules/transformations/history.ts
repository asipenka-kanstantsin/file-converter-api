import { createHash } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { AppException, ErrorCode } from '@/common/errors';
import { instantSchema, isExactInstant } from '@/common/validation';

export const HISTORY_FORMATS = [
  'csv',
  'jpeg',
  'json',
  'png',
  'svg',
  'xml',
  'yaml',
] as const;

// Notion "Просмотр истории трансформаций" 1.3.1 query (decision F12).
export const historyQuerySchema = z
  .strictObject({
    createdAtFrom: instantSchema.optional(),
    createdAtTo: instantSchema.optional(),
    cursor: z.string().min(1).max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sourceFormat: z.enum(HISTORY_FORMATS).optional(),
    status: z.enum(['error', 'success']).optional(),
    targetFormat: z.enum(HISTORY_FORMATS).optional(),
    type: z.enum(['file', 'image']).optional(),
  })
  .refine(
    ({ createdAtFrom, createdAtTo }) =>
      createdAtFrom === undefined ||
      createdAtTo === undefined ||
      Date.parse(createdAtFrom) <= Date.parse(createdAtTo),
    { message: 'range', path: ['createdAtTo'] },
  );

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

export interface HistoryItem {
  createdAt: Date;
  downloadable: boolean;
  durationMs: number;
  errorCode: null | string;
  fileSize: number;
  id: string;
  sourceFormat: null | string;
  status: 'error' | 'success';
  targetFormat: string;
  type: 'file' | 'image';
}

// Keyset on (created_at, id), newest first. The cursor carries the last row and a hash of the
// filters it was issued for (F12, L2): reused with other filters or forged → 400.
const cursorSchema = z.object({
  at: z.string().refine(isExactInstant),
  f: z.string().regex(/^[0-9a-f]{16}$/),
  id: z.uuid(),
});

export interface HistoryCursor {
  at: string;
  id: string;
}

function filtersHash(query: HistoryQuery): string {
  const { cursor: _cursor, limit: _limit, ...filters } = query;
  const canonical = JSON.stringify(
    Object.entries(filters)
      .filter(([, value]) => (value as unknown) !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function encodeHistoryCursor(
  query: HistoryQuery,
  last: { createdAt: Date; id: string },
): string {
  return Buffer.from(
    JSON.stringify({
      at: last.createdAt.toISOString(),
      f: filtersHash(query),
      id: last.id,
    }),
  ).toString('base64url');
}

export function decodeHistoryCursor(
  query: HistoryQuery,
): HistoryCursor | undefined {
  if (query.cursor === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
  } catch {
    invalidCursor();
  }
  const parsed = cursorSchema.safeParse(raw);
  if (!parsed.success || parsed.data.f !== filtersHash(query)) invalidCursor();
  return { at: parsed.data.at, id: parsed.data.id };
}

function invalidCursor(): never {
  throw new AppException(
    ErrorCode.PAGINATION_CURSOR_INVALID,
    HttpStatus.BAD_REQUEST,
  );
}
