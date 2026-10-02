import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

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
import { csrfClient, uniqueEmail } from '../helpers/http';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('PATCH /api/users/{userId}', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function patch(
    who: SignedInUser,
    userId: string,
    body: object,
  ): Promise<request.Response> {
    const url = `/api/users/${userId}`;
    const res = await who.client.agent
      .patch(url)
      .set('X-CSRF-Token', who.client.csrf)
      .send(body);
    expectContract('patch', url, res);
    return res;
  }

  async function login(email: string): Promise<request.Response> {
    const { agent, csrf } = await csrfClient(app);
    return agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email, password: PASSWORD });
  }

  function code(res: request.Response): unknown {
    return (res.body as { code?: unknown }).code;
  }

  describe('Self', () => {
    it('changes and clears its display name', async () => {
      const me = await signedInUser(app);

      const set = await patch(me, me.id, { displayName: '  Jane  ' });
      const cleared = await patch(me, me.id, { displayName: null });

      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({
        profile: { fields: { displayName: 'Jane' } },
      });
      expect(cleared.body).toMatchObject({
        profile: { fields: { displayName: null } },
      });
    });

    it('may not change its e-mail or status directly (403 naming the fields)', async () => {
      const me = await signedInUser(app);

      const res = await patch(me, me.id, {
        displayName: 'Jane',
        email: uniqueEmail(),
        status: 'blocked',
      });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'AUTH_FORBIDDEN',
        context: { fields: ['email', 'status'] },
      });
    });

    it('may not change someone else', async () => {
      const me = await signedInUser(app);
      const other = await signedInUser(app, 'other');

      for (const id of [other.id, UNKNOWN_ID]) {
        const res = await patch(me, id, { displayName: 'X' });
        expect([res.status, code(res)]).toEqual([403, 'AUTH_FORBIDDEN']);
      }
    });

    it('refuses unknown keys, invalid values and an empty change with 400', async () => {
      const me = await signedInUser(app);

      for (const body of [
        { nickname: 'x' },
        { displayName: '' },
        { displayName: 'x'.repeat(101) },
        {},
      ]) {
        const res = await patch(me, me.id, body);
        expect([res.status, code(res)]).toEqual([400, 'VALIDATION_FAILED']);
      }
    });
  });

  describe('with users@update', () => {
    it('changes another user’s e-mail directly; the old one no longer signs in', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);
      const email = uniqueEmail('renamed');

      const res = await patch(admin, user.id, { email });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ profile: { email } });
      expect((await login(user.email)).status).toBe(401);
      expect((await login(email)).status).toBe(200);
    });

    it('refuses an e-mail that is taken', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);
      const other = await signedInUser(app, 'other');

      const res = await patch(admin, user.id, { email: other.email });

      expect([res.status, code(res)]).toEqual([409, 'USER_EMAIL_TAKEN']);
    });

    it('blocks an account: its sessions end and it cannot sign in until unblocked', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);

      const blocked = await patch(admin, user.id, { status: 'blocked' });

      expect(blocked.body).toMatchObject({
        profile: { fields: { status: 'blocked' } },
      });
      expect((await user.client.agent.get('/api/me')).status).toBe(401);
      const refused = await login(user.email);
      expect([refused.status, code(refused)]).toEqual([
        403,
        'AUTH_ACCOUNT_BLOCKED',
      ]);
      await patch(admin, user.id, { status: 'active' });
      expect((await login(user.email)).status).toBe(200);
    });

    it('never blocks the last active admin', async () => {
      const admin = await signedInAdmin(app);

      const res = await patch(admin, admin.id, { status: 'blocked' });

      expect([res.status, code(res)]).toEqual([409, 'RBAC_LAST_ADMIN']);
      expect((await admin.client.agent.get('/api/me')).status).toBe(200);
    });

    it('lets only one of two admins block the other at the same time', async () => {
      const first = await signedInAdmin(app);
      const second = await signedInAdmin(app);

      const results = await Promise.all([
        patch(first, second.id, { status: 'blocked' }),
        patch(second, first.id, { status: 'blocked' }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    });

    it('serialises concurrent edits of one account without errors', async () => {
      const admin = await signedInAdmin(app);
      const user = await signedInUser(app);

      const results = await Promise.all(
        ['A', 'B', 'C', 'D'].map((name) =>
          patch(admin, user.id, { displayName: name, status: 'active' }),
        ),
      );

      expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    });

    it('may not take over an admin account without rbac@manage', async () => {
      const admin = await signedInAdmin(app);
      const support = await signedInUser(app, 'support');
      const prisma = prismaOf(app);
      const role = await prisma.role.create({ data: { name: 'support' } });
      const users = await prisma.permission.findUniqueOrThrow({
        where: { name: 'users' },
      });
      await prisma.grant.create({
        data: { permissionId: users.id, roleId: role.id },
      });
      await prisma.userRole.create({
        data: { roleId: role.id, userId: support.id },
      });
      await app.get(RbacService).reload('test');
      const plain = await signedInUser(app);

      const takeover = await patch(support, admin.id, {
        email: uniqueEmail('mine'),
      });
      const block = await patch(support, admin.id, { status: 'blocked' });
      const rename = await patch(support, admin.id, { displayName: 'Ops' });
      const ordinary = await patch(support, plain.id, { email: uniqueEmail() });

      expect([takeover.status, code(takeover)]).toEqual([
        403,
        'AUTH_FORBIDDEN',
      ]);
      expect(block.status).toBe(403);
      expect(rename.status).toBe(200);
      expect(ordinary.status).toBe(200);
    });

    it('answers 404 for an unknown account', async () => {
      const admin = await signedInAdmin(app);

      const res = await patch(admin, UNKNOWN_ID, { displayName: 'X' });

      expect([res.status, code(res)]).toEqual([404, 'USER_NOT_FOUND']);
    });
  });
});
