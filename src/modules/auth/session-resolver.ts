import { Injectable } from '@nestjs/common';

import { type SessionUser, UsersService } from '@/modules/users';

import {
  SessionTokenService,
  type TokenFailure,
  type TokenType,
} from './session-tokens';

export type SessionFailure =
  'inactive' | 'revoked' | 'user_not_found' | TokenFailure;

export type ResolvedSession =
  | { failure: SessionFailure; ok: false; userId?: string }
  | { ok: true; user: SessionUser };

// Token → user, shared by the access guard and refresh (Notion "Авторизация" 1.3.1 steps 2–4).
// The user must still exist, be active and carry the token's version: deleting the account or
// revoking its sessions (token_version + 1) ends every token at once without storing any of
// them (decision A2).
@Injectable()
export class SessionResolver {
  constructor(
    private readonly tokens: SessionTokenService,
    private readonly users: UsersService,
  ) {}

  async resolve(
    type: TokenType,
    token: string | undefined,
  ): Promise<ResolvedSession> {
    const verified = await this.tokens.verify(type, token);
    if (!verified.ok) return verified;
    const { id, tokenVersion } = verified.subject;
    const user = await this.users.findSessionUser(id);
    if (!user) return { failure: 'user_not_found', ok: false, userId: id };
    if (user.status !== 'active') {
      return { failure: 'inactive', ok: false, userId: id };
    }
    if (user.tokenVersion !== tokenVersion) {
      return { failure: 'revoked', ok: false, userId: id };
    }
    return { ok: true, user };
  }
}
