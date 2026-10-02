import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException, ErrorCode } from '@/common/errors';
import { AppConfig } from '@/config';

import { UsersRepository } from './users.repository';
import type {
  NewUser,
  SessionUser,
  User,
  UserChanges,
  UserCredentials,
} from './users.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly config: AppConfig,
    private readonly usersRepository: UsersRepository,
  ) {}

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

  // A user who must still be able to sign in: deleted or unconfirmed meanwhile → the pending
  // confirmation is void.
  async getActive(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (user?.status !== 'active') {
      throw new AppException(
        ErrorCode.AUTH_CHALLENGE_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    }
    return user;
  }

  // A taken e-mail is refused here and, for a race, by the unique index (→ USER_EMAIL_TAKEN).
  async update(id: string, changes: UserChanges): Promise<User> {
    if (changes.email !== undefined) {
      const current = await this.usersRepository.findById(id);
      if (
        current?.email !== changes.email &&
        !(await this.isEmailAvailable(changes.email))
      ) {
        throw new AppException(ErrorCode.USER_EMAIL_TAKEN, HttpStatus.CONFLICT);
      }
    }
    return this.usersRepository.update(id, changes);
  }

  // An abandoned registration (A13) does not hold an address against an e-mail change either:
  // it is released first, as a new registration would.
  async isEmailAvailable(email: string): Promise<boolean> {
    const ttlMs = this.config.confirmation.ttlSeconds * 1000;
    await this.usersRepository.deleteStalePending(
      email,
      new Date(Date.now() - ttlMs),
    );
    return !(await this.usersRepository.existsByEmail(email));
  }

  // Null for a missing or deleted account (D1).
  async lockForUpdate(id: string): Promise<User | null> {
    const user = await this.usersRepository.lockForUpdate(id);
    return user?.status === 'deleted' ? null : user;
  }

  // Deletion only: the tombstone too, so a repeated deletion is a no-op, not a 404.
  lockForDeletion(id: string): Promise<User | null> {
    return this.usersRepository.lockForUpdate(id);
  }

  anonymise(id: string): Promise<User> {
    return this.usersRepository.anonymise(id);
  }

  setPhoto(id: string, fileId: null | string): Promise<void> {
    return this.usersRepository.setPhoto(id, fileId);
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findById(id);
  }

  lockForShare(id: string): Promise<User | null> {
    return this.usersRepository.lockForShare(id);
  }

  findSessionUser(id: string): Promise<SessionUser | null> {
    return this.usersRepository.findSessionUser(id);
  }

  findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    return this.usersRepository.findCredentialsByEmail(email);
  }

  recordLogin(id: string): Promise<void> {
    return this.usersRepository.recordLogin(id);
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
