import { Injectable, type OnModuleInit } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

// argon2id with the library defaults (Notion "Хранение пароля"): the salt is generated and
// embedded in the hash string.
@Injectable()
export class PasswordHasher implements OnModuleInit {
  private dummyHash = '';

  // A real hash to verify against when the e-mail is unknown, so a sign-in takes the same time
  // whether the account exists or not (09-auth → Account enumeration).
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('dummy-password-for-timing-1');
  }

  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }

  async verify(
    passwordHash: string | undefined,
    password: string,
  ): Promise<boolean> {
    // A value that is not an argon2 hash (an unusable marker) never matches; it must not 500.
    const matches = await verify(
      passwordHash ?? this.dummyHash,
      password,
    ).catch(() => false);
    return passwordHash !== undefined && matches;
  }
}
