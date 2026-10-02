import { Prisma } from '@/generated/prisma/client';

import { mapPrismaException } from './prisma-exception.mapper';

function known(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('db error', {
    clientVersion: 'test',
    code,
  });
}

describe('mapPrismaException', () => {
  it('maps a unique violation to 409 CONFLICT', () => {
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
