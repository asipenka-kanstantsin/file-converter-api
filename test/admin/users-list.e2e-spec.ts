import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

import { RbacService } from '@/modules/rbac';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

interface Item {
  createdAt: string;
  email: string;
  id: string;
  lastLoginAt: null | string;
  status: string;
}

interface Page {
  items: Item[];
  nextCursor: null | string;
}

const URL = '/api/admin/users';

describe('GET /api/admin/users', () => {
  let app: NestExpressApplication;
  let admin: SignedInUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signedInAdmin(app);
    const base = Date.UTC(2026, 0, 1);
    await prismaOf(app).user.createMany({
      data: [
        {
          displayName: 'Zoe',
          email: 'carol@example.com',
          lastLoginAt: new Date(base + 5_000),
        },
        { displayName: 'Anna', email: 'alice@example.com', lastLoginAt: null },
        {
          displayName: null,
          email: 'bob@example.com',
          lastLoginAt: new Date(base + 9_000),
        },
        {
          displayName: 'Bob 100%',
          email: 'dave@example.com',
          lastLoginAt: new Date(base + 1_000),
        },
        {
          displayName: null,
          email: 'erin@example.com',
          lastLoginAt: null,
          status: 'blocked',
        },
        {
          displayName: null,
          email: 'gone@deleted.invalid',
          lastLoginAt: null,
          status: 'deleted',
        },
      ].map((user, index) => ({
        ...user,
        // Ties on created_at (the first two rows): the id keeps the order stable across pages.
        createdAt: new Date(base + Math.max(0, index - 1) * 60_000),
        passwordHash: 'x',
        status: (user.status ?? 'active') as 'active' | 'blocked' | 'deleted',
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function list(
    who: SignedInUser,
    query: Record<string, number | string> = {},
  ): Promise<request.Response> {
    const res = await who.client.agent.get(URL).query(query);
    expectContract('get', URL, res);
    return res;
  }

  // Walks every page; a skip or a repeat shows up as a mismatch with the expected order.
  async function walk(query: Record<string, string>): Promise<Item[]> {
    const items: Item[] = [];
    let cursor: null | string | undefined;
    do {
      const res = await list(admin, {
        ...query,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      expect(res.status).toBe(200);
      const page = res.body as Page;
      expect(page.items.length).toBeLessThanOrEqual(2);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  function code(res: request.Response): unknown {
    return (res.body as { code?: unknown }).code;
  }

  it('pages through every sort and order without skipping or repeating', async () => {
    const all = (await walk({ order: 'asc', sort: 'created_at' })).map(
      (item) => item.email,
    );
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
    const allDesc = (await walk({ order: 'desc', sort: 'created_at' })).map(
      (item) => item.email,
    );
    expect(allDesc).toEqual([...all].reverse());
    expect(all).not.toContain('gone@deleted.invalid');

    const byEmail = await walk({ order: 'asc', sort: 'email' });
    expect(byEmail.map((item) => item.email)).toEqual([...all].sort());
    const byEmailDesc = await walk({ order: 'desc', sort: 'email' });
    expect(byEmailDesc.map((item) => item.email)).toEqual(
      [...all].sort().reverse(),
    );

    const byLogin = await walk({ order: 'desc', sort: 'last_login' });
    const logins = byLogin.map((item) => item.lastLoginAt);
    const signedIn = logins.filter((at): at is string => at !== null);
    expect(signedIn).toEqual([...signedIn].sort().reverse());
    // Never signed in: last when descending.
    expect(logins.slice(signedIn.length).every((at) => at === null)).toBe(true);
    const byLoginAsc = await walk({ order: 'asc', sort: 'last_login' });
    expect(byLoginAsc.map((item) => item.id)).toEqual(
      byLogin.map((item) => item.id).reverse(),
    );

    const newest = (await list(admin)).body as Page;
    expect(newest.items[0]?.email).toBe(admin.email);
  });

  it('searches by e-mail prefix, display-name prefix or exact id, treating % literally', async () => {
    const emails = async (q: string): Promise<string[]> =>
      ((await list(admin, { q })).body as Page).items
        .map((item) => item.email)
        .sort();

    expect(await emails('AL')).toEqual(['alice@example.com']);
    expect(await emails('bo')).toEqual(['bob@example.com', 'dave@example.com']);
    expect(await emails('%')).toEqual([]);
    expect(await emails('bob 100%')).toEqual(['dave@example.com']);
    expect(await emails(admin.id.toUpperCase())).toEqual([admin.email]);
    expect(await emails('example')).toEqual([]);
  });

  it('filters by status; deleted accounts only when asked for', async () => {
    const statuses = async (status: string): Promise<string[]> =>
      ((await list(admin, { status })).body as Page).items.map(
        (item) => item.email,
      );

    expect(await statuses('blocked')).toEqual(['erin@example.com']);
    expect(await statuses('pending_verification')).toEqual([]);
    expect(await statuses('deleted')).toEqual(['gone@deleted.invalid']);
  });

  it('refuses a cursor reused with other parameters, a forged cursor and bad parameters', async () => {
    const first = (await list(admin, { limit: 2, sort: 'email' })).body as Page;
    const cursor = first.nextCursor ?? '';

    const reused: Record<string, string>[] = [
      { cursor, sort: 'created_at' },
      { cursor, order: 'asc', sort: 'email' },
      { cursor, q: 'a', sort: 'email' },
      { cursor, sort: 'email', status: 'blocked' },
      { cursor: 'not-a-cursor' },
      {
        cursor: Buffer.from(
          JSON.stringify({
            id: admin.id,
            key: 'garbage',
            order: 'desc',
            sort: 'created_at',
          }),
        ).toString('base64url'),
      },
      {
        cursor: Buffer.from(
          JSON.stringify({
            id: admin.id,
            key: '2026-02-30T00:00:00.000Z',
            order: 'desc',
            sort: 'created_at',
          }),
        ).toString('base64url'),
      },
      {
        cursor: Buffer.from(
          JSON.stringify({
            id: admin.id,
            key: '0000-01-01T00:00:00.000Z',
            order: 'desc',
            sort: 'created_at',
          }),
        ).toString('base64url'),
      },
      { cursor: Buffer.from('{"id":"x"}').toString('base64url') },
    ];
    for (const query of reused) {
      const res = await list(admin, query);
      expect([res.status, code(res)]).toEqual([
        400,
        'PAGINATION_CURSOR_INVALID',
      ]);
    }
    const invalid: Record<string, number | string>[] = [
      { limit: 101 },
      { limit: 0 },
      { sort: 'password' },
      { role: 'admin' },
    ];
    for (const query of invalid) {
      const res = await list(admin, query);
      expect([res.status, code(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('needs users@list', async () => {
    const plain = await signedInUser(app);
    const refused = await list(plain);
    expect([refused.status, code(refused)]).toEqual([403, 'AUTH_FORBIDDEN']);

    const prisma = prismaOf(app);
    const role = await prisma.role.create({ data: { name: 'auditor' } });
    const users = await prisma.permission.findUniqueOrThrow({
      where: { name: 'users' },
    });
    await prisma.grant.create({
      data: { actions: ['list'], permissionId: users.id, roleId: role.id },
    });
    await prisma.userRole.create({
      data: { roleId: role.id, userId: plain.id },
    });
    await app.get(RbacService).reload('test');

    expect((await list(plain)).status).toBe(200);
  });
});
