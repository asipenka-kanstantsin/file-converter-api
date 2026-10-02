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

function restrictedBy(index: string): Prisma.PrismaClientKnownRequestError {
  return known('P2003', {
    driverAdapterError: {
      cause: { constraint: { index }, kind: 'RestrictViolation' },
    },
  });
}

describe('mapPrismaException', () => {
  it('maps the RBAC unique constraints', () => {
    expect(mapPrismaException(uniqueOn('roles_name_key'))?.code).toBe(
      'RBAC_ROLE_NAME_TAKEN',
    );
    expect(mapPrismaException(uniqueOn('permissions_name_key'))?.code).toBe(
      'RBAC_PERMISSION_NAME_TAKEN',
    );
    expect(
      mapPrismaException(uniqueOn('grants_role_id_permission_id_key'))?.code,
    ).toBe('RBAC_GRANT_DUPLICATE');
  });

  it('maps a restricted delete to RBAC_IN_USE, any other one to CONFLICT', () => {
    for (const index of [
      'grants_role_id_fkey',
      'grants_permission_id_fkey',
      'user_roles_role_id_fkey',
    ]) {
      expect(mapPrismaException(restrictedBy(index))).toEqual({
        code: 'RBAC_IN_USE',
        status: 409,
      });
    }
    expect(mapPrismaException(restrictedBy('other_fkey'))?.code).toBe(
      'CONFLICT',
    );
  });

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

  it('maps a missing record to 404 with the entity code', () => {
    expect(mapPrismaException(known('P2025', { modelName: 'Grant' }))).toEqual({
      code: 'RBAC_GRANT_NOT_FOUND',
      status: 404,
    });
    expect(
      mapPrismaException(known('P2025', { modelName: 'User' }))?.code,
    ).toBe('USER_NOT_FOUND');
  });

  it('leaves other Prisma errors and foreign errors to the filter fallback', () => {
    expect(mapPrismaException(known('P2025'))).toBeUndefined();
    expect(
      mapPrismaException(known('P2025', { modelName: 'Challenge' })),
    ).toBeUndefined();
    expect(mapPrismaException(known('P2034'))).toBeUndefined();
    expect(mapPrismaException(new Error('not prisma'))).toBeUndefined();
  });
});
