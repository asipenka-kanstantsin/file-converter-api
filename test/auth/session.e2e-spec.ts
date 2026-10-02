import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestApp } from '../helpers/app';
import { AppConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';
import { type CsrfClient, csrfClient, uniqueEmail } from '../helpers/http';

const PASSWORD = 'correct-horse-42';
const JWT_OPTIONS = {
  algorithm: 'HS256' as const,
  audience: 'file-converter',
  issuer: 'file-converter-api',
};

function setCookies(res: request.Response): string[] {
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []);
}

function cookie(res: request.Response, name: string): string | undefined {
  return setCookies(res).find((value) => value.startsWith(`${name}=`));
}

function tokenOf(res: request.Response, name: string): string {
  return (cookie(res, name) ?? '').slice(name.length + 1).split(';')[0] ?? '';
}

interface SignedIn {
  client: CsrfClient;
  login: request.Response;
  userId: string;
}

describe('session (access guard, refresh, logout)', () => {
  let app: NestExpressApplication;
  let config: AppConfig;
  let jwt: JwtService;

  beforeAll(async () => {
    app = await createTestApp();
    config = app.get(AppConfig);
    jwt = new JwtService();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signedIn(): Promise<SignedIn> {
    const client = await csrfClient(app);
    const email = uniqueEmail();
    const credentials = { email, password: PASSWORD };
    const registered = await client.agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', client.csrf)
      .send(credentials);
    expect(registered.status).toBe(201);
    const login = await client.agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', client.csrf)
      .send(credentials);
    expect(login.status).toBe(200);
    return {
      client,
      login,
      userId: (registered.body as { user: { id: string } }).user.id,
    };
  }

  function me(accessToken?: string): request.Test {
    const req = request(app.getHttpServer()).get('/api/me');
    return accessToken ? req.set('Cookie', `access_token=${accessToken}`) : req;
  }

  async function refreshWith(
    refreshToken: string | undefined,
  ): Promise<request.Response> {
    // A fresh browser that holds only this refresh token (and the CSRF cookie).
    const { csrf } = await csrfClient(app);
    const cookies = [`csrf_token=${csrf}`];
    if (refreshToken) cookies.push(`refresh_token=${refreshToken}`);
    return request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('X-CSRF-Token', csrf)
      .set('Cookie', cookies.join('; '));
  }

  // Exact attributes: a cookie cleared with another path stays in a real browser.
  function expectSessionCleared(res: request.Response): void {
    expect(cookie(res, 'access_token')).toMatch(
      /^access_token=; Path=\/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/,
    );
    expect(cookie(res, 'refresh_token')).toMatch(
      /^refresh_token=; Path=\/api\/auth\/refresh; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax$/,
    );
  }

  async function bumpTokenVersion(userId: string): Promise<void> {
    await prismaOf(app).user.update({
      data: { tokenVersion: { increment: 1 } },
      where: { id: userId },
    });
  }

  describe('protected route', () => {
    it('serves the signed-in user from the access cookie', async () => {
      const { client, userId } = await signedIn();

      const res = await client.agent.get('/api/me');

      expectContract('get', '/api/me', res);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        user: { id: userId, status: 'active' },
      });
    });

    it('answers 401 AUTH_UNAUTHENTICATED without a cookie', async () => {
      const res = await me();

      expectContract('get', '/api/me', res);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    });

    it('refuses a tampered, foreign, expired or refresh token', async () => {
      const { login, userId } = await signedIn();
      const access = tokenOf(login, 'access_token');
      const refresh = tokenOf(login, 'refresh_token');
      const [header, payload] = access.split('.');
      const forged = Buffer.from(
        JSON.stringify({ ...jwt.decode<object>(access), ver: 99 }),
      ).toString('base64url');
      const claims = { sub: userId, typ: 'access', ver: 0 };

      const tokens = [
        `${header ?? ''}.${forged}.${access.split('.')[2] ?? ''}`,
        `${header ?? ''}.${payload ?? ''}.AAAA`,
        refresh,
        jwt.sign(claims, {
          ...JWT_OPTIONS,
          expiresIn: 60,
          secret: 'x'.repeat(32),
        }),
        jwt.sign(claims, {
          ...JWT_OPTIONS,
          expiresIn: -10,
          secret: config.auth.accessSecret,
        }),
      ];
      for (const token of tokens) {
        const res = await me(token);
        expectContract('get', '/api/me', res);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
      }
    });

    it('ends every session of a user whose token version was bumped', async () => {
      const { client, userId } = await signedIn();
      await bumpTokenVersion(userId);

      const res = await client.agent.get('/api/me');

      expect(res.status).toBe(401);
    });

    it('ends the session of a deleted user, for access and refresh', async () => {
      const { client, login, userId } = await signedIn();
      await prismaOf(app).user.delete({ where: { id: userId } });

      expect((await client.agent.get('/api/me')).status).toBe(401);
      const refreshed = await refreshWith(tokenOf(login, 'refresh_token'));
      expect(refreshed.status).toBe(401);
      expect(refreshed.body).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });

    it('ends the session of a user who is no longer active, for access and refresh', async () => {
      const { client, login, userId } = await signedIn();
      await prismaOf(app).user.update({
        data: { status: 'pending_verification' },
        where: { id: userId },
      });

      expect((await client.agent.get('/api/me')).status).toBe(401);
      expect((await refreshWith(tokenOf(login, 'refresh_token'))).status).toBe(
        401,
      );
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates: a new access and refresh pair, both usable', async () => {
      const { client, login } = await signedIn();
      // JWTs carry second-precision iat/exp: wait so the new pair differs.
      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const res = await client.agent
        .post('/api/auth/refresh')
        .set('X-CSRF-Token', client.csrf);

      expectContract('post', '/api/auth/refresh', res);
      expect(res.status).toBe(204);
      expect(res.headers['cache-control']).toBe('no-store');
      const access = tokenOf(res, 'access_token');
      const refresh = tokenOf(res, 'refresh_token');
      expect(access).not.toBe(tokenOf(login, 'access_token'));
      expect(refresh).not.toBe(tokenOf(login, 'refresh_token'));
      expect(cookie(res, 'access_token')).toMatch(/Max-Age=900; Path=\/api;/);
      expect(cookie(res, 'refresh_token')).toMatch(
        /Max-Age=2592000; Path=\/api\/auth\/refresh;/,
      );
      expect((await me(access)).status).toBe(200);
      expect((await refreshWith(refresh)).status).toBe(204);
    });

    it('keeps an earlier refresh token valid until it expires (nothing is stored)', async () => {
      const { client, login } = await signedIn();
      await client.agent
        .post('/api/auth/refresh')
        .set('X-CSRF-Token', client.csrf)
        .expect(204);

      const res = await refreshWith(tokenOf(login, 'refresh_token'));

      expect(res.status).toBe(204);
    });

    it('answers 401 AUTH_REFRESH_INVALID and clears the cookies without a refresh cookie', async () => {
      const res = await refreshWith(undefined);

      expectContract('post', '/api/auth/refresh', res);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
      expectSessionCleared(res);
    });

    it('refuses an access token, an expired token and a revoked session', async () => {
      const { login, userId } = await signedIn();
      const expired = jwt.sign(
        { sub: userId, typ: 'refresh', ver: 0 },
        { ...JWT_OPTIONS, expiresIn: -10, secret: config.auth.refreshSecret },
      );

      for (const token of [tokenOf(login, 'access_token'), expired]) {
        const res = await refreshWith(token);
        expectContract('post', '/api/auth/refresh', res);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
      }
      await bumpTokenVersion(userId);
      const revoked = await refreshWith(tokenOf(login, 'refresh_token'));
      expect(revoked.status).toBe(401);
      expectSessionCleared(revoked);
    });

    it('requires the CSRF header', async () => {
      const { client } = await signedIn();

      const res = await client.agent.post('/api/auth/refresh');

      expectContract('post', '/api/auth/refresh', res);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the session cookies, so the browser is signed out', async () => {
      const { client } = await signedIn();

      const res = await client.agent
        .post('/api/auth/logout')
        .set('X-CSRF-Token', client.csrf);

      expectContract('post', '/api/auth/logout', res);
      expect(res.status).toBe(204);
      expectSessionCleared(res);
      expect(cookie(res, 'login_challenge')).toMatch(
        /^login_challenge=; Path=\/api\/auth\/confirm;/,
      );
      expect((await client.agent.get('/api/me')).status).toBe(401);
      const refreshed = await client.agent
        .post('/api/auth/refresh')
        .set('X-CSRF-Token', client.csrf);
      expect(refreshed.status).toBe(401);
    });

    it('works without a session too', async () => {
      const { agent, csrf } = await csrfClient(app);

      const res = await agent
        .post('/api/auth/logout')
        .set('X-CSRF-Token', csrf);

      expect(res.status).toBe(204);
    });
  });
});
