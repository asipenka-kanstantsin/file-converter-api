import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ErrorCode, type ExceptionMapper } from '@/common/errors';
import { Prisma } from '@/generated/prisma/client';

// Unique constraints whose violation has a domain meaning (08-errors: map by constraint name,
// never by parsing the message). Anything else is a generic 409 CONFLICT.
const UNIQUE_CONSTRAINT_CODES: Readonly<Record<string, ErrorCode>> = {
  grants_role_id_permission_id_key: ErrorCode.RBAC_GRANT_DUPLICATE,
  permissions_name_key: ErrorCode.RBAC_PERMISSION_NAME_TAKEN,
  roles_name_key: ErrorCode.RBAC_ROLE_NAME_TAKEN,
  users_email_key: ErrorCode.USER_EMAIL_TAKEN,
};

// Deleting a row that others still reference (ON DELETE RESTRICT) — decision R4.
const FOREIGN_KEY_CODES: Readonly<Record<string, ErrorCode>> = {
  grants_permission_id_fkey: ErrorCode.RBAC_IN_USE,
  grants_role_id_fkey: ErrorCode.RBAC_IN_USE,
  user_roles_role_id_fkey: ErrorCode.RBAC_IN_USE,
};

// "Record to update/delete does not exist" (P2025) → 404 with the entity's code (07). Services
// lock rows before writing, so this is only the safety net.
const NOT_FOUND_CODES: Readonly<Record<string, ErrorCode>> = {
  Grant: ErrorCode.RBAC_GRANT_NOT_FOUND,
  Permission: ErrorCode.RBAC_PERMISSION_NOT_FOUND,
  Role: ErrorCode.RBAC_ROLE_NOT_FOUND,
  User: ErrorCode.USER_NOT_FOUND,
};

const modelMetaSchema = z.object({ modelName: z.string() });

// Prisma 7 + driver adapter: meta.driverAdapterError.cause.constraint.index, for unique (P2002)
// and foreign-key (P2003) violations alike.
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
  if (exception.code === 'P2025') {
    const model = modelMetaSchema.safeParse(exception.meta);
    const code = model.success
      ? NOT_FOUND_CODES[model.data.modelName]
      : undefined;
    return code ? { code, status: HttpStatus.NOT_FOUND } : undefined;
  }
  const codes =
    exception.code === 'P2002'
      ? UNIQUE_CONSTRAINT_CODES
      : exception.code === 'P2003'
        ? FOREIGN_KEY_CODES
        : undefined;
  if (!codes) return undefined;
  const name = constraintName(exception.meta);
  return {
    code: (name === undefined ? undefined : codes[name]) ?? ErrorCode.CONFLICT,
    status: HttpStatus.CONFLICT,
  };
};
