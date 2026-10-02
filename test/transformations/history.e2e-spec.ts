import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

const OWN = '/api/transformations/history';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const BASE = Date.UTC(2026, 5, 1);

interface Item {
  createdAt: string;
  downloadable: boolean;
  id: string;
  sourceFormat: null | string;
  status: string;
  targetFormat: string;
  type: string;
}

interface Page {
  items: Item[];
  nextCursor: null | string;
}

function code(res: request.Response): unknown {
  return (res.body as { code?: unknown }).code;
}

describe('transformation history', () => {
  let app: NestExpressApplication;
  let me: SignedInUser;
  let other: SignedInUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    me = await signedInUser(app);
    other = await signedInUser(app, 'other');
    const future = new Date(Date.now() + 86_400_000);
    const row = (
      userId: string,
      minute: number,
      fields: Partial<{
        errorCode: string;
        sourceFormat: string;
        status: 'error' | 'success';
        targetFormat: string;
        type: 'file' | 'image';
      }>,
      expiresAt = future,
    ): object => ({
      createdAt: new Date(BASE + minute * 60_000),
      durationMs: 5,
      errorCode: fields.errorCode ?? null,
      expiresAt,
      fileSize: 100,
      sourceFormat: fields.sourceFormat ?? 'csv',
      status: fields.status ?? 'success',
      targetFormat: fields.targetFormat ?? 'json',
      type: fields.type ?? 'file',
      userId,
    });
    await prismaOf(app).transformation.createMany({
      data: [
        row(me.id, 1, {}),
        row(me.id, 2, { targetFormat: 'xml' }),
        // A tie on created_at: the id keeps the order stable across pages.
        row(me.id, 3, {
          sourceFormat: 'png',
          targetFormat: 'jpeg',
          type: 'image',
        }),
        row(me.id, 3, { errorCode: 'FILE_PARSE_ERROR', status: 'error' }),
        row(me.id, 4, {
          sourceFormat: 'svg',
          targetFormat: 'png',
          type: 'image',
        }),
        row(me.id, 5, {}, new Date(Date.now() - 1_000)),
        row(other.id, 2, {}),
      ] as never,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(
    who: SignedInUser,
    url: string,
    query: Record<string, number | string> = {},
  ): Promise<request.Response> {
    const res = await who.client.agent.get(url).query(query);
    expectContract('get', url, res);
    return res;
  }

  async function walk(query: Record<string, string> = {}): Promise<Item[]> {
    const items: Item[] = [];
    let cursor: null | string | undefined;
    do {
      const res = await get(me, OWN, {
        ...query,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      expect(res.status).toBe(200);
      const page = res.body as Page;
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  it('lists only my own unexpired rows, newest first, across pages without gaps', async () => {
    const items = await walk();

    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.id)).size).toBe(5);
    const times = items.map((item) => item.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(items.every((item) => !item.downloadable)).toBe(true);
    const otherRows = await prismaOf(app).transformation.findMany({
      where: { userId: other.id },
    });
    expect(items.map((item) => item.id)).not.toContain(otherRows[0]?.id);
  });

  it('is not cached', async () => {
    const res = await get(me, OWN);

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('filters by type, formats, status and period', async () => {
    const count = async (query: Record<string, string>): Promise<number> =>
      ((await get(me, OWN, query)).body as Page).items.length;

    expect(await count({ type: 'image' })).toBe(2);
    expect(await count({ sourceFormat: 'png' })).toBe(1);
    expect(await count({ targetFormat: 'xml' })).toBe(1);
    expect(await count({ status: 'error' })).toBe(1);
    expect(
      await count({
        createdAtFrom: new Date(BASE + 2 * 60_000).toISOString(),
        createdAtTo: new Date(BASE + 3 * 60_000).toISOString(),
      }),
    ).toBe(3);
    expect((await walk({ type: 'file' })).map((item) => item.type)).toEqual([
      'file',
      'file',
      'file',
    ]);
  });

  it('shows downloadable for a row with a saved result', async () => {
    const prisma = prismaOf(app);
    const [first] = await prisma.transformation.findMany({
      orderBy: { createdAt: 'asc' },
      where: { userId: me.id },
    });
    const file = await prisma.file.create({
      data: {
        checksum: '0'.repeat(64),
        key: `transformation_result/${me.id}/00000000-0000-4000-8000-0000000000aa`,
        mime: 'application/json',
        ownerId: me.id,
        purpose: 'transformation_result',
        size: 1,
      },
    });
    await prisma.transformation.update({
      data: { resultFileId: file.id },
      where: { id: first?.id ?? '' },
    });

    const items = await walk();

    expect(items.find((item) => item.id === first?.id)?.downloadable).toBe(
      true,
    );
  });

  it('refuses invalid parameters and a cursor reused with other filters', async () => {
    const first = (await get(me, OWN, { limit: 2 })).body as Page;

    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { createdAtFrom: '0000-01-01T00:00:00Z' },
      { createdAtTo: '0001-01-01T01:00:00+02:00' },
      { createdAtTo: '9999-12-31T23:00:00-02:00' },
      { createdAtFrom: '2026-06-01T00:03:00.0001Z' },
      { createdAtFrom: '2026-06-01' },
      { status: 'pending' },
      { sourceFormat: 'pdf' },
      {
        createdAtFrom: '2026-06-02T00:00:00Z',
        createdAtTo: '2026-06-01T00:00:00Z',
      },
      { userId: other.id },
    ] as Record<string, number | string>[]) {
      const res = await get(me, OWN, query);
      expect([res.status, code(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const forged = (fields: object): string =>
      Buffer.from(JSON.stringify(fields)).toString('base64url');
    const valid = JSON.parse(
      Buffer.from(first.nextCursor ?? '', 'base64url').toString('utf8'),
    ) as { f: string; id: string };
    for (const cursor of [
      'not-a-cursor',
      forged({ ...valid, at: '0000-01-01T00:00:00.000Z' }),
      forged({ ...valid, at: '2026-02-30T00:00:00.000Z' }),
      forged({ ...valid, at: '2026-06-01T00:00:00Z' }),
      forged({ ...valid, at: '2026-06-01T00:00:00.000Z', id: 'x' }),
      forged({ ...valid, at: '2026-06-01T00:00:00.000Z', f: '0'.repeat(16) }),
    ]) {
      const res = await get(me, OWN, { cursor });
      expect([res.status, code(res)]).toEqual([
        400,
        'PAGINATION_CURSOR_INVALID',
      ]);
    }
    const reused = await get(me, OWN, {
      cursor: first.nextCursor ?? '',
      type: 'image',
    });
    expect([reused.status, code(reused)]).toEqual([
      400,
      'PAGINATION_CURSOR_INVALID',
    ]);
  });

  describe('of a user, for transformations@history', () => {
    it('lists that user’s rows to an admin', async () => {
      const admin = await signedInAdmin(app);
      const url = `/api/admin/users/${me.id}/transformations/history`;

      const res = await get(admin, url);

      expect(res.status).toBe(200);
      expect((res.body as Page).items).toHaveLength(5);
      const second = await get(admin, url, {
        cursor:
          ((await get(admin, url, { limit: 3 })).body as Page).nextCursor ?? '',
        limit: 3,
      });
      expect((second.body as Page).items).toHaveLength(2);
      const badId = await get(
        admin,
        '/api/admin/users/x/transformations/history',
      );
      expect([badId.status, code(badId)]).toEqual([400, 'VALIDATION_FAILED']);
    });

    it('refuses users without the permission and answers 404 for an unknown or deleted user', async () => {
      const admin = await signedInAdmin(app);

      const refused = await get(
        other,
        `/api/admin/users/${me.id}/transformations/history`,
      );
      const unknown = await get(
        admin,
        `/api/admin/users/${UNKNOWN_ID}/transformations/history`,
      );
      await admin.client.agent
        .delete(`/api/users/${other.id}`)
        .set('X-CSRF-Token', admin.client.csrf)
        .expect(204);
      const deleted = await get(
        admin,
        `/api/admin/users/${other.id}/transformations/history`,
      );

      expect([refused.status, code(refused)]).toEqual([403, 'AUTH_FORBIDDEN']);
      expect([unknown.status, code(unknown)]).toEqual([404, 'USER_NOT_FOUND']);
      expect([deleted.status, code(deleted)]).toEqual([404, 'USER_NOT_FOUND']);
    });
  });
});
