import { Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { z } from 'zod';

import { AppConfig } from '@/config';

export const JWT_ISSUER = 'file-converter-api';
export const JWT_AUDIENCE = 'file-converter';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionSubject {
  id: string;
  tokenVersion: number;
}

export type TokenType = 'access' | 'refresh';

// Why a token was refused — for the audit log only, never sent to the client (Notion
// "Авторизация" 1.5: the reason without the token).
export type TokenFailure = 'expired' | 'invalid' | 'missing' | 'wrong_type';

export type VerifiedToken =
  { failure: TokenFailure; ok: false } | { ok: true; subject: SessionSubject };

// exp is required: jsonwebtoken checks it only when present (Notion "Авторизация" 1.3.1).
const claimsSchema = z.object({
  exp: z.number().int(),
  iat: z.number().int(),
  sub: z.uuid(),
  typ: z.enum(['access', 'refresh']),
  ver: z.number().int().min(0),
});

// Two HS256 JWTs signed with different secrets (09-auth, Notion "Авторизация"): access 15 min,
// refresh 30 days. `ver` carries the user's token_version for server-side revocation
// (decision A2); nothing about either token is stored.
@Injectable()
export class SessionTokenService {
  constructor(
    private readonly config: AppConfig,
    private readonly jwt: JwtService,
  ) {}

  async issue(subject: SessionSubject): Promise<SessionTokens> {
    const { auth } = this.config;
    const claims = { sub: subject.id, ver: subject.tokenVersion };
    const common = {
      algorithm: 'HS256' as const,
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { ...claims, typ: 'access' },
        {
          ...common,
          expiresIn: auth.accessTtlSeconds,
          secret: auth.accessSecret,
        },
      ),
      this.jwt.signAsync(
        { ...claims, typ: 'refresh' },
        {
          ...common,
          expiresIn: auth.refreshTtlSeconds,
          secret: auth.refreshSecret,
        },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  // Signature with the secret of its own type, HS256 only, exp/nbf, iss, aud, then the claims
  // (Notion "Авторизация" 1.3.1). An access token is never accepted as a refresh token or back.
  async verify(
    type: TokenType,
    token: string | undefined,
  ): Promise<VerifiedToken> {
    if (!token) return { failure: 'missing', ok: false };
    const { auth } = this.config;
    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
        secret: type === 'access' ? auth.accessSecret : auth.refreshSecret,
      });
    } catch (error: unknown) {
      return {
        failure: error instanceof TokenExpiredError ? 'expired' : 'invalid',
        ok: false,
      };
    }
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return { failure: 'invalid', ok: false };
    if (claims.data.typ !== type) return { failure: 'wrong_type', ok: false };
    return {
      ok: true,
      subject: { id: claims.data.sub, tokenVersion: claims.data.ver },
    };
  }
}
