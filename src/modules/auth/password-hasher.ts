import { Injectable } from '@nestjs/common';
import { argon2id, hash } from 'argon2';

// argon2id with the library defaults (Notion "Хранение пароля"): the salt is generated and
// embedded in the hash string.
@Injectable()
export class PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }
}
