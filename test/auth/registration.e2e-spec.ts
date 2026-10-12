import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestApp } from '../helpers/app';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase, setFlag } from '../helpers/db';
import { csrfClient, deliverOutbox, uniqueEmail } from '../helpers/http';
import {
  clearMailbox,
  confirmationSecrets,
  messagesTo,
  waitForMessageTo,
} from '../helpers/mail';

const PASSWORD = 'correct-horse-42';

interface Pending {
  challengeId: string;
  email: string;
}

describe('registration', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    await clearMailbox();
  });

  afterAll(async () => {
    await app.close();
  });

  async function register(
    email: string,
    password = PASSWORD,
  ): Promise<request.Response> {
    const { agent, csrf } = await csrfClient(app);
    return agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({ email, password });
  }

  async function registerPending(): Promise<Pending> {
    await setFlag(app, 'confirmation.registration', true);
    const email = uniqueEmail();
    const res = await register(email);
    expect(res.status).toBe(202);
    return {
      challengeId: (res.body as { challengeId: string }).challengeId,
      email,
    };
  }

  async function secretsFor(
    email: string,
    count = 1,
  ): Promise<{ code: string; token: string }> {
    await deliverOutbox(app);
    const [newest] = await waitForMessageTo(email, count);
    if (!newest) throw new Error(`no mail to ${email}`);
    return confirmationSecrets(newest);
  }

  async function confirm(body: object): Promise<request.Response> {
    const { agent, csrf } = await csrfClient(app);
    return agent.post('/api/auth/confirm').set('X-CSRF-Token', csrf).send(body);
  }

  describe('CSRF', () => {
    it('GET /api/auth/csrf sets a readable csrf_token cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/csrf');

      expect(res.status).toBe(204);
      expectContract('get', '/api/auth/csrf', res);
      expect(String(res.headers['set-cookie'])).not.toMatch(/HttpOnly/i);
    });

    it.each([
      ['no header', undefined],
      ['a different token', 'x'.repeat(43)],
    ])('rejects an unsafe request with %s', async (_label, header) => {
      const { agent } = await csrfClient(app);
      const call = agent.post('/api/auth/register');
      const res = await (header ? call.set('X-CSRF-Token', header) : call).send(
        {
          email: uniqueEmail(),
          password: PASSWORD,
        },
      );

      expect(res.status).toBe(403);
      expectContract('post', '/api/auth/register', res);
      expect(res.body).toMatchObject({ code: 'CSRF_INVALID' });
    });
  });

  describe('with e-mail confirmation off (default)', () => {
    it('creates an active account with an argon2id hash and sends no mail', async () => {
      const email = uniqueEmail();
      const res = await register(`  ${email.toUpperCase()} `);

      expect(res.status).toBe(201);
      expectContract('post', '/api/auth/register', res);
      expect(res.body).toMatchObject({ user: { email, status: 'active' } });
      const row = await prismaOf(app).user.findUniqueOrThrow({
        where: { email },
      });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      expect(row.passwordHash).not.toContain(PASSWORD);
      expect(await prismaOf(app).outboxMessage.count()).toBe(0);
    });

    it('refuses a second registration of the same e-mail', async () => {
      const email = uniqueEmail();
      await register(email);
      const res = await register(email.toUpperCase());

      expect(res.status).toBe(409);
      expectContract('post', '/api/auth/register', res);
      expect(res.body).toMatchObject({ code: 'USER_EMAIL_TAKEN' });
    });

    it('maps a concurrent duplicate registration to USER_EMAIL_TAKEN, not a 500', async () => {
      const email = uniqueEmail();
      const results = await Promise.all([
        register(email),
        register(email),
        register(email),
      ]);
      const statuses = results.map((res) => res.status).sort();

      expect(statuses).toEqual([201, 409, 409]);
      for (const res of results)
        expectContract('post', '/api/auth/register', res);
      expect(await prismaOf(app).user.count({ where: { email } })).toBe(1);
    });

    it.each([
      [
        { email: 'not-an-email', password: PASSWORD },
        'email',
        'invalid_format',
      ],
      [{ email: uniqueEmail(), password: 'short1' }, 'password', 'too_small'],
      [
        { email: uniqueEmail(), password: 'onlyletters' },
        'password',
        'password_too_weak',
      ],
      [
        { email: uniqueEmail(), password: 'x1'.repeat(65) },
        'password',
        'too_big',
      ],
      [{ email: uniqueEmail() }, 'password', 'invalid_type'],
    ])(
      'rejects %p with 400 VALIDATION_FAILED on %s',
      async (body, path, code) => {
        const { agent, csrf } = await csrfClient(app);
        const res = await agent
          .post('/api/auth/register')
          .set('X-CSRF-Token', csrf)
          .send(body);

        expect(res.status).toBe(400);
        expectContract('post', '/api/auth/register', res);
        expect(res.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          context: { fields: [{ code, path }] },
        });
        expect(await prismaOf(app).user.count()).toBe(0);
      },
    );
  });

  describe('with e-mail confirmation on', () => {
    it('creates a pending account and e-mails a code and a magic link once', async () => {
      const { challengeId, email } = await registerPending();

      const user = await prismaOf(app).user.findUniqueOrThrow({
        where: { email },
      });
      expect(user.status).toBe('pending_verification');
      await deliverOutbox(app);
      await deliverOutbox(app);
      const messages = await waitForMessageTo(email);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.subject).toBe('Confirm your registration');
      expect(messages[0]?.text).toMatch(/expire in 10 minutes/);
      const outbox = await prismaOf(app).outboxMessage.findFirstOrThrow();
      expect(outbox).toMatchObject({ payload: {}, status: 'done' });
      expect(challengeId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('confirms with the code, then refuses to reuse it', async () => {
      const { challengeId, email } = await registerPending();
      const { code } = await secretsFor(email);

      const res = await confirm({ challengeId, code });
      const replay = await confirm({ challengeId, code });

      expect(res.status).toBe(200);
      expectContract('post', '/api/auth/confirm', res);
      expect(res.body).toMatchObject({ user: { email, status: 'active' } });
      expect(replay.status).toBe(400);
      expectContract('post', '/api/auth/confirm', replay);
      expect(replay.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
    });

    it('confirms with the magic link, then refuses to reuse it', async () => {
      const { email } = await registerPending();
      const { token } = await secretsFor(email);
      const url = `/api/auth/confirm?token=${token}`;

      const res = await request(app.getHttpServer()).get(url);
      const replay = await request(app.getHttpServer()).get(url);

      expect(res.status).toBe(200);
      expectContract('get', url, res);
      expect(res.body).toMatchObject({ user: { status: 'active' } });
      expect(replay.status).toBe(400);
      expectContract('get', url, replay);
    });

    it('rejects an unknown or malformed link', async () => {
      const unknown = await request(app.getHttpServer()).get(
        `/api/auth/confirm?token=${'a'.repeat(43)}`,
      );
      const malformed = await request(app.getHttpServer()).get(
        '/api/auth/confirm?token=short',
      );

      expect(unknown.status).toBe(400);
      expect(unknown.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
      expect(malformed.status).toBe(400);
      expectContract('get', '/api/auth/confirm', malformed);
      expect(malformed.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('counts wrong codes and locks the challenge after five', async () => {
      const { challengeId, email } = await registerPending();
      const { code } = await secretsFor(email);
      const wrong = code === '000000' ? '111111' : '000000';

      const attempts: request.Response[] = [];
      for (let i = 0; i < 5; i++)
        attempts.push(await confirm({ challengeId, code: wrong }));
      const afterLock = await confirm({ challengeId, code });

      expect(attempts.slice(0, 4).map((res) => res.body as object)).toEqual(
        [4, 3, 2, 1].map(
          (attemptsLeft): object =>
            expect.objectContaining({
              code: 'AUTH_CODE_INVALID',
              context: { attemptsLeft },
            }) as object,
        ),
      );
      for (const res of attempts)
        expectContract('post', '/api/auth/confirm', res);
      expect(attempts[4]?.status).toBe(423);
      expect(afterLock.status).toBe(423);
      expectContract('post', '/api/auth/confirm', afterLock);
      expect(afterLock.body).toMatchObject({ code: 'AUTH_CHALLENGE_LOCKED' });
      const user = await prismaOf(app).user.findUniqueOrThrow({
        where: { email },
      });
      expect(user.status).toBe('pending_verification');
    });

    it('evaluates at most five guesses even when they arrive in parallel', async () => {
      const { challengeId, email } = await registerPending();
      const { code } = await secretsFor(email);
      const wrong = code === '000000' ? '111111' : '000000';

      const results = await Promise.all(
        Array.from({ length: 20 }, () => confirm({ challengeId, code: wrong })),
      );
      const afterwards = await confirm({ challengeId, code });

      const invalid = results.filter((res) => res.status === 400).length;
      expect(invalid).toBeLessThanOrEqual(4);
      expect(results.every((res) => [400, 423].includes(res.status))).toBe(
        true,
      );
      const row = await prismaOf(app).challenge.findUniqueOrThrow({
        where: { id: challengeId },
      });
      expect(row.attempts).toBe(5);
      expect(afterwards.status).toBe(423);
    });

    it('lets exactly one of two concurrent correct confirmations win', async () => {
      const { challengeId, email } = await registerPending();
      const { code } = await secretsFor(email);

      const results = await Promise.all([
        confirm({ challengeId, code }),
        confirm({ challengeId, code }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
      for (const res of results)
        expectContract('post', '/api/auth/confirm', res);
    });

    it('frees the e-mail of a pending account older than the confirmation window', async () => {
      const { challengeId, email } = await registerPending();
      await prismaOf(app).user.update({
        data: { createdAt: new Date(Date.now() - 11 * 60_000) },
        where: { email },
      });
      await prismaOf(app).challenge.update({
        data: { expiresAt: new Date(Date.now() - 60_000) },
        where: { id: challengeId },
      });

      const again = await register(email);

      expect(again.status).toBe(202);
      expect((again.body as { challengeId: string }).challengeId).not.toBe(
        challengeId,
      );
      expect(await prismaOf(app).user.count({ where: { email } })).toBe(1);
      expect(
        await prismaOf(app).challenge.findUnique({
          where: { id: challengeId },
        }),
      ).toBeNull();
    });

    it('keeps an old pending account whose challenge a resend extended', async () => {
      const { challengeId, email } = await registerPending();
      await prismaOf(app).challenge.update({
        data: { lastSentAt: new Date(Date.now() - 61_000) },
        where: { id: challengeId },
      });
      const { agent, csrf } = await csrfClient(app);
      await agent
        .post('/api/auth/confirm/resend')
        .set('X-CSRF-Token', csrf)
        .send({ challengeId })
        .expect(202);
      await prismaOf(app).user.update({
        data: { createdAt: new Date(Date.now() - 11 * 60_000) },
        where: { email },
      });

      const again = await register(email);

      expect(again.status).toBe(409);
      expect(
        await prismaOf(app).challenge.findUnique({
          where: { id: challengeId },
        }),
      ).not.toBeNull();
    });

    it('keeps a pending account inside the confirmation window', async () => {
      const { email } = await registerPending();

      const again = await register(email);

      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'USER_EMAIL_TAKEN' });
    });

    it('rejects an expired code', async () => {
      const { challengeId, email } = await registerPending();
      const { code } = await secretsFor(email);
      await prismaOf(app).challenge.update({
        data: { expiresAt: new Date(Date.now() - 1000) },
        where: { id: challengeId },
      });

      const res = await confirm({ challengeId, code });

      expect(res.status).toBe(400);
      expectContract('post', '/api/auth/confirm', res);
      expect(res.body).toMatchObject({ code: 'AUTH_CHALLENGE_EXPIRED' });
    });

    describe('resend', () => {
      async function resend(challengeId: string): Promise<request.Response> {
        const { agent, csrf } = await csrfClient(app);
        return agent
          .post('/api/auth/confirm/resend')
          .set('X-CSRF-Token', csrf)
          .send({ challengeId });
      }

      it('is refused within 60 s with Retry-After', async () => {
        const { challengeId } = await registerPending();

        const res = await resend(challengeId);

        expect(res.status).toBe(429);
        expectContract('post', '/api/auth/confirm/resend', res);
        const retryAfter = Number(res.headers['retry-after']);
        expect(retryAfter).toBeGreaterThan(55);
        expect(res.body).toMatchObject({
          code: 'RATE_LIMITED',
          context: { retryAfter },
        });
      });

      it('after the cooldown replaces the code, unlocks and resets the expiry', async () => {
        const { challengeId, email } = await registerPending();
        const first = await secretsFor(email);
        for (let i = 0; i < 5; i++)
          await confirm({ challengeId, code: '999999' });
        await prismaOf(app).challenge.update({
          data: {
            expiresAt: new Date(Date.now() + 1000),
            lastSentAt: new Date(Date.now() - 61_000),
          },
          where: { id: challengeId },
        });
        const before = await prismaOf(app).challenge.findUniqueOrThrow({
          where: { id: challengeId },
        });

        const res = await resend(challengeId);
        const second = await secretsFor(email, 2);
        const after = await prismaOf(app).challenge.findUniqueOrThrow({
          where: { id: challengeId },
        });

        expect(res.status).toBe(202);
        expectContract('post', '/api/auth/confirm/resend', res);
        expect(res.body).toMatchObject({
          challengeId,
          requiresConfirmation: true,
        });
        expect(after.codeHash).not.toBe(before.codeHash);
        expect(after.tokenHash).not.toBe(before.tokenHash);
        expect(after.attempts).toBe(0);
        expect(after.expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
        expect(second.code).not.toBe(first.code);
        expect((await confirm({ challengeId, code: first.code })).status).toBe(
          400,
        );
        expect((await confirm({ challengeId, code: second.code })).status).toBe(
          200,
        );
      });

      it('sends exactly one mail when resends race', async () => {
        const { challengeId, email } = await registerPending();
        await secretsFor(email);
        await prismaOf(app).challenge.update({
          data: { lastSentAt: new Date(Date.now() - 61_000) },
          where: { id: challengeId },
        });

        const results = await Promise.all(
          Array.from({ length: 5 }, () => resend(challengeId)),
        );
        await deliverOutbox(app);

        expect(results.map((res) => res.status).sort()).toEqual([
          202, 429, 429, 429, 429,
        ]);
        expect(await waitForMessageTo(email, 2)).toHaveLength(2);
      });

      it('rejects an unknown challenge', async () => {
        const res = await resend('0190a3c4-0000-7000-8000-000000000000');

        expect(res.status).toBe(400);
        expectContract('post', '/api/auth/confirm/resend', res);
        expect(res.body).toMatchObject({ code: 'AUTH_CHALLENGE_INVALID' });
      });
    });

    it('never puts the code or the link into an API response', async () => {
      await setFlag(app, 'confirmation.registration', true);
      const email = uniqueEmail();
      const registered = await register(email);
      const { code, token } = await secretsFor(email);
      const confirmed = await request(app.getHttpServer())
        .get(`/api/auth/confirm?token=${token}`)
        .expect(200);

      expect(Object.keys(registered.body as object).sort()).toEqual([
        'challengeId',
        'expiresAt',
        'requiresConfirmation',
      ]);
      for (const res of [registered, confirmed]) {
        expect(JSON.stringify(res.body)).not.toContain(code);
        expect(JSON.stringify(res.body)).not.toContain(token);
      }
      expect(await messagesTo(email)).toHaveLength(1);
    });
  });
});

describe('confirmation rate limits', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(testConfig({ throttle: { confirmLimit: 2 } })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('limits confirmation attempts per client with 429', async () => {
    const { agent, csrf } = await csrfClient(app);
    const send = (): Promise<request.Response> =>
      agent.post('/api/auth/confirm').set('X-CSRF-Token', csrf).send({
        challengeId: '0190a3c4-0000-7000-8000-000000000000',
        code: '123456',
      });

    const statuses = [(await send()).status, (await send()).status];
    const limited = await send();

    expect(statuses).toEqual([400, 400]);
    expect(limited.status).toBe(429);
    expectContract('post', '/api/auth/confirm', limited);
  });
});

describe('registration rate limits', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(testConfig({ throttle: { mailLimit: 2 } })),
    );
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows two registrations per window, then answers 429', async () => {
    const { agent, csrf } = await csrfClient(app);
    const send = (): Promise<request.Response> =>
      agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', csrf)
        .send({ email: uniqueEmail(), password: PASSWORD });

    const statuses = [(await send()).status, (await send()).status];
    const limited = await send();

    expect(statuses).toEqual([201, 201]);
    expect(limited.status).toBe(429);
    expectContract('post', '/api/auth/register', limited);
  });
});
