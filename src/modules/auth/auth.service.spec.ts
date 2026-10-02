import { Logger } from '@nestjs/common';

import { ErrorCode } from '@/common/errors';
import type { AppConfig } from '@/config';
import type { SettingsService } from '@/modules/settings';
import type { User, UsersService } from '@/modules/users';

import { AuthService } from './auth.service';
import type { ChallengesService } from './challenges.service';
import type { Challenge } from './challenges.types';
import { LoginLockout } from './login-lockout';
import type { PasswordHasher } from './password-hasher';
import type { ResolvedSession, SessionResolver } from './session-resolver';
import type { SessionTokenService } from './session-tokens';

jest.mock('@nestjs-cls/transactional', () => ({
  Transactional:
    () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) =>
      descriptor,
}));

const user: User = {
  createdAt: new Date(),
  displayName: null,
  email: 'jane@example.com',
  id: 'u1',
  lastLoginAt: null,
  status: 'active',
  tokenVersion: 2,
};
const session = { accessToken: 'a', refreshToken: 'r' };
const config = {
  confirmation: { ttlSeconds: 600 },
  throttle: { loginBlockSeconds: 900, loginLimit: 5, ttlSeconds: 60 },
} as AppConfig;

function challenge(overrides: Partial<Challenge>): Challenge {
  return {
    attempts: 0,
    codeHash: '',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    id: 'c1',
    lastSentAt: new Date(),
    purpose: 'login',
    tokenVersion: 2,
    user: { email: user.email, id: user.id },
    ...overrides,
  };
}

function setup(options: {
  credentials?: { passwordHash: string; user: User } | null;
  loginConfirmation?: boolean;
  passwordValid?: boolean;
  resolved?: ResolvedSession;
  verified?: Challenge;
  verify?: () => Promise<boolean>;
}): {
  lockout: LoginLockout;
  service: AuthService;
  users: Record<
    'activate' | 'findCredentialsByEmail' | 'getActive' | 'recordLogin',
    jest.Mock
  >;
} {
  const users = {
    activate: jest.fn().mockResolvedValue(user),
    findCredentialsByEmail: jest
      .fn()
      .mockResolvedValue(options.credentials ?? null),
    getActive: jest.fn().mockResolvedValue(user),
    recordLogin: jest.fn().mockResolvedValue(undefined),
  };
  const challenges = {
    consume: jest.fn().mockResolvedValue(undefined),
    issue: jest
      .fn()
      .mockResolvedValue({ challengeId: 'c1', expiresAt: new Date() }),
    verifyCode: jest.fn().mockResolvedValue(options.verified),
    verifyToken: jest.fn().mockResolvedValue(options.verified),
  };
  const lockout = new LoginLockout(config);
  const service = new AuthService(
    challenges as unknown as ChallengesService,
    config,
    lockout,
    {
      verify:
        options.verify ??
        (() => Promise.resolve(options.passwordValid ?? false)),
    } as unknown as PasswordHasher,
    {
      resolve: () =>
        Promise.resolve(options.resolved ?? { failure: 'missing', ok: false }),
    } as unknown as SessionResolver,
    { issue: () => Promise.resolve(session) } as unknown as SessionTokenService,
    {
      isEnabled: () => Promise.resolve(options.loginConfirmation ?? false),
    } as unknown as SettingsService,
    users as unknown as UsersService,
  );
  return { lockout, service, users };
}

const input = { email: user.email, password: 'secret-pass-1' };

describe('AuthService', () => {
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

  describe('login', () => {
    it('signs in, records the login and logs it without the e-mail', async () => {
      const { service, users } = setup({
        credentials: { passwordHash: 'h', user },
        passwordValid: true,
      });

      await expect(service.login(input, '1.2.3.4')).resolves.toEqual({
        kind: 'signed_in',
        session,
        user,
      });
      expect(users.recordLogin).toHaveBeenCalledWith('u1');
      expect(log).toHaveBeenCalledWith({ userId: 'u1' }, 'login succeeded');
      expect(JSON.stringify(log.mock.calls)).not.toContain(user.email);
    });

    it.each([
      ['unknown e-mail', null, false],
      ['wrong password', { passwordHash: 'h', user }, false],
    ])(
      'answers 401 for an %s and counts the failure',
      async (_label, credentials, valid) => {
        const { lockout, service } = setup({
          credentials,
          passwordValid: valid,
        });
        const fail = jest.fn();
        jest
          .spyOn(lockout, 'begin')
          .mockReturnValue({ fail, release: jest.fn(), succeed: jest.fn() });

        await expect(service.login(input, '1.2.3.4')).rejects.toMatchObject({
          code: ErrorCode.AUTH_INVALID_CREDENTIALS,
          status: 401,
        });
        expect(lockout.begin).toHaveBeenCalledWith('1.2.3.4|jane@example.com');
        expect(fail).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: ErrorCode.AUTH_INVALID_CREDENTIALS,
          }),
          'login failed',
        );
      },
    );

    it('answers 403 for an unconfirmed account without counting a failure', async () => {
      const { lockout, service } = setup({
        credentials: {
          passwordHash: 'h',
          user: { ...user, status: 'pending_verification' },
        },
        passwordValid: true,
      });
      const attempt = {
        fail: jest.fn(),
        release: jest.fn(),
        succeed: jest.fn(),
      };
      jest.spyOn(lockout, 'begin').mockReturnValue(attempt);

      await expect(service.login(input, '1.2.3.4')).rejects.toMatchObject({
        code: ErrorCode.AUTH_ACCOUNT_NOT_VERIFIED,
        status: 403,
      });
      expect(attempt.fail).not.toHaveBeenCalled();
      expect(attempt.succeed).toHaveBeenCalledTimes(1);
    });

    it('starts a confirmed sign-in when the flag is on, without a session', async () => {
      const { service, users } = setup({
        credentials: { passwordHash: 'h', user },
        loginConfirmation: true,
        passwordValid: true,
      });

      await expect(service.login(input, '1.2.3.4')).resolves.toMatchObject({
        kind: 'confirmation_required',
      });
      expect(users.recordLogin).not.toHaveBeenCalled();
    });

    it('refuses before touching the database once the pair is blocked', async () => {
      const { lockout, service, users } = setup({});
      for (let i = 0; i < 5; i++)
        lockout.begin('1.2.3.4|jane@example.com').fail();

      await expect(service.login(input, '1.2.3.4')).rejects.toMatchObject({
        code: ErrorCode.RATE_LIMITED,
      });
      expect(users.findCredentialsByEmail).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('issues a new pair for a resolved session', async () => {
      const { service } = setup({
        resolved: { ok: true, user: { ...user, roleIds: [] } },
      });

      await expect(service.refresh('r')).resolves.toEqual(session);
      expect(log).toHaveBeenCalledWith(
        { userId: user.id },
        'session refreshed',
      );
    });

    it('refuses with AUTH_REFRESH_INVALID and logs the reason, not the token', async () => {
      const { service } = setup({
        resolved: { failure: 'revoked', ok: false, userId: user.id },
      });

      await expect(service.refresh('secret.jwt.value')).rejects.toMatchObject({
        code: ErrorCode.AUTH_REFRESH_INVALID,
        status: 401,
      });
      expect(warn).toHaveBeenCalledWith(
        { reason: 'revoked', userId: user.id },
        'refresh failed',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret.jwt.value');
    });
  });

  describe('login under parallel load', () => {
    it('lets at most loginLimit concurrent guesses reach the password check', async () => {
      let started = 0;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { service } = setup({
        credentials: null,
        verify: async () => {
          started += 1;
          await gate;
          return false;
        },
      });

      const results = Promise.allSettled(
        Array.from({ length: 12 }, () => service.login(input, '1.2.3.4')),
      );
      await new Promise((resolve) => setImmediate(resolve));
      release();
      const settled = await results;

      expect(started).toBe(5);
      const codes = settled.map((result) =>
        result.status === 'rejected'
          ? (result.reason as { code: ErrorCode }).code
          : undefined,
      );
      expect(
        codes.filter((code) => code === ErrorCode.AUTH_INVALID_CREDENTIALS),
      ).toHaveLength(5);
      expect(
        codes.filter((code) => code === ErrorCode.RATE_LIMITED),
      ).toHaveLength(7);
    });

    it('frees the slot when the lookup itself fails', async () => {
      const { lockout, service, users } = setup({});
      users.findCredentialsByEmail.mockRejectedValue(new Error('db down'));
      const attempt = {
        fail: jest.fn(),
        release: jest.fn(),
        succeed: jest.fn(),
      };
      jest.spyOn(lockout, 'begin').mockReturnValue(attempt);

      await expect(service.login(input, '1.2.3.4')).rejects.toThrow('db down');
      expect(attempt.release).toHaveBeenCalled();
      expect(attempt.fail).not.toHaveBeenCalled();
    });
  });

  describe('confirmation by purpose', () => {
    it('a login challenge records the login and returns a session', async () => {
      const { service, users } = setup({
        verified: challenge({ purpose: 'login' }),
      });

      await expect(service.confirmWithCode('c1', '123456')).resolves.toEqual({
        session,
        user,
      });
      expect(users.recordLogin).toHaveBeenCalledWith('u1');
      expect(users.activate).not.toHaveBeenCalled();
    });

    it('a registration challenge activates and returns no session', async () => {
      const { service, users } = setup({
        verified: challenge({ purpose: 'registration', tokenVersion: null }),
      });

      await expect(service.confirmWithCode('c1', '123456')).resolves.toEqual({
        user,
      });
      expect(users.activate).toHaveBeenCalledWith('u1');
      expect(users.recordLogin).not.toHaveBeenCalled();
    });

    it('voids a login challenge issued under an older token version', async () => {
      const { service } = setup({ verified: challenge({ tokenVersion: 1 }) });

      await expect(
        service.confirmWithCode('c1', '123456'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_CHALLENGE_INVALID,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: ErrorCode.AUTH_CHALLENGE_INVALID }),
        'confirmation failed',
      );
    });

    it('accepts a sign-in link only from the bound browser', async () => {
      const { service } = setup({ verified: challenge({ id: 'c1' }) });

      await expect(
        service.confirmWithToken('t', 'other'),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_CHALLENGE_OTHER_BROWSER,
        status: 403,
      });
      await expect(
        service.confirmWithToken('t', undefined),
      ).rejects.toMatchObject({
        code: ErrorCode.AUTH_CHALLENGE_OTHER_BROWSER,
      });
      await expect(service.confirmWithToken('t', 'c1')).resolves.toEqual({
        session,
        user,
      });
    });

    it('accepts a registration link from any browser', async () => {
      const { service } = setup({
        verified: challenge({ purpose: 'registration', tokenVersion: null }),
      });

      await expect(service.confirmWithToken('t', undefined)).resolves.toEqual({
        user,
      });
    });
  });
});
