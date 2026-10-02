import type { ExecutionContext } from '@nestjs/common';

import { AppException } from '@/common/errors';

import { csrfCookieOptions, CsrfGuard, newCsrfToken } from './csrf';

function context(
  method: string,
  cookie?: string,
  header?: string,
): ExecutionContext {
  const request = {
    cookies: cookie === undefined ? {} : { csrf_token: cookie },
    headers: header === undefined ? {} : { 'x-csrf-token': header },
    method,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();
  const token = newCsrfToken();

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets the safe method %s through',
    (method) => {
      expect(guard.canActivate(context(method))).toBe(true);
    },
  );

  it('accepts a header equal to the cookie', () => {
    expect(guard.canActivate(context('POST', token, token))).toBe(true);
  });

  it.each([
    ['no cookie and no header', undefined, undefined],
    ['no header', token, undefined],
    ['no cookie', undefined, token],
    ['a different token of the same length', token, newCsrfToken()],
    ['a shorter token', token, token.slice(1)],
    ['an empty cookie', '', ''],
  ])('rejects %s', (_label, cookie, header) => {
    expect(() => guard.canActivate(context('DELETE', cookie, header))).toThrow(
      AppException,
    );
  });

  it('issues 43-character tokens in a script-readable cookie', () => {
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(csrfCookieOptions(true)).toEqual({
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
  });
});
