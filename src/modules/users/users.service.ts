import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';

import { UsersRepository } from './users.repository';
import type { NewUser, User } from './users.types';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  // Returns the user active, whether this call or an earlier one activated it.
  async activate(id: string): Promise<User> {
    const user =
      (await this.usersRepository.activate(id)) ??
      (await this.usersRepository.findById(id));
    if (!user) {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    return user;
  }

  // Decision A13: an unconfirmed account cannot hold an e-mail longer than one confirmation
  // window, so nobody can squat someone else's address.
  async releaseStalePending(
    email: string,
    createdBefore: Date,
  ): Promise<boolean> {
    return this.usersRepository.deleteStalePending(email, createdBefore);
  }

  async create(input: NewUser): Promise<User> {
    if (await this.usersRepository.existsByEmail(input.email)) {
      throw new AppException(ErrorCode.USER_EMAIL_TAKEN, HttpStatus.CONFLICT);
    }
    return this.usersRepository.create(input);
  }
}
