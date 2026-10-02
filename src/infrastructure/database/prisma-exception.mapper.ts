import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ErrorCode, type ExceptionMapper } from '@/common/errors';
import { Prisma } from '@/generated/prisma/client';

// Unique constraints whose violation has a domain meaning (08-errors: map by constraint name,
// never by parsing the message). Anything else is a generic 409 CONFLICT.
const UNIQUE_CONSTRAINT_CODES: Readonly<Record<string, ErrorCode>> = {
  users_email_key: ErrorCode.USER_EMAIL_TAKEN,
};

// Prisma 7 + driver adapter: meta.driverAdapterError.cause.constraint.index.
const uniqueMetaSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ constraint: z.object({ index: z.string() }) }),
  }),
});

function constraintName(meta: unknown): string | undefined {
  const parsed = uniqueMetaSchema.safeParse(meta);
  return parsed.success
    ? parsed.data.driverAdapterError.cause.constraint.index
    : undefined;
}

// Safety net for races; services check expected conflicts themselves (07-database-prisma).
export const mapPrismaException: ExceptionMapper = (exception) => {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError))
    return undefined;
  if (exception.code !== 'P2002') return undefined;
  const name = constraintName(exception.meta);
  return {
    code:
      (name === undefined ? undefined : UNIQUE_CONSTRAINT_CODES[name]) ??
      ErrorCode.CONFLICT,
    status: HttpStatus.CONFLICT,
  };
};
