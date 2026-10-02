import { type ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '@/common/decorators';
import { ErrorCode } from '@/common/errors';
import type { SessionUser } from '@/modules/users';

import { JwtAuthGuard } from './jwt-auth.guard';
import type { ResolvedSession, SessionResolver } from './session-resolver';

const user = { id: 'u1', roleIds: ['r1'] } as SessionUser;

function contextFor(request: object): ExecutionContext {
  return {
    getClass: () => Object,
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function setup(
  resolved: ResolvedSession,
  isPublic = false,
): { guard: JwtAuthGuard; resolve: jest.Mock } {
  const resolve = jest.fn().mockResolvedValue(resolved);
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic);
  return {
    guard: new JwtAuthGuard(reflector, {
      resolve,
    } as unknown as SessionResolver),
    resolve,
  };
}

describe('JwtAuthGuard', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lets @Public() routes through without reading a token', async () => {
    const { guard, resolve } = setup({ failure: 'missing', ok: false }, true);

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('puts the user id on the request for a valid access cookie', async () => {
    const { guard, resolve } = setup({ ok: true, user });
    const request: Partial<AuthenticatedRequest> = {
      cookies: { access_token: 'jwt' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('access', 'jwt');
    expect(request.user).toEqual({ id: 'u1', roleIds: ['r1'] });
  });

  it('answers 401 AUTH_UNAUTHENTICATED and logs the reason, not the token', async () => {
    const { guard, resolve } = setup({
      failure: 'revoked',
      ok: false,
      userId: 'u1',
    });
    const request: Partial<AuthenticatedRequest> = {
      cookies: { access_token: 'secret.jwt.value' },
      method: 'GET',
      path: '/api/me',
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      code: ErrorCode.AUTH_UNAUTHENTICATED,
      status: 401,
    });
    expect(resolve).toHaveBeenCalledWith('access', 'secret.jwt.value');
    expect(warn).toHaveBeenCalledWith(
      { method: 'GET', path: '/api/me', reason: 'revoked', userId: 'u1' },
      'access denied',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret.jwt.value');
    expect(request.user).toBeUndefined();
  });

  it('treats a missing or non-string cookie as no token, logged at debug only', async () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const { guard, resolve } = setup({ failure: 'missing', ok: false });

    await expect(
      guard.canActivate(contextFor({ cookies: { access_token: ['a', 'b'] } })),
    ).rejects.toMatchObject({ status: 401 });
    await expect(guard.canActivate(contextFor({}))).rejects.toMatchObject({
      status: 401,
    });
    expect(resolve).toHaveBeenNthCalledWith(1, 'access', undefined);
    expect(resolve).toHaveBeenNthCalledWith(2, 'access', undefined);
    expect(debug).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
