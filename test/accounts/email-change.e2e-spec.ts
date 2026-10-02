import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestApp } from '../helpers/app';
import {
  PASSWORD,
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';
import { csrfClient, deliverOutbox, uniqueEmail } from '../helpers/http';
import {
  clearMailbox,
  confirmationSecrets,
  messagesTo,
  waitForMessageTo,
} from '../helpers/mailpit';

interface Pending {
  challengeId: string;
  code: string;
  newEmail: string;
  token: string;
}

describe('e-mail change', () => {
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

  async function post(
    who: SignedInUser,
    url: string,
    body: object,
  ): Promise<request.Response> {
    const res = await who.client.agent
      .post(url)
      .set('X-CSRF-Token', who.client.csrf)
      .send(body);
    expectContract('post', url, res);
    return res;
  }

  async function start(
    who: SignedInUser,
    newEmail = uniqueEmail('new'),
  ): Promise<Pending> {
    const res = await post(who, `/api/users/${who.id}/email-change`, {
      newEmail,
    });
    expect(res.status).toBe(200);
    await deliverOutbox(app);
    const [mail] = await waitForMessageTo(newEmail);
    if (!mail) throw new Error('no mail');
    expect(mail.Subject).toBe('Confirm your new e-mail address');
    return {
      challengeId: (res.body as { challengeId: string }).challengeId,
      newEmail,
      ...confirmationSecrets(mail),
    };
  }

  async function login(email: string): Promise<number> {
    const { agent, csrf } = await csrfClient(app);
    const res = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email, password: PASSWORD });
    return res.status;
  }

  function code(res: request.Response): unknown {
    return (res.body as { code?: unknown }).code;
  }

  it('mails the new address only and changes the e-mail once the code is confirmed', async () => {
    const me = await signedInUser(app);
    const pending = await start(me);

    expect(await messagesTo(me.email)).toHaveLength(0);
    expect(await login(pending.newEmail)).toBe(401);

    const res = await post(me, `/api/users/${me.id}/email-change/confirm`, {
      challengeId: pending.challengeId,
      code: pending.code,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      profile: { email: pending.newEmail, id: me.id },
    });
    expect(await login(pending.newEmail)).toBe(200);
    expect(await login(me.email)).toBe(401);
  });

  it('confirms with the link token, by POST or by opening the e-mailed link where signed in', async () => {
    const me = await signedInUser(app);
    const byPost = await start(me);
    const viaPost = await post(me, `/api/users/${me.id}/email-change/confirm`, {
      token: byPost.token,
    });
    expect(viaPost.body).toMatchObject({ profile: { email: byPost.newEmail } });

    const byLink = await start(me);
    const viaLink = await me.client.agent.get(
      `/api/auth/confirm?token=${byLink.token}`,
    );
    expectContract('get', '/api/auth/confirm', viaLink);
    expect(viaLink.status).toBe(200);
    expect(viaLink.body).toMatchObject({ user: { email: byLink.newEmail } });
    expect(viaLink.headers['set-cookie']).toBeUndefined();
  });

  it('refuses the link where its owner is not signed in (scanner, mistyped address)', async () => {
    const me = await signedInUser(app);
    const other = await signedInUser(app, 'other');
    const pending = await start(me);
    const url = `/api/auth/confirm?token=${pending.token}`;

    for (const res of [
      await request(app.getHttpServer()).get(url),
      await other.client.agent.get(url),
    ]) {
      expectContract('get', '/api/auth/confirm', res);
      expect([res.status, code(res)]).toEqual([
        403,
        'AUTH_CHALLENGE_SESSION_REQUIRED',
      ]);
    }
    const still = await post(me, `/api/users/${me.id}/email-change/confirm`, {
      challengeId: pending.challengeId,
      code: pending.code,
    });
    expect(still.status).toBe(200);
  });

  it('tells the previous address once the change is done', async () => {
    const me = await signedInUser(app);
    const pending = await start(me);

    await post(me, `/api/users/${me.id}/email-change/confirm`, {
      challengeId: pending.challengeId,
      code: pending.code,
    });
    await deliverOutbox(app);

    const [notice] = await waitForMessageTo(me.email);
    expect(notice?.Subject).toBe('Your e-mail address was changed');
    expect(notice?.Text).not.toMatch(/\d{6}|token=/);
  });

  it('is Self only: an admin uses PATCH, another user is refused', async () => {
    const me = await signedInUser(app);
    const admin = await signedInAdmin(app);

    const res = await post(admin, `/api/users/${me.id}/email-change`, {
      newEmail: uniqueEmail(),
    });

    expect([res.status, code(res)]).toEqual([403, 'AUTH_FORBIDDEN']);
  });

  it('refuses an address that is already registered, at the start and at confirmation', async () => {
    const me = await signedInUser(app);
    const other = await signedInUser(app, 'other');

    const taken = await post(me, `/api/users/${me.id}/email-change`, {
      newEmail: other.email,
    });
    expect([taken.status, code(taken)]).toEqual([409, 'USER_EMAIL_TAKEN']);

    const pending = await start(me);
    await prismaOf(app).user.update({
      data: { email: pending.newEmail },
      where: { id: other.id },
    });
    const raced = await post(me, `/api/users/${me.id}/email-change/confirm`, {
      challengeId: pending.challengeId,
      code: pending.code,
    });
    expect([raced.status, code(raced)]).toEqual([409, 'USER_EMAIL_TAKEN']);
  });

  it("does not complete through POST /api/auth/confirm or another user's endpoint", async () => {
    const me = await signedInUser(app);
    const other = await signedInUser(app, 'other');
    const pending = await start(me);

    const generic = await other.client.agent
      .post('/api/auth/confirm')
      .set('X-CSRF-Token', other.client.csrf)
      .send({ challengeId: pending.challengeId, code: pending.code });
    const foreign = await post(
      other,
      `/api/users/${other.id}/email-change/confirm`,
      {
        challengeId: pending.challengeId,
        code: pending.code,
      },
    );

    expect([generic.status, code(generic)]).toEqual([
      400,
      'AUTH_CHALLENGE_INVALID',
    ]);
    expect([foreign.status, code(foreign)]).toEqual([
      400,
      'AUTH_CHALLENGE_INVALID',
    ]);
  });

  it('keeps only the newest request alive and resends to the new address', async () => {
    const me = await signedInUser(app);
    const first = await start(me);
    const second = await start(me);

    const stale = await post(me, `/api/users/${me.id}/email-change/confirm`, {
      challengeId: first.challengeId,
      code: first.code,
    });
    expect([stale.status, code(stale)]).toEqual([
      400,
      'AUTH_CHALLENGE_INVALID',
    ]);

    await prismaOf(app).challenge.update({
      data: { lastSentAt: new Date(Date.now() - 120_000) },
      where: { id: second.challengeId },
    });
    const resend = await me.client.agent
      .post('/api/auth/confirm/resend')
      .set('X-CSRF-Token', me.client.csrf)
      .send({ challengeId: second.challengeId });
    expect(resend.status).toBe(202);
    await deliverOutbox(app);
    await waitForMessageTo(second.newEmail, 2);
    expect(await messagesTo(me.email)).toHaveLength(0);
  });

  it('answers 409 on the link when the address was taken meanwhile', async () => {
    const me = await signedInUser(app);
    const other = await signedInUser(app, 'other');
    const pending = await start(me);
    await prismaOf(app).user.update({
      data: { email: pending.newEmail },
      where: { id: other.id },
    });

    const res = await me.client.agent.get(
      `/api/auth/confirm?token=${pending.token}`,
    );

    expectContract('get', '/api/auth/confirm', res);
    expect([res.status, code(res)]).toEqual([409, 'USER_EMAIL_TAKEN']);
  });

  it('frees an address held by an abandoned registration', async () => {
    const me = await signedInUser(app);
    const abandoned = uniqueEmail('abandoned');
    await prismaOf(app).user.create({
      data: {
        createdAt: new Date(Date.now() - 3_600_000),
        email: abandoned,
        passwordHash: 'x',
        status: 'pending_verification',
      },
    });

    const pending = await start(me, abandoned);

    expect(pending.newEmail).toBe(abandoned);
  });

  it('is voided by an admin changing the e-mail directly, and the old address is told', async () => {
    const me = await signedInUser(app);
    const admin = await signedInAdmin(app);
    const pending = await start(me);
    const direct = uniqueEmail('direct');

    const patched = await admin.client.agent
      .patch(`/api/users/${me.id}`)
      .set('X-CSRF-Token', admin.client.csrf)
      .send({ email: direct });
    expect(patched.status).toBe(200);
    await deliverOutbox(app);

    const stale = await me.client.agent
      .post(`/api/users/${me.id}/email-change/confirm`)
      .set('X-CSRF-Token', me.client.csrf)
      .send({ challengeId: pending.challengeId, code: pending.code });
    expect([stale.status, code(stale)]).toEqual([
      400,
      'AUTH_CHALLENGE_INVALID',
    ]);
    const [notice] = await waitForMessageTo(me.email);
    expect(notice?.Subject).toBe('Your e-mail address was changed');
  });

  it('requires exactly one of code or token', async () => {
    const me = await signedInUser(app);
    const pending = await start(me);

    for (const body of [
      {},
      { challengeId: pending.challengeId },
      {
        challengeId: pending.challengeId,
        code: pending.code,
        token: pending.token,
      },
    ]) {
      const res = await post(
        me,
        `/api/users/${me.id}/email-change/confirm`,
        body,
      );
      expect([res.status, code(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });
});
