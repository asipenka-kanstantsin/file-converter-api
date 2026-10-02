import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

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
}
