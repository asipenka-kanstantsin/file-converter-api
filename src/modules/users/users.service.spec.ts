import { AppException, ErrorCode } from '@/common/errors';

import type { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import type { User } from './users.types';

const user: User = {
  createdAt: new Date(),
  email: 'jane@example.com',
  id: 'u1',
  status: 'active',
  tokenVersion: 0,
};

function service(repository: Partial<UsersRepository>): UsersService {
  return new UsersService(repository as UsersRepository);
}

describe('UsersService', () => {
  it('returns an already active user when activation changed nothing', async () => {
    const result = service({
      activate: () => Promise.resolve(null),
      findById: () => Promise.resolve(user),
    }).activate('u1');

    await expect(result).resolves.toBe(user);
  });

  it('treats activation of a vanished user as an invalid challenge', async () => {
    const result = service({
      activate: () => Promise.resolve(null),
      findById: () => Promise.resolve(null),
    }).activate('u1');

    await expect(result).rejects.toBeInstanceOf(AppException);
    await expect(result).rejects.toMatchObject({
      code: ErrorCode.AUTH_CHALLENGE_INVALID,
    });
  });

  it('refuses an e-mail that is already registered', async () => {
    const create = jest.fn();
    const result = service({
      create,
      existsByEmail: () => Promise.resolve(true),
    }).create({
      email: user.email,
      passwordHash: 'h',
      status: 'active',
    });

    await expect(result).rejects.toMatchObject({
      code: ErrorCode.USER_EMAIL_TAKEN,
      status: 409,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
