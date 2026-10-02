import { HttpStatus } from '@nestjs/common';

import { ErrorCode, type ExceptionMapper } from '@/common/errors';
import { Prisma } from '@/generated/prisma/client';

// Safety net for races; services check expected conflicts themselves (07-database-prisma).
export const mapPrismaException: ExceptionMapper = (exception) => {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError))
    return undefined;
  if (exception.code === 'P2002') {
    return { code: ErrorCode.CONFLICT, status: HttpStatus.CONFLICT };
  }
  return undefined;
};
