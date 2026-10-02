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
