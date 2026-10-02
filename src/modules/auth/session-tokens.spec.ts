import { JwtService } from '@nestjs/jwt';

import type { AppConfig } from '@/config';

import { PasswordHasher } from './password-hasher';
import { SessionTokenService } from './session-tokens';

const auth = {
  accessSecret: 'a'.repeat(32),
  accessTtlSeconds: 900,
  refreshSecret: 'r'.repeat(32),
  refreshTtlSeconds: 2_592_000,
};

describe('SessionTokenService', () => {
  const jwt = new JwtService();
  const service = new SessionTokenService({ auth } as AppConfig, jwt);

  it('signs access and refresh with their own secrets, HS256, iss/aud and ver', async () => {
    const { accessToken, refreshToken } = await service.issue({
      id: 'u1',
      tokenVersion: 3,
    });
    const options = {
      algorithms: ['HS256' as const],
      audience: 'file-converter',
      issuer: 'file-converter-api',
    };

    const access = await jwt.verifyAsync<Record<string, unknown>>(accessToken, {
      ...options,
      secret: auth.accessSecret,
    });
    const refresh = await jwt.verifyAsync<Record<string, unknown>>(
      refreshToken,
      {
        ...options,
        secret: auth.refreshSecret,
      },
    );

    expect(access).toMatchObject({ sub: 'u1', typ: 'access', ver: 3 });
    expect(Number(access.exp) - Number(access.iat)).toBe(900);
    expect(refresh).toMatchObject({ sub: 'u1', typ: 'refresh', ver: 3 });
    expect(Number(refresh.exp) - Number(refresh.iat)).toBe(2_592_000);
    await expect(
      jwt.verifyAsync(accessToken, { secret: auth.refreshSecret }),
    ).rejects.toThrow();
    await expect(
      jwt.verifyAsync(refreshToken, { secret: auth.accessSecret }),
    ).rejects.toThrow();
  });

  describe('verify', () => {
    const subject = {
      id: '0b9a6c1e-3f4d-4e5a-9b8c-7d6e5f4a3b2c',
      tokenVersion: 3,
    };
    const sign = (payload: object, options: object = {}): string =>
      jwt.sign(payload, {
        algorithm: 'HS256',
        audience: 'file-converter',
        expiresIn: 60,
        issuer: 'file-converter-api',
        secret: auth.accessSecret,
        ...options,
      });

    it('accepts each token only as its own type', async () => {
      const { accessToken, refreshToken } = await service.issue(subject);

      await expect(service.verify('access', accessToken)).resolves.toEqual({
        ok: true,
        subject,
      });
      await expect(service.verify('refresh', refreshToken)).resolves.toEqual({
        ok: true,
        subject,
      });
      // Signed with the other secret: invalid before the type is even read.
      await expect(service.verify('refresh', accessToken)).resolves.toEqual({
        failure: 'invalid',
        ok: false,
      });
    });

    it('names the failure', async () => {
      const valid = { sub: subject.id, typ: 'access', ver: 3 };
      const cases: [string | undefined, string][] = [
        [undefined, 'missing'],
        ['', 'missing'],
        ['not.a.jwt', 'invalid'],
        [sign(valid, { expiresIn: -10 }), 'expired'],
        [sign(valid, { secret: 'x'.repeat(32) }), 'invalid'],
        [sign(valid, { issuer: 'someone-else' }), 'invalid'],
        [sign(valid, { audience: 'other-app' }), 'invalid'],
        [sign(valid, { algorithm: 'HS512' }), 'invalid'],
        [sign({ ...valid, sub: 'u1' }), 'invalid'],
        [sign({ sub: subject.id, typ: 'access' }), 'invalid'],
        [sign({ ...valid, typ: 'refresh' }), 'wrong_type'],
        [
          jwt.sign(valid, {
            algorithm: 'HS256',
            audience: 'file-converter',
            issuer: 'file-converter-api',
            secret: auth.accessSecret,
          }),
          'invalid',
        ],
        [sign(valid, { noTimestamp: true }), 'invalid'],
      ];
      for (const [token, failure] of cases) {
        await expect(service.verify('access', token)).resolves.toEqual({
          failure,
          ok: false,
        });
      }
    });

    it('refuses an unsigned token', async () => {
      const header = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
        'base64url',
      );
      const body = Buffer.from(
        JSON.stringify({
          aud: 'file-converter',
          exp: Math.floor(Date.now() / 1000) + 60,
          iss: 'file-converter-api',
          sub: subject.id,
          typ: 'access',
          ver: 3,
        }),
      ).toString('base64url');

      await expect(
        service.verify('access', `${header}.${body}.`),
      ).resolves.toEqual({ failure: 'invalid', ok: false });
    });
  });
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  beforeAll(async () => {
    await hasher.onModuleInit();
  });

  it('hashes with argon2id and verifies the right password only', async () => {
    const hash = await hasher.hash('secret-pass-1');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(hash, 'secret-pass-1')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'other-pass-1')).resolves.toBe(false);
  });

  it('returns false for an unknown account, even for the dummy password', async () => {
    await expect(
      hasher.verify(undefined, 'dummy-password-for-timing-1'),
    ).resolves.toBe(false);
  });
});
