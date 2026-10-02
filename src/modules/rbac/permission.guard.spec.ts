import { type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequiredPermission } from '@/common/decorators';
import { ErrorCode } from '@/common/errors';

import { PermissionGuard } from './permission.guard';
import type { RbacService } from './rbac.service';

function contextFor(request: object): ExecutionContext {
  return {
    getClass: () => Object,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function setup(
  required: RequiredPermission | undefined,
  allowed: boolean,
): { can: jest.Mock; guard: PermissionGuard } {
  const can = jest.fn().mockReturnValue(allowed);
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  return {
    can,
    guard: new PermissionGuard(reflector, { can } as unknown as RbacService),
  };
}

const user = { id: 'u1', roleIds: ['r1'] };
const required = { action: 'manage', permission: 'rbac' };

describe('PermissionGuard', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lets routes without a permission through', () => {
    const { can, guard } = setup(undefined, false);

    expect(guard.canActivate(contextFor({ user }))).toBe(true);
    expect(can).not.toHaveBeenCalled();
  });

  it("checks the caller's roles against the required permission", () => {
    const { can, guard } = setup(required, true);

    expect(guard.canActivate(contextFor({ user }))).toBe(true);
    expect(can).toHaveBeenCalledWith(['r1'], 'rbac', 'manage');
  });

  it('answers 403 AUTH_FORBIDDEN and logs actor, permission and result', () => {
    const { guard } = setup(required, false);

    expect(() =>
      guard.canActivate(
        contextFor({ method: 'GET', path: '/api/admin/rbac/roles', user }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.AUTH_FORBIDDEN,
        status: 403,
      }) as Error,
    );
    expect(warn).toHaveBeenCalledWith(
      {
        action: 'manage',
        actorUserId: 'u1',
        method: 'GET',
        path: '/api/admin/rbac/roles',
        permission: 'rbac',
        result: 403,
      },
      'permission denied',
    );
  });

  it('fails closed with 401 when no user is on the request', () => {
    const { guard } = setup(required, true);

    expect(() => guard.canActivate(contextFor({}))).toThrow(
      expect.objectContaining({ status: 401 }) as Error,
    );
  });
});
