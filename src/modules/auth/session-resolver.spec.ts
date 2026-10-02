import type { SessionUser, UsersService } from '@/modules/users';

import { SessionResolver } from './session-resolver';
import type { SessionTokenService, VerifiedToken } from './session-tokens';

const user: SessionUser = {
  createdAt: new Date(),
  displayName: null,
  email: 'jane@example.com',
  id: 'u1',
  lastLoginAt: null,
  photoFileId: null,
  roleIds: ['r1'],
  status: 'active',
  tokenVersion: 2,
};

const valid: VerifiedToken = {
  ok: true,
  subject: { id: user.id, tokenVersion: 2 },
};

function resolver(
  verified: VerifiedToken,
  found: SessionUser | null,
): { findById: jest.Mock; resolver: SessionResolver } {
  const findById = jest.fn().mockResolvedValue(found);
  return {
    findById,
    resolver: new SessionResolver(
      {
        verify: () => Promise.resolve(verified),
      } as unknown as SessionTokenService,
      { findSessionUser: findById } as unknown as UsersService,
    ),
  };
}

describe('SessionResolver', () => {
  it('resolves an active user whose version matches', async () => {
    await expect(
      resolver(valid, user).resolver.resolve('access', 't'),
    ).resolves.toEqual({ ok: true, user });
  });

  it('passes token failures through without a lookup', async () => {
    const failed: VerifiedToken = { failure: 'expired', ok: false };
    const subject = resolver(failed, user);

    await expect(subject.resolver.resolve('access', 't')).resolves.toEqual(
      failed,
    );
    expect(subject.findById).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'user_not_found'],
    [{ ...user, status: 'pending_verification' as const }, 'inactive'],
    [{ ...user, tokenVersion: 3 }, 'revoked'],
  ])('refuses %#: %s', async (found, failure) => {
    await expect(
      resolver(valid, found).resolver.resolve('refresh', 't'),
    ).resolves.toEqual({ failure, ok: false, userId: user.id });
  });
});
