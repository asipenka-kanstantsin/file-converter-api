import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { RbacService } from '@/modules/rbac';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('GET /api/users/{userId}', () => {
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

  async function view(
    who: SignedInUser,
    userId: string,
  ): Promise<request.Response> {
    const url = `/api/users/${userId}`;
    const res = await who.client.agent.get(url);
    expectContract('get', url, res);
    return res;
  }

  // A support role holding users@read only (Notion: "Support/Admin ... при наличии права").
  async function supportUser(): Promise<SignedInUser> {
    const prisma = prismaOf(app);
    const support = await signedInUser(app, 'support');
    const role = await prisma.role.create({ data: { name: 'support' } });
    const users = await prisma.permission.findUniqueOrThrow({
      where: { name: 'users' },
    });
    await prisma.grant.create({
      data: { actions: ['read'], permissionId: users.id, roleId: role.id },
    });
    await prisma.userRole.create({
      data: { roleId: role.id, userId: support.id },
    });
    await app.get(RbacService).reload('test');
    return support;
  }

  it('shows one their own profile with the self fields', async () => {
    const me = await signedInUser(app);
    await prismaOf(app).user.update({
      data: { displayName: 'Jane' },
      where: { id: me.id },
    });

    const res = await view(me, me.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: {
        email: me.email,
        fields: {
          createdAt: expect.any(String) as string,
          displayName: 'Jane',
          lastLoginAt: expect.any(String) as string,
          status: 'active',
        },
        id: me.id,
        photo: null,
      },
    });
  });

  it('refuses another profile without users@read, whether it exists or not', async () => {
    const me = await signedInUser(app);
    const other = await signedInUser(app, 'other');

    for (const id of [other.id, UNKNOWN_ID]) {
      const res = await view(me, id);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'AUTH_FORBIDDEN' });
    }
  });

  it('shows another profile with the allowed fields only, for users@read', async () => {
    const support = await supportUser();
    const other = await signedInUser(app, 'other');

    const res = await view(support, other.id);

    expect(res.status).toBe(200);
    const { fields } = (res.body as { profile: { fields: object } }).profile;
    expect(Object.keys(fields).sort()).toEqual([
      'createdAt',
      'displayName',
      'status',
    ]);
  });

  it('answers 404 for an unknown id to a viewer with the permission, 400 for a malformed one', async () => {
    const admin = await signedInAdmin(app);

    const unknown = await view(admin, UNKNOWN_ID);
    const malformed = await view(admin, 'not-a-uuid');

    expect([unknown.status, (unknown.body as { code: string }).code]).toEqual([
      404,
      'USER_NOT_FOUND',
    ]);
    expect(malformed.status).toBe(400);
  });

  it('treats its own id in upper case as its own profile', async () => {
    const me = await signedInUser(app);

    const res = await view(me, me.id.toUpperCase());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      profile: {
        fields: { lastLoginAt: expect.any(String) as string },
        id: me.id,
      },
    });
  });

  it('answers 401 without a session, and marks the response not cacheable', async () => {
    const me = await signedInUser(app);
    const url = `/api/users/${me.id}`;

    const anonymous = await request(app.getHttpServer()).get(url);
    const own = await view(me, me.id);

    expectContract('get', url, anonymous);
    expect(anonymous.status).toBe(401);
    expect(own.headers['cache-control']).toBe('no-store');
    expect(own.headers['x-ratelimit-limit-profile']).toBeDefined();
  });
});

describe('GET /api/users/{userId} rate limit', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(testConfig({ throttle: { profileLimit: 2 } })),
    );
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 once the profile group is exhausted', async () => {
    const me = await signedInUser(app);
    const url = `/api/users/${me.id}`;
    const statuses: number[] = [];

    for (let i = 0; i < 3; i++) {
      const res = await me.client.agent.get(url);
      expectContract('get', url, res);
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 429]);
  });
});
