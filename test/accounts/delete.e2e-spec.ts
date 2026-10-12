import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';

import { STORAGE_PORT, type StoragePort } from '@/infrastructure/storage';
import { RbacService } from '@/modules/rbac';

import { createTestApp } from '../helpers/app';
import {
  PASSWORD,
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';
import { csrfClient, deliverOutbox } from '../helpers/http';
import {
  clearMailbox,
  confirmationSecrets,
  waitForMessageTo,
} from '../helpers/mail';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface Pending {
  challengeId: string;
  code: string;
  token: string;
}

describe('account deletion', () => {
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

  async function remove(
    who: SignedInUser,
    userId: string,
    body?: object,
  ): Promise<request.Response> {
    const url = `/api/users/${userId}`;
    const req = who.client.agent
      .delete(url)
      .set('X-CSRF-Token', who.client.csrf);
    const res = await (body === undefined ? req : req.send(body));
    expectContract('delete', url, res);
    return res;
  }

  async function requestOwn(who: SignedInUser): Promise<Pending> {
    const res = await remove(who, who.id);
    expect(res.status).toBe(202);
    await deliverOutbox(app);
    const [mail] = await waitForMessageTo(who.email);
    if (!mail) throw new Error('no mail');
    expect(mail.subject).toBe('Confirm deleting your account');
    return {
      challengeId: (res.body as { challengeId: string }).challengeId,
      ...confirmationSecrets(mail),
    };
  }

  async function confirm(
    who: SignedInUser,
    body: object,
  ): Promise<request.Response> {
    const url = `/api/users/${who.id}/delete/confirm`;
    const res = await who.client.agent
      .post(url)
      .set('X-CSRF-Token', who.client.csrf)
      .send(body);
    expectContract('post', url, res);
    return res;
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

  describe('Self', () => {
    it('deletes only after the e-mailed code: anonymised, signed out, address free again', async () => {
      const me = await signedInUser(app);
      const photo = await sharp({
        create: { background: '#123456', channels: 3, height: 8, width: 8 },
      })
        .png()
        .toBuffer();
      await me.client.agent
        .put(`/api/users/${me.id}/photo`)
        .set('X-CSRF-Token', me.client.csrf)
        .attach('file', photo, 'p.png')
        .expect(200);
      const prisma = prismaOf(app);
      const [file] = await prisma.file.findMany({ where: { ownerId: me.id } });
      const pending = await requestOwn(me);
      expect((await me.client.agent.get('/api/me')).status).toBe(200);

      const res = await confirm(me, {
        challengeId: pending.challengeId,
        code: pending.code,
      });

      expect(res.status).toBe(204);
      expect(String(res.headers['set-cookie'])).toMatch(/access_token=;/);
      expect((await me.client.agent.get('/api/me')).status).toBe(401);
      expect(await login(me.email)).toBe(401);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
      expect(row).toMatchObject({
        displayName: null,
        email: `deleted-${me.id}@deleted.invalid`,
        photoFileId: null,
        status: 'deleted',
      });
      expect(row.deletedAt).not.toBeNull();
      expect(await prisma.file.count({ where: { ownerId: me.id } })).toBe(0);
      expect(await prisma.challenge.count({ where: { userId: me.id } })).toBe(
        0,
      );
      await deliverOutbox(app);
      expect(
        await app.get<StoragePort>(STORAGE_PORT).getObject(file?.key ?? ''),
      ).toBeNull();
      const { agent, csrf } = await csrfClient(app);
      await agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', csrf)
        .send({ email: me.email, password: PASSWORD })
        .expect(201);
    });

    it('deletes by the e-mailed link only where the owner is signed in, and clears the cookies', async () => {
      const me = await signedInUser(app);
      const pending = await requestOwn(me);
      const url = `/api/auth/confirm?token=${pending.token}`;

      const anonymous = await request(app.getHttpServer()).get(url);
      expect([anonymous.status, code(anonymous)]).toEqual([
        403,
        'AUTH_CHALLENGE_SESSION_REQUIRED',
      ]);

      const res = await me.client.agent.get(url);
      expectContract('get', '/api/auth/confirm', res);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ user: { status: 'deleted' } });
      expect(String(res.headers['set-cookie'])).toMatch(/access_token=;/);
    });

    it('cannot be confirmed through POST /api/auth/confirm or by another user', async () => {
      const me = await signedInUser(app);
      const other = await signedInUser(app, 'other');
      const pending = await requestOwn(me);

      const generic = await other.client.agent
        .post('/api/auth/confirm')
        .set('X-CSRF-Token', other.client.csrf)
        .send({ challengeId: pending.challengeId, code: pending.code });
      const foreign = await confirm(other, {
        challengeId: pending.challengeId,
        code: pending.code,
      });

      expect(code(generic)).toBe('AUTH_CHALLENGE_INVALID');
      expect(code(foreign)).toBe('AUTH_CHALLENGE_INVALID');
      expect((await me.client.agent.get('/api/me')).status).toBe(200);
    });

    it('accepts an optional reason and refuses an empty one', async () => {
      const me = await signedInUser(app);

      expect((await remove(me, me.id, { reason: 'moving on' })).status).toBe(
        202,
      );
      const empty = await remove(me, me.id, { reason: '' });
      expect([empty.status, code(empty)]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('refuses the last active admin', async () => {
      const admin = await signedInAdmin(app);

      const res = await remove(admin, admin.id);

      expect([res.status, code(res)]).toEqual([409, 'RBAC_LAST_ADMIN']);
    });
  });

  describe('by an admin', () => {
    it('deletes at once, idempotently; the account is gone for every other endpoint', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);

      expect((await remove(admin, user.id)).status).toBe(204);
      expect((await remove(admin, user.id)).status).toBe(204);

      expect((await user.client.agent.get('/api/me')).status).toBe(401);
      const profile = await admin.client.agent.get(`/api/users/${user.id}`);
      expect([profile.status, code(profile)]).toEqual([404, 'USER_NOT_FOUND']);
      const patch = await admin.client.agent
        .patch(`/api/users/${user.id}`)
        .set('X-CSRF-Token', admin.client.csrf)
        .send({ displayName: 'X' });
      expect(patch.status).toBe(404);
    });

    it('answers 404 for an unknown account', async () => {
      const admin = await signedInAdmin(app);

      const res = await remove(admin, UNKNOWN_ID);

      expect([res.status, code(res)]).toEqual([404, 'USER_NOT_FOUND']);
    });

    it('needs users@delete, and rbac@manage to delete an administrator', async () => {
      const admin = await signedInAdmin(app);
      const plain = await signedInUser(app);
      const support = await signedInUser(app, 'support');

      const refused = await remove(plain, support.id);
      expect([refused.status, code(refused)]).toEqual([403, 'AUTH_FORBIDDEN']);

      const prisma = prismaOf(app);
      const role = await prisma.role.create({ data: { name: 'support' } });
      const users = await prisma.permission.findUniqueOrThrow({
        where: { name: 'users' },
      });
      await prisma.grant.create({
        data: { actions: ['delete'], permissionId: users.id, roleId: role.id },
      });
      await prisma.userRole.create({
        data: { roleId: role.id, userId: support.id },
      });
      await app.get(RbacService).reload('test');

      const takeover = await remove(support, admin.id);
      expect([takeover.status, code(takeover)]).toEqual([
        403,
        'AUTH_FORBIDDEN',
      ]);
      expect((await remove(support, plain.id)).status).toBe(204);
    });
  });

  describe('what is left afterwards', () => {
    it('signs in, refreshes and registers the tombstone address like an unknown one', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);
      await remove(admin, user.id);

      expect(await login(`deleted-${user.id}@deleted.invalid`)).toBe(400);
      expect(await login(user.email)).toBe(401);
      const refreshed = await user.client.agent
        .post('/api/auth/refresh')
        .set('X-CSRF-Token', user.client.csrf);
      expect([refreshed.status, code(refreshed)]).toEqual([
        401,
        'AUTH_REFRESH_INVALID',
      ]);
      const { agent, csrf } = await csrfClient(app);
      const claim = await agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', csrf)
        .send({
          email: `deleted-${UNKNOWN_ID}@deleted.invalid`,
          password: PASSWORD,
        });
      expect([claim.status, code(claim)]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('drops unsent mails carrying the addresses, and the roles', async () => {
      const admin = await signedInAdmin(app);
      const victim = await signedInAdmin(app);
      const prisma = prismaOf(app);
      const started = await victim.client.agent
        .post(`/api/users/${victim.id}/email-change`)
        .set('X-CSRF-Token', victim.client.csrf)
        .send({ newEmail: 'pending-new@example.com' });
      const { challengeId } = started.body as { challengeId: string };
      expect(
        await prisma.outboxMessage.count({
          where: {
            idempotencyKey: { startsWith: `auth.confirmation:${challengeId}:` },
          },
        }),
      ).toBe(1);

      expect((await remove(admin, victim.id)).status).toBe(204);

      expect(
        await prisma.outboxMessage.count({
          where: {
            idempotencyKey: { startsWith: `auth.confirmation:${challengeId}:` },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.userRole.count({ where: { userId: victim.id } }),
      ).toBe(0);
      const raw = JSON.stringify(await prisma.outboxMessage.findMany());
      expect(raw).not.toContain('pending-new@example.com');
      expect(raw).not.toContain(victim.email);
    });

    it('is not found by the photo and role endpoints', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);
      await remove(admin, user.id);

      const photo = await admin.client.agent.get(`/api/users/${user.id}/photo`);
      const roles = await admin.client.agent.get(
        `/api/admin/users/${user.id}/roles`,
      );

      expect([photo.status, code(photo)]).toEqual([404, 'USER_NOT_FOUND']);
      expect([roles.status, code(roles)]).toEqual([404, 'USER_NOT_FOUND']);
    });

    it('refuses the deletion link opened in another user’s session', async () => {
      const me = await signedInUser(app);
      const other = await signedInUser(app, 'other');
      const pending = await requestOwn(me);

      const res = await other.client.agent.get(
        `/api/auth/confirm?token=${pending.token}`,
      );

      expect([res.status, code(res)]).toEqual([
        403,
        'AUTH_CHALLENGE_SESSION_REQUIRED',
      ]);
      expect((await me.client.agent.get('/api/me')).status).toBe(200);
    });
  });
});
