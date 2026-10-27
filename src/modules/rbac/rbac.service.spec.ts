import { Logger } from '@nestjs/common';

import type { RbacRepository } from './rbac.repository';
import { buildSnapshot, RbacService } from './rbac.service';
import type { Grant, Permission, RbacConfiguration, Role } from './rbac.types';

jest.mock('@nestjs-cls/transactional', () => ({
  Transactional:
    () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

const now = new Date();
const role = (id: string, name: string): Role => ({
  createdAt: now,
  description: null,
  id,
  name,
  updatedAt: now,
});
const permission = (
  id: string,
  name: string,
  actions: string[],
): Permission => ({
  actions,
  createdAt: now,
  id,
  name,
  updatedAt: now,
});
const grant = (
  roleId: string,
  permissionId: string,
  actions: string[],
): Grant => ({
  actions,
  createdAt: now,
  id: `${roleId}-${permissionId}`,
  permissionId,
  roleId,
  updatedAt: now,
});

const config: RbacConfiguration = {
  grants: [
    grant('admin', 'p-rbac', []),
    grant('editor', 'p-docs', ['update']),
    grant('user', 'p-docs', ['read']),
  ],
  permissions: [
    permission('p-rbac', 'rbac', ['manage']),
    permission('p-docs', 'docs', ['delete', 'read', 'update']),
  ],
  roles: [
    role('admin', 'admin'),
    role('editor', 'editor'),
    role('user', 'user'),
  ],
};

function service(
  repository: Partial<Record<keyof RbacRepository, jest.Mock>>,
): RbacService {
  return new RbacService(repository as unknown as RbacRepository);
}

describe('RbacService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('can (Notion "RBAC" 1.3.1)', () => {
    const rbac = service({
      loadConfiguration: jest.fn().mockResolvedValue(config),
    });

    beforeAll(async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      await rbac.reload('test');
    });

    it('allows every action of a grant without actions', () => {
      expect(rbac.can(['admin'], 'rbac', 'manage')).toBe(true);
    });

    it('allows only the listed actions of a grant with actions', () => {
      expect(rbac.can(['editor'], 'docs', 'update')).toBe(true);
      expect(rbac.can(['editor'], 'docs', 'delete')).toBe(false);
    });

    it('adds the implicit user role to everyone', () => {
      expect(rbac.can([], 'docs', 'read')).toBe(true);
      expect(rbac.can([], 'rbac', 'manage')).toBe(false);
    });

    it('refuses unknown permissions, actions and roles', () => {
      expect(rbac.can(['admin'], 'nope', 'manage')).toBe(false);
      expect(rbac.can(['admin'], 'rbac', 'nope')).toBe(false);
      expect(rbac.can(['ghost'], 'docs', 'update')).toBe(false);
    });

    it('covers an account only when the actor holds every right it holds (P7)', () => {
      // admin holds rbac@manage and, through the implicit user role, docs@read.
      expect(rbac.covers(['admin'], ['editor'])).toBe(false);
      expect(rbac.covers(['editor'], ['admin'])).toBe(false);
      expect(rbac.covers(['editor'], [])).toBe(true);
      expect(rbac.covers(['editor'], ['editor'])).toBe(true);
      expect(rbac.covers([], ['editor'])).toBe(false);
      expect(rbac.covers(['admin', 'editor'], ['editor'])).toBe(true);
    });

    it('recognises the protected grant', () => {
      expect(
        rbac.isProtectedGrant({ permissionId: 'p-rbac', roleId: 'admin' }),
      ).toBe(true);
      expect(
        rbac.isProtectedGrant({ permissionId: 'p-docs', roleId: 'admin' }),
      ).toBe(false);
    });
  });

  it('denies everything before the first load', () => {
    expect(service({}).can(['admin'], 'rbac', 'manage')).toBe(false);
  });

  it('ignores grants of a permission that is not in the configuration', () => {
    const snapshot = buildSnapshot({
      ...config,
      grants: [grant('admin', 'p-missing', [])],
    });

    expect(snapshot.grants.size).toBe(0);
  });

  it('runs reloads one after another, so the last one wins', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const first = new Promise<RbacConfiguration>((resolve) => {
      release = () => {
        order.push('first');
        resolve({ ...config, grants: [] });
      };
    });
    const loadConfiguration = jest
      .fn()
      .mockReturnValueOnce(first)
      .mockImplementationOnce(() => {
        order.push('second');
        return Promise.resolve(config);
      });
    const rbac = service({ loadConfiguration });

    const a = rbac.reload('a');
    const b = rbac.reload('b');
    release();
    await Promise.all([a, b]);

    expect(order).toEqual(['first', 'second']);
    expect(rbac.can(['admin'], 'rbac', 'manage')).toBe(true);
  });

  it('keeps a saved change from failing when the reload fails, and retries', async () => {
    jest.useFakeTimers();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const loadConfiguration = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(config);
    const rbac = service({ loadConfiguration });

    await expect(
      rbac.reloadAfterChange('role create'),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'role create' }),
      'rbac reload failed; retrying',
    );
    await jest.advanceTimersByTimeAsync(1_000);

    expect(loadConfiguration).toHaveBeenCalledTimes(2);
    expect(rbac.can(['admin'], 'rbac', 'manage')).toBe(true);
    jest.useRealTimers();
  });

  describe('ensureSystemConfiguration', () => {
    function repository(
      existing: Permission[],
      grants: Grant[] = [],
    ): Record<string, jest.Mock> {
      const created: Permission[] = [];
      return {
        createGrant: jest.fn().mockResolvedValue(undefined),
        createPermission: jest.fn(
          (input: { actions: string[]; name: string }) => {
            const made = permission(
              `p-${input.name}`,
              input.name,
              input.actions,
            );
            created.push(made);
            return Promise.resolve(made);
          },
        ),
        deleteGrant: jest.fn().mockResolvedValue(undefined),
        ensureRoles: jest.fn().mockResolvedValue(undefined),
        findPermissionByName: jest.fn((name: string) =>
          Promise.resolve(
            [...existing, ...created].find((p) => p.name === name) ?? null,
          ),
        ),
        findRoleByName: jest.fn().mockResolvedValue(role('admin', 'admin')),
        grantsOfPermission: jest.fn().mockResolvedValue(grants),
        updateGrant: jest.fn().mockResolvedValue(undefined),
        updatePermission: jest.fn().mockResolvedValue(undefined),
        upsertGrant: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('creates missing permissions with an admin grant and keeps admin → rbac', async () => {
      const repo = repository([]);

      await service(repo).ensureSystemConfiguration();

      expect(repo.ensureRoles).toHaveBeenCalledWith([
        expect.objectContaining({ name: 'admin' }),
        expect.objectContaining({ name: 'user' }),
      ]);
      expect(repo.createPermission).toHaveBeenCalledTimes(4);
      expect(repo.createGrant).toHaveBeenCalledTimes(4);
      expect(repo.upsertGrant).toHaveBeenCalledWith('admin', 'p-rbac');
    });

    it('brings the actions of an existing permission in line with the code, without re-granting', async () => {
      const repo = repository([
        permission('p-users', 'users', ['read']),
        permission('p-rbac', 'rbac', ['manage']),
        permission('p-settings', 'settings', ['manage']),
        permission('p-transformations', 'transformations', [
          'history',
          'download',
        ]),
      ]);

      await service(repo).ensureSystemConfiguration();

      expect(repo.createPermission).not.toHaveBeenCalled();
      expect(repo.createGrant).not.toHaveBeenCalled();
      expect(repo.updatePermission).toHaveBeenCalledTimes(1);
      expect(repo.updatePermission).toHaveBeenCalledWith('p-users', {
        actions: ['delete', 'list', 'read', 'update'],
        name: 'users',
      });
    });

    it('strips removed actions from grants, removing a grant left with none', async () => {
      const repo = repository(
        [
          permission('p-users', 'users', ['read', 'export']),
          permission('p-rbac', 'rbac', ['manage']),
          permission('p-settings', 'settings', ['manage']),
          permission('p-transformations', 'transformations', [
            'history',
            'download',
          ]),
        ],
        [
          grant('all', 'p-users', []),
          grant('mixed', 'p-users', ['read', 'export']),
          grant('gone', 'p-users', ['export']),
        ],
      );
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await service(repo).ensureSystemConfiguration();

      expect(repo.updateGrant).toHaveBeenCalledWith('mixed-p-users', {
        actions: ['read'],
        permissionId: 'p-users',
        roleId: 'mixed',
      });
      expect(repo.deleteGrant).toHaveBeenCalledWith('gone-p-users');
      expect(repo.updateGrant).toHaveBeenCalledTimes(1);
    });

    it('fails loudly without the admin role', async () => {
      const repo = repository([]);
      repo.findRoleByName?.mockResolvedValue(null);

      await expect(service(repo).ensureSystemConfiguration()).rejects.toThrow(
        'the admin role is missing',
      );
    });
  });

  it('comes up with the database down, denies everything, and loads once it is back', async () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const rbac = service({
      createGrant: jest.fn().mockResolvedValue(undefined),
      createPermission: jest.fn((input: { actions: string[]; name: string }) =>
        Promise.resolve(
          permission(`p-${input.name}`, input.name, input.actions),
        ),
      ),
      ensureRoles: jest
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue(undefined),
      findPermissionByName: jest.fn((name: string) =>
        Promise.resolve(
          config.permissions.find((p) => p.name === name) ?? null,
        ),
      ),
      findRoleByName: jest.fn().mockResolvedValue(role('admin', 'admin')),
      loadConfiguration: jest.fn().mockResolvedValue(config),
      updatePermission: jest.fn().mockResolvedValue(undefined),
      upsertGrant: jest.fn().mockResolvedValue(undefined),
    });

    await expect(rbac.onModuleInit()).resolves.toBeUndefined();
    expect(rbac.can(['admin'], 'rbac', 'manage')).toBe(false);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(rbac.can(['admin'], 'rbac', 'manage')).toBe(true);
    jest.useRealTimers();
  });

  it('stops retrying once the module is destroyed', async () => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const loadConfiguration = jest.fn().mockRejectedValue(new Error('db down'));
    const rbac = service({ loadConfiguration });

    await rbac.reloadAfterChange('role create');
    rbac.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5_000);

    expect(loadConfiguration).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('backs off between retries and logs only the first failure as an error', async () => {
    jest.useFakeTimers();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const loadConfiguration = jest.fn().mockRejectedValue(new Error('db down'));
    const rbac = service({ loadConfiguration });

    await rbac.reloadAfterChange('x');
    await jest.advanceTimersByTimeAsync(1_000); // 2nd attempt
    await jest.advanceTimersByTimeAsync(1_000); // too early for the 3rd (2 s)
    expect(loadConfiguration).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_000); // 3rd
    expect(loadConfiguration).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    rbac.onModuleDestroy();
    jest.useRealTimers();
  });
});
