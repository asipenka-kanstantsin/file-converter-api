import { Prisma } from '@/generated/prisma/client';

import { mapPrismaException } from './prisma-exception.mapper';

function known(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('db error', {
    clientVersion: 'test',
    code,
    meta,
  });
}

function uniqueOn(index: string): Prisma.PrismaClientKnownRequestError {
  return known('P2002', {
    driverAdapterError: {
      cause: { constraint: { index }, kind: 'UniqueConstraintViolation' },
    },
  });
}

describe('mapPrismaException', () => {
  it('maps a known unique constraint to its domain code', () => {
    expect(mapPrismaException(uniqueOn('users_email_key'))).toEqual({
      code: 'USER_EMAIL_TAKEN',
      status: 409,
    });
  });

  it('maps any other unique violation to 409 CONFLICT', () => {
    expect(mapPrismaException(uniqueOn('other_key'))).toEqual({
      code: 'CONFLICT',
      status: 409,
    });
    expect(mapPrismaException(known('P2002'))).toEqual({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('leaves other Prisma errors and foreign errors to the filter fallback', () => {
    expect(mapPrismaException(known('P2025'))).toBeUndefined();
    expect(mapPrismaException(new Error('not prisma'))).toBeUndefined();
  });
});
