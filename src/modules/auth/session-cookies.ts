import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { AppConfig } from '@/config';

import type { SessionTokens } from './session-tokens';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
// Ties a pending sign-in to the browser that started it (decision A17): the magic link only
// signs in where this cookie names the same challenge.
export const LOGIN_BINDING_COOKIE = 'login_challenge';

const CONFIRM_PATH = '/api/auth/confirm';

// One place that writes the auth cookies (09-auth → Cookies): HttpOnly, SameSite=Lax, Max-Age equal
// to the token TTL, the refresh cookie scoped to the refresh endpoint only.
@Injectable()
export class SessionCookies {
  constructor(private readonly config: AppConfig) {}

  bindLogin(response: Response, challengeId: string): void {
    response.cookie(LOGIN_BINDING_COOKIE, challengeId, {
      ...this.base(CONFIRM_PATH),
      maxAge: this.config.confirmation.ttlSeconds * 1000,
    });
  }

  clearLoginBinding(response: Response): void {
    response.clearCookie(LOGIN_BINDING_COOKIE, this.base(CONFIRM_PATH));
  }

  set(response: Response, tokens: SessionTokens): void {
    const { auth } = this.config;
    // A response that sets a session must never be stored by a cache (19-security).
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...this.base('/api'),
      maxAge: auth.accessTtlSeconds * 1000,
    });
    response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.base('/api/auth/refresh'),
      maxAge: auth.refreshTtlSeconds * 1000,
    });
  }

  private base(path: string): CookieOptions {
    return {
      httpOnly: true,
      path,
      sameSite: 'lax',
      secure: this.config.auth.cookieSecure,
    };
  }
}
