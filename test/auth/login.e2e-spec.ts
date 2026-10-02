import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { z } from 'zod';

import { createTestApp } from '../helpers/app';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase, setFlag } from '../helpers/db';
import {
  type CsrfClient,
  csrfClient,
  deliverOutbox,
  uniqueEmail,
} from '../helpers/http';
import {
  clearMailbox,
  confirmationSecrets,
  type MailpitMessage,
  waitForMessageTo,
} from '../helpers/mailpit';

const PASSWORD = 'correct-horse-42';
const JWT_CLAIMS = { audience: 'file-converter', issuer: 'file-converter-api' };

const pendingSchema = z.object({
  challengeId: z.uuid(),
  expiresAt: z.iso.datetime(),
  requiresConfirmation: z.literal(true),
});

function setCookies(res: request.Response): string[] {
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []);
}

function cookie(res: request.Response, name: string): string | undefined {
  return setCookies(res).find((value) => value.startsWith(`${name}=`));
}

function tokenOf(res: request.Response, name: string): string {
  return (cookie(res, name) ?? '').slice(name.length + 1).split(';')[0] ?? '';
}

async function newestMail(email: string, count = 1): Promise<MailpitMessage> {
  const [newest] = await waitForMessageTo(email, count);
  if (!newest) throw new Error(`no mail to ${email}`);
  return newest;
}

describe('login', () => {
  let app: NestExpressApplication;
  let config: AppConfig;

  beforeAll(async () => {
    app = await createTestApp();
    config = app.get(AppConfig);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await clearMailbox();
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(
    path: string,
    body: object,
    client?: CsrfClient,
  ): Promise<request.Response> {
    const { agent, csrf } = client ?? (await csrfClient(app));
    return agent.post(path).set('X-CSRF-Token', csrf).send(body);
  }

  async function registeredUser(): Promise<string> {
    const email = uniqueEmail();
    const res = await post('/api/auth/register', { email, password: PASSWORD });
    expect(res.status).toBe(201);
    return email;
  }

  describe('with sign-in confirmation off (default)', () => {
    it('sets HttpOnly session cookies holding valid access and refresh JWTs', async () => {
      const email = await registeredUser();

      const res = await post('/api/auth/login', {
        email: ` ${email.toUpperCase()}`,
        password: PASSWORD,
      });

      expect(res.status).toBe(200);
      expectContract('post', '/api/auth/login', res);
      expect(res.body).toMatchObject({ user: { email, status: 'active' } });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(cookie(res, 'access_token')).toMatch(
        /Max-Age=900; Path=\/api; .*HttpOnly; SameSite=Lax/,
      );
      expect(cookie(res, 'refresh_token')).toMatch(
        /Max-Age=2592000; Path=\/api\/auth\/refresh; .*HttpOnly; SameSite=Lax/,
      );

      const jwt = new JwtService();
      const user = await prismaOf(app).user.findUniqueOrThrow({
        where: { email },
      });
      const access = await jwt.verifyAsync<Record<string, unknown>>(
        tokenOf(res, 'access_token'),
        {
          ...JWT_CLAIMS,
          algorithms: ['HS256'],
          secret: config.auth.accessSecret,
        },
      );
      const refresh = await jwt.verifyAsync<Record<string, unknown>>(
        tokenOf(res, 'refresh_token'),
        {
          ...JWT_CLAIMS,
          algorithms: ['HS256'],
          secret: config.auth.refreshSecret,
        },
      );
      expect(access).toMatchObject({ sub: user.id, typ: 'access', ver: 0 });
      expect(Number(access.exp) - Number(access.iat)).toBe(900);
      expect(refresh).toMatchObject({ sub: user.id, typ: 'refresh', ver: 0 });
      expect(Number(refresh.exp) - Number(refresh.iat)).toBe(2_592_000);
      await expect(
        jwt.verifyAsync(tokenOf(res, 'access_token'), {
          secret: config.auth.refreshSecret,
        }),
      ).rejects.toThrow();
      expect(user.lastLoginAt).not.toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(
        tokenOf(res, 'access_token'),
      );
    });

    it('answers the same 401 for an unknown e-mail and a wrong password', async () => {
      const email = await registeredUser();

      const wrongPassword = await post('/api/auth/login', {
        email,
        password: 'wrong-pass-1',
      });
      const unknownEmail = await post('/api/auth/login', {
        email: uniqueEmail('ghost'),
        password: PASSWORD,
      });

      for (const res of [wrongPassword, unknownEmail]) {
        expect(res.status).toBe(401);
        expectContract('post', '/api/auth/login', res);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body).toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    });

    it('refuses an account whose registration is not confirmed', async () => {
      await setFlag(app, 'confirmation.registration', true);
      const email = uniqueEmail();
      await post('/api/auth/register', { email, password: PASSWORD });

      const res = await post('/api/auth/login', { email, password: PASSWORD });

      expect(res.status).toBe(403);
      expectContract('post', '/api/auth/login', res);
      expect(res.body).toMatchObject({ code: 'AUTH_ACCOUNT_NOT_VERIFIED' });
    });

    it.each([
      [{ email: 'nope', password: PASSWORD }, 'email'],
      [{ email: uniqueEmail(), password: '' }, 'password'],
    ])('rejects %p with 400 on %s', async (body, path) => {
      const res = await post('/api/auth/login', body);

      expect(res.status).toBe(400);
      expectContract('post', '/api/auth/login', res);
      expect(res.body).toMatchObject({ context: { fields: [{ path }] } });
    });

    it('requires the CSRF header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: uniqueEmail(), password: PASSWORD });

      expect(res.status).toBe(403);
      expectContract('post', '/api/auth/login', res);
    });
  });

  describe('with sign-in confirmation on', () => {
    interface Pending {
      challengeId: string;
      client: CsrfClient;
      email: string;
      res: request.Response;
    }

    async function pendingLogin(email?: string): Promise<Pending> {
      const target = email ?? (await registeredUser());
      await setFlag(app, 'confirmation.login', true);
      const client = await csrfClient(app);
      const res = await post(
        '/api/auth/login',
        { email: target, password: PASSWORD },
        client,
      );
      expect(res.status).toBe(202);
      const { challengeId } = pendingSchema.parse(res.body);
      return { challengeId, client, email: target, res };
    }

    it('issues no tokens, binds the browser and mails a sign-in code and link', async () => {
      const { challengeId, email, res } = await pendingLogin();

      expectContract('post', '/api/auth/login', res);
      expect(cookie(res, 'access_token')).toBeUndefined();
      expect(cookie(res, 'login_challenge')).toMatch(
        new RegExp(
          `^login_challenge=${challengeId}; Max-Age=600; Path=/api/auth/confirm; .*HttpOnly`,
        ),
      );
      const { expiresAt } = pendingSchema.parse(res.body);
      const ttl = new Date(expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(590_000);
      expect(ttl).toBeLessThanOrEqual(600_000);
      await deliverOutbox(app);
      expect((await newestMail(email)).Subject).toBe('Confirm your sign-in');
    });

    it('sets the session cookies when the code is confirmed', async () => {
      const { challengeId, email } = await pendingLogin();
      await deliverOutbox(app);
      const { code } = confirmationSecrets(await newestMail(email));

      const res = await post('/api/auth/confirm', { challengeId, code });

      expect(res.status).toBe(200);
      expectContract('post', '/api/auth/confirm', res);
      expect(tokenOf(res, 'access_token')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(tokenOf(res, 'refresh_token')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('signs in by magic link only in the browser that started the sign-in', async () => {
      const { client, email } = await pendingLogin();
      await deliverOutbox(app);
      const { token } = confirmationSecrets(await newestMail(email));
      const url = `/api/auth/confirm?token=${token}`;

      const otherBrowser = await request(app.getHttpServer()).get(url);
      const sameBrowser = await client.agent.get(url);

      expect(otherBrowser.status).toBe(403);
      expectContract('get', url, otherBrowser);
      expect(otherBrowser.body).toMatchObject({
        code: 'AUTH_CHALLENGE_OTHER_BROWSER',
      });
      expect(otherBrowser.headers['set-cookie']).toBeUndefined();
      expect(sameBrowser.status).toBe(200);
      expectContract('get', url, sameBrowser);
      expect(cookie(sameBrowser, 'access_token')).toMatch(/HttpOnly/);
      expect(cookie(sameBrowser, 'login_challenge')).toMatch(
        /^login_challenge=;/,
      );
    });

    it('voids a pending sign-in when the token version changed meanwhile', async () => {
      const { challengeId, email } = await pendingLogin();
      await deliverOutbox(app);
      const { code } = confirmationSecrets(await newestMail(email));
      await prismaOf(app).user.update({
        data: { tokenVersion: { increment: 1 } },
        where: { email },
      });

      const res = await post('/api/auth/confirm', { challengeId, code });

      expect(res.status).toBe(400);
      expectContract('post', '/api/auth/confirm', res);
      expect(res.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('keeps one live sign-in per user: a new one voids the previous code', async () => {
      const first = await pendingLogin();
      await deliverOutbox(app);
      const { code } = confirmationSecrets(await newestMail(first.email));
      const second = await pendingLogin(first.email);

      const stale = await post('/api/auth/confirm', {
        challengeId: first.challengeId,
        code,
      });

      expect(stale.status).toBe(400);
      expect(stale.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
      expect(second.challengeId).not.toBe(first.challengeId);
    });

    it('resends a sign-in code and renews the browser binding', async () => {
      const { challengeId, client, email } = await pendingLogin();
      await deliverOutbox(app);
      await prismaOf(app).challenge.update({
        data: { lastSentAt: new Date(Date.now() - 61_000) },
        where: { id: challengeId },
      });

      const res = await post(
        '/api/auth/confirm/resend',
        { challengeId },
        client,
      );
      const otherBrowser = await post('/api/auth/confirm/resend', {
        challengeId,
      });
      await deliverOutbox(app);
      expect(otherBrowser.status).toBe(429);
      expect(cookie(otherBrowser, 'login_challenge')).toBeUndefined();

      expect(res.status).toBe(202);
      expect(cookie(res, 'login_challenge')).toMatch(
        new RegExp(`^login_challenge=${challengeId}; Max-Age=600;`),
      );
      const mails = await waitForMessageTo(email, 2);
      expect(mails.map((mail) => mail.Subject)).toEqual([
        'Confirm your sign-in',
        'Confirm your sign-in',
      ]);
    });

    it('does not set cookies when a registration is confirmed', async () => {
      await setFlag(app, 'confirmation.registration', true);
      const email = uniqueEmail();
      const registered = await post('/api/auth/register', {
        email,
        password: PASSWORD,
      });
      await deliverOutbox(app);
      const { code } = confirmationSecrets(await newestMail(email));

      const res = await post('/api/auth/confirm', {
        challengeId: pendingSchema.parse(registered.body).challengeId,
        code,
      });

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });
});

describe('login lockout', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(
          testConfig({ throttle: { loginBlockSeconds: 900, loginLimit: 3 } }),
        ),
    );
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup(): Promise<{
    attempt: (password: string, email?: string) => Promise<request.Response>;
    email: string;
  }> {
    const { agent, csrf } = await csrfClient(app);
    const email = uniqueEmail();
    await agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({ email, password: PASSWORD })
      .expect(201);
    return {
      attempt: (password, target = email) =>
        agent
          .post('/api/auth/login')
          .set('X-CSRF-Token', csrf)
          .send({ email: target, password }),
      email,
    };
  }

  it('does not count successful sign-ins', async () => {
    const { attempt } = await setup();

    for (let i = 0; i < 6; i++)
      expect((await attempt(PASSWORD)).status).toBe(200);
  });

  it('blocks the pair after the failure limit, even with the right password', async () => {
    const { attempt } = await setup();

    const failures = [
      (await attempt('wrong-1')).status,
      (await attempt('wrong-2')).status,
      (await attempt('wrong-3')).status,
    ];
    const blocked = await attempt(PASSWORD);
    const otherEmail = await attempt(PASSWORD, uniqueEmail('other'));

    expect(failures).toEqual([401, 401, 401]);
    expect(blocked.status).toBe(429);
    expectContract('post', '/api/auth/login', blocked);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(890);
    expect(otherEmail.status).toBe(401);
  });

  it('resets the failure count after a successful sign-in', async () => {
    const { attempt } = await setup();

    await attempt('wrong-1');
    await attempt('wrong-2');
    expect((await attempt(PASSWORD)).status).toBe(200);
    await attempt('wrong-3');
    await attempt('wrong-4');

    expect((await attempt(PASSWORD)).status).toBe(200);
  });
});
