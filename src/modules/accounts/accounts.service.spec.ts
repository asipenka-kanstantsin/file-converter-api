import { Logger } from '@nestjs/common';

import { ErrorCode } from '@/common/errors';
import type { AuthService } from '@/modules/auth';
import type { FilesService } from '@/modules/files';
import type { RbacAdminService, RbacService } from '@/modules/rbac';
import type { User, UsersService } from '@/modules/users';

import { AccountsService } from './accounts.service';

const user: User = {
  createdAt: new Date('2026-01-01T00:00:00Z'),
  displayName: 'Jane',
  email: 'jane@example.com',
  id: 'u2',
  lastLoginAt: new Date('2026-02-01T00:00:00Z'),
  photoFileId: null,
  status: 'active',
  tokenVersion: 4,
};

function setup(
  canRead: boolean,
  found: User | null = user,
): { can: jest.Mock; findById: jest.Mock; service: AccountsService } {
  const findById = jest.fn().mockResolvedValue(found);
  const can = jest.fn().mockReturnValue(canRead);
  return {
    can,
    findById,
    service: new AccountsService(
      {} as AuthService,
      {} as FilesService,
      { can } as unknown as RbacService,
      {} as RbacAdminService,
      { findById } as unknown as UsersService,
    ),
  };
}

describe('AccountsService.getProfile', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('gives Self the self fields, never internal ones', async () => {
    const { service } = setup(false);

    const profile = await service.getProfile({ id: 'u2', roleIds: [] }, 'u2');

    expect(profile).toEqual({
      email: user.email,
      fields: {
        createdAt: user.createdAt,
        displayName: 'Jane',
        lastLoginAt: user.lastLoginAt,
        status: 'active',
      },
      id: 'u2',
      photo: null,
    });
    expect(JSON.stringify(profile)).not.toContain('tokenVersion');
    expect(log).toHaveBeenCalledWith(
      { result: 200, targetUserId: 'u2', viewerUserId: 'u2' },
      'profile viewed',
    );
  });

  it('gives a users@read viewer the other fields only', async () => {
    const { can, service } = setup(true);

    const profile = await service.getProfile(
      { id: 'u1', roleIds: ['r'] },
      'u2',
    );

    expect(Object.keys(profile.fields).sort()).toEqual([
      'createdAt',
      'displayName',
      'status',
    ]);
    expect(can).toHaveBeenCalledWith(['r'], 'users', 'read');
  });

  it('refuses a foreign id without the permission before any lookup', async () => {
    const { findById, service } = setup(false);

    await expect(
      service.getProfile({ id: 'u1', roleIds: [] }, 'u2'),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_FORBIDDEN, status: 403 });
    expect(findById).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { result: 403, targetUserId: 'u2', viewerUserId: 'u1' },
      'profile view refused',
    );
  });

  it('answers 404 for a missing user and logs it', async () => {
    const { service } = setup(true, null);

    await expect(
      service.getProfile({ id: 'u1', roleIds: ['r'] }, 'u2'),
    ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND, status: 404 });
    expect(log).toHaveBeenCalledWith(
      { result: 404, targetUserId: 'u2', viewerUserId: 'u1' },
      'profile viewed',
    );
  });
});
