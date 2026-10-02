import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

import { OutboxDispatcher } from '@/infrastructure/outbox/outbox.dispatcher';
import {
  STORAGE_PORT,
  type StoragePort,
  StorageUnavailableError,
} from '@/infrastructure/storage';
import { TransformationsService } from '@/modules/transformations';
import { HistoryCleanup } from '@/modules/transformations/history-cleanup';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

const CSV = 'name,age\nAda,36\nAlan,41\n';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

function code(res: request.Response): unknown {
  return (res.body as { code?: unknown }).code;
}

function own(itemId: string): string {
  return `/api/transformations/history/${itemId}/download`;
}

function ofUser(userId: string, itemId: string): string {
  return `/api/admin/users/${userId}/transformations/history/${itemId}/download`;
}

describe('saved result downloads', () => {
  let app: NestExpressApplication;
  let me: SignedInUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    me = await signedInUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // A CSV → JSON conversion of `who`, saved or not; the id of its history row.
  async function converted(who: SignedInUser, save: boolean): Promise<string> {
    await who.client.agent
      .post('/api/convert')
      .set('X-CSRF-Token', who.client.csrf)
      .field('targetFormat', 'json')
      .field('save', String(save))
      .attach('file', Buffer.from(CSV), 'people.csv')
      .expect(200);
    await app.get(TransformationsService).idle();
    const row = await prismaOf(app).transformation.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
      where: { userId: who.id },
    });
    return row.id;
  }

  async function get(
    who: SignedInUser,
    url: string,
  ): Promise<request.Response> {
    const res = await who.client.agent
      .get(url)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          const json = String(response.headers['content-type']).startsWith(
            'application/json',
          );
          callback(null, json ? JSON.parse(body.toString('utf8')) : body);
        });
      });
    expectContract('get', url, res);
    return res;
  }

  it('streams my saved result as an attachment, again and again', async () => {
    const itemId = await converted(me, true);

    const first = await get(me, own(itemId));
    const again = await get(me, own(itemId));

    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(first.headers['content-disposition']).toBe(
      'attachment; filename="converted.json"',
    );
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body).toEqual([
      { age: '36', name: 'Ada' },
      { age: '41', name: 'Alan' },
    ]);
    expect(again.body).toEqual(first.body);
  });

  it('refuses another user’s item with 403 and answers 404 without a result', async () => {
    const other = await signedInUser(app, 'other');
    const theirs = await converted(other, true);
    const unsaved = await converted(me, false);

    const forbidden = await get(me, own(theirs));
    const notSaved = await get(me, own(unsaved));
    const unknown = await get(me, own(UNKNOWN_ID));
    const badId = await get(me, own('x'));

    expect([forbidden.status, code(forbidden)]).toEqual([
      403,
      'AUTH_FORBIDDEN',
    ]);
    expect([notSaved.status, code(notSaved)]).toEqual([
      404,
      'RESULT_NOT_FOUND',
    ]);
    expect([unknown.status, code(unknown)]).toEqual([
      404,
      'TRANSFORMATION_NOT_FOUND',
    ]);
    expect([badId.status, code(badId)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('answers 410 once the retention period is over, and 404 when the object is gone', async () => {
    const expired = await converted(me, true);
    const lost = await converted(me, true);
    const prisma = prismaOf(app);
    await prisma.transformation.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: expired },
    });
    const { resultFile } = await prisma.transformation.findUniqueOrThrow({
      include: { resultFile: true },
      where: { id: lost },
    });
    await app
      .get<StoragePort>(STORAGE_PORT)
      .deleteObject(resultFile?.key ?? '');

    const gone = await get(me, own(expired));
    const missing = await get(me, own(lost));

    expect([gone.status, code(gone)]).toEqual([410, 'RESULT_EXPIRED']);
    expect([missing.status, code(missing)]).toEqual([404, 'RESULT_NOT_FOUND']);
  });

  describe('of a user, for transformations@download', () => {
    it('streams any user’s result to an admin', async () => {
      const admin = await signedInAdmin(app);
      const itemId = await converted(me, true);

      const res = await get(admin, ofUser(me.id, itemId));

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="converted.json"',
      );
    });

    it('refuses users without the permission; 404 for an unknown user or another user’s item', async () => {
      const admin = await signedInAdmin(app);
      const other = await signedInUser(app, 'other');
      const mine = await converted(me, true);

      const unsaved = await converted(me, false);
      await prismaOf(app).transformation.update({
        data: { expiresAt: new Date(Date.now() - 1_000) },
        where: { id: mine },
      });

      const expired = await get(admin, ofUser(me.id, mine));
      const notSaved = await get(admin, ofUser(me.id, unsaved));
      const refused = await get(other, ofUser(me.id, mine));
      const unknownUser = await get(admin, ofUser(UNKNOWN_ID, mine));
      const wrongOwner = await get(admin, ofUser(other.id, mine));

      expect([expired.status, code(expired)]).toEqual([410, 'RESULT_EXPIRED']);
      expect([notSaved.status, code(notSaved)]).toEqual([
        404,
        'RESULT_NOT_FOUND',
      ]);
      expect([refused.status, code(refused)]).toEqual([403, 'AUTH_FORBIDDEN']);
      expect([unknownUser.status, code(unknownUser)]).toEqual([
        404,
        'USER_NOT_FOUND',
      ]);
      expect([wrongOwner.status, code(wrongOwner)]).toEqual([
        404,
        'TRANSFORMATION_NOT_FOUND',
      ]);
    });
  });

  it('answers 500 when storage is down, and logs the attempt without the content', async () => {
    const itemId = await converted(me, true);
    const storage = app.get<StoragePort>(STORAGE_PORT);
    const failing = jest
      .spyOn(storage, 'getObject')
      .mockRejectedValueOnce(new StorageUnavailableError('get'));
    const log = jest.spyOn(Logger.prototype, 'log');

    try {
      const res = await get(me, own(itemId));

      expect([res.status, code(res)]).toEqual([500, 'STORAGE_UNAVAILABLE']);
      expect(res.headers['content-disposition']).toBeUndefined();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'download',
          actorUserId: me.id,
          result: 500,
          targetUserId: me.id,
          transformationId: itemId,
        }),
        'result download',
      );
    } finally {
      failing.mockRestore();
      log.mockRestore();
    }
  });

  it('releases the stored object when the client aborts, and logs it as aborted', async () => {
    const itemId = await converted(me, true);
    const prisma = prismaOf(app);
    const { resultFile } = await prisma.transformation.findUniqueOrThrow({
      include: { resultFile: true },
      where: { id: itemId },
    });
    // A result far larger than the socket buffers, so the transfer is still running.
    const big = Buffer.alloc(32 * 1024 * 1024, 0x20);
    await app
      .get<StoragePort>(STORAGE_PORT)
      .putObject(resultFile?.key ?? '', big, {
        contentType: 'application/json',
      });
    await prisma.file.update({
      data: { size: big.length },
      where: { id: resultFile?.id ?? '' },
    });
    const log = jest.spyOn(Logger.prototype, 'log');

    try {
      await me.client.agent
        .get(own(itemId))
        .buffer(true)
        .parse((response, callback) => {
          response.once('data', () => {
            (response as unknown as { destroy: () => void }).destroy();
            callback(null, null);
          });
        })
        .catch(() => undefined);
      const aborted = (): boolean =>
        log.mock.calls.some(
          ([fields, message]) =>
            message === 'result download' &&
            (fields as { result?: unknown }).result === 'aborted',
        );
      for (let i = 0; i < 50 && !aborted(); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(aborted()).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it('cleanup works in batches and skips a run while another instance holds the lock', async () => {
    const prisma = prismaOf(app);
    const past = new Date(Date.now() - 1_000);
    await prisma.transformation.createMany({
      data: Array.from({ length: 450 }, () => ({
        durationMs: 1,
        expiresAt: past,
        fileSize: 1,
        sourceFormat: 'csv',
        status: 'success' as const,
        targetFormat: 'json',
        type: 'file' as const,
        userId: me.id,
      })),
    });
    const cleanup = app.get(HistoryCleanup);

    const skipped = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('transformations.cleanup'))::text`;
      return cleanup.run();
    });

    expect(skipped).toBeNull();
    expect(await cleanup.run()).toBe(450);
    expect(await prisma.transformation.count()).toBe(0);
  });

  it('cleanup removes expired rows with their files and objects, and nothing else', async () => {
    const expired = await converted(me, true);
    const unsavedExpired = await converted(me, false);
    const kept = await converted(me, true);
    const prisma = prismaOf(app);
    await prisma.transformation.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: { in: [expired, unsavedExpired] } },
    });
    const { resultFile } = await prisma.transformation.findUniqueOrThrow({
      include: { resultFile: true },
      where: { id: expired },
    });

    const removed = await app.get(HistoryCleanup).run();
    await app.get(OutboxDispatcher).tick();

    expect(removed).toBe(2);
    const left = await prisma.transformation.findMany({
      where: { userId: me.id },
    });
    expect(left.map((row) => row.id)).toEqual([kept]);
    expect(
      await prisma.file.findUnique({ where: { id: resultFile?.id ?? '' } }),
    ).toBeNull();
    expect(
      await app.get<StoragePort>(STORAGE_PORT).getObject(resultFile?.key ?? ''),
    ).toBeNull();
    expect((await get(me, own(kept))).status).toBe(200);
    expect(await app.get(HistoryCleanup).run()).toBe(0);
  });
});
