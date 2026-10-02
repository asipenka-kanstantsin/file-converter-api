import { Logger } from '@nestjs/common';

import { ErrorCode } from '@/common/errors';
import type { User, UsersService } from '@/modules/users';

import { RbacAdminService } from './rbac-admin.service';
import type { RbacRepository } from './rbac.repository';
import type { RbacService } from './rbac.service';
import type { Role } from './rbac.types';

jest.mock('@nestjs-cls/transactional', () => ({
  Transactional:
    () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

const now = new Date();
const admin: Role = {
  createdAt: now,
  description: null,
  id: 'role-admin',
  name: 'admin',
  updatedAt: now,
};
const support: Role = { ...admin, id: 'role-support', name: 'support' };
const target = { id: 'u2', status: 'active' } as User;
const actor = { id: 'u1', roleIds: ['role-admin'] };

function setup(adminHolders: number): {
  log: jest.SpyInstance;
  reload: jest.Mock;
  service: RbacAdminService;
  warn: jest.SpyInstance;
} {
  const repository = {
    countActiveRoleHolders: jest.fn().mockResolvedValue(adminHolders),
    findRoleByName: jest.fn().mockResolvedValue(admin),
    lockRole: jest.fn().mockResolvedValue(admin),
    lockRolesForShare: jest.fn().mockResolvedValue([support]),
    replaceUserRoles: jest.fn().mockResolvedValue(undefined),
    roleIdsOf: jest.fn().mockResolvedValue(['role-support']),
  };
  const reload = jest.fn().mockResolvedValue(undefined);
  return {
    log: jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined),
    reload,
    service: new RbacAdminService(
      { reloadAfterChange: reload } as unknown as RbacService,
      repository as unknown as RbacRepository,
      {
        lockForShare: jest.fn().mockResolvedValue(target),
      } as unknown as UsersService,
    ),
    warn: jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined),
  };
}

describe('RbacAdminService audit (Notion "RBAC" 1.5)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs who changed whose roles to what, then reloads the cache', async () => {
    const { log, reload, service } = setup(1);

    await service.setUserRoles(actor, 'u2', ['role-support']);

    expect(log).toHaveBeenCalledWith(
      {
        actorUserId: 'u1',
        entity: 'user_roles',
        entityId: undefined,
        operation: 'update',
        result: 200,
        roleIds: ['role-support'],
        targetUserId: 'u2',
      },
      'rbac changed',
    );
    expect(reload).toHaveBeenCalledWith('user_roles update');
  });

  it('logs a refusal with its code and status, and does not reload', async () => {
    const { reload, service, warn } = setup(0);

    await expect(
      service.setUserRoles(actor, 'u2', ['role-support']),
    ).rejects.toMatchObject({ code: ErrorCode.RBAC_LAST_ADMIN });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'u1',
        code: ErrorCode.RBAC_LAST_ADMIN,
        result: 409,
        targetUserId: 'u2',
      }),
      'rbac change refused',
    );
    expect(reload).not.toHaveBeenCalled();
  });
});
