import { createHash } from 'node:crypto';

import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { AppException, ErrorCode } from '@/common/errors';
import { isExactInstant } from '@/common/validation';

import { type UserStatus, userStatusSchema } from './users.types';

export const USER_LIST_SORTS = ['created_at', 'email', 'last_login'] as const;
export type UserListSort = (typeof USER_LIST_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

export interface UserListQuery {
  cursor?: string;
  limit: number;
  order: SortOrder;
  q?: string;
  sort: UserListSort;
  status?: UserStatus;
}

// The sort key of the last row returned, plus the parameters it is valid for: a cursor carried
// over to other filters or another order would silently skip or repeat rows (decision L2).
const cursorSchema = z
  .object({
    id: z.uuid(),
    key: z.string().max(254),
    order: z.enum(['asc', 'desc']),
    // A hash, not the search text: cursors end up in URLs and browser history.
    q: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
    sort: z.enum(USER_LIST_SORTS),
    status: userStatusSchema.optional(),
  })
  .refine(({ key, sort }) =>
    sort === 'email' ? !key.includes('\u0000') : isTimestampKey(key),
  );

// The shape, and a real instant that round-trips exactly (no 30 February, no hour 25, no year 0).
function isTimestampKey(key: string): boolean {
  return key === '-infinity' || isExactInstant(key);
}

// The search text as the cursor carries it.
export function searchHash(q: string | undefined): string | undefined {
  return q === undefined
    ? undefined
    : createHash('sha256').update(q).digest('hex').slice(0, 16);
}

export type UserListCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: UserListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(query: UserListQuery): UserListCursor | undefined {
  if (query.cursor === undefined) return undefined;
  let parsed: z.ZodSafeParseResult<UserListCursor>;
  try {
    parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
    );
  } catch {
    invalidCursor();
  }
  const cursor = parsed.success ? parsed.data : invalidCursor();
  if (
    cursor.sort !== query.sort ||
    cursor.order !== query.order ||
    cursor.q !== searchHash(query.q) ||
    cursor.status !== query.status
  ) {
    invalidCursor();
  }
  return cursor;
}

function invalidCursor(): never {
  throw new AppException(
    ErrorCode.PAGINATION_CURSOR_INVALID,
    HttpStatus.BAD_REQUEST,
  );
}

// LIKE metacharacters in the search text are literal.
export function likePrefix(text: string): string {
  return `${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
