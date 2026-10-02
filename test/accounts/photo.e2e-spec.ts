import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import type request from 'supertest';

import {
  STORAGE_PORT,
  type StoragePort,
  StorageUnavailableError,
} from '@/infrastructure/storage';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';
import { deliverOutbox } from '../helpers/http';

function png(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: { background: '#3366ff', channels: 3, height, width },
  })
    .png()
    .toBuffer();
}

// A JPEG carrying EXIF (camera model, GPS-like data) that must not survive the upload.
function jpegWithExif(): Promise<Buffer> {
  return sharp({
    create: { background: '#ff6633', channels: 3, height: 32, width: 32 },
  })
    .jpeg()
    .withExif({ IFD0: { Make: 'SecretCam', Model: 'X-1' } })
    .toBuffer();
}

// Images arrive as bytes, errors as JSON: parse each by its content type.
function binary(
  res: request.Response,
  callback: (error: Error | null, body: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => {
    const body = Buffer.concat(chunks);
    const json = String(res.headers['content-type']).startsWith(
      'application/json',
    );
    callback(
      null,
      json ? (JSON.parse(body.toString('utf8')) as unknown) : body,
    );
  });
}

describe('profile photo', () => {
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

  async function upload(
    who: SignedInUser,
    userId: string,
    body: Buffer,
    filename = 'photo.png',
  ): Promise<request.Response> {
    const url = `/api/users/${userId}/photo`;
    const res = await who.client.agent
      .put(url)
      .set('X-CSRF-Token', who.client.csrf)
      .attach('file', body, filename);
    expectContract('put', url, res);
    return res;
  }

  async function download(
    who: SignedInUser,
    userId: string,
  ): Promise<request.Response> {
    const url = `/api/users/${userId}/photo`;
    const res = await who.client.agent
      .get(url)
      .buffer(true)
      .parse(binary as never);
    expectContract('get', url, res);
    return res;
  }

  function code(res: request.Response): unknown {
    return (res.body as { code?: unknown }).code;
  }

  it('stores a PNG and serves it back through the API, never as a storage URL', async () => {
    const me = await signedInUser(app);

    const res = await upload(me, me.id, await png(2000, 1000));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      profile: { photo: `/api/users/${me.id}/photo` },
    });
    const photo = await download(me, me.id);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect(photo.headers['cache-control']).toBe('private, no-store');
    const meta = await sharp(photo.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1024, 512]);
  });

  it('re-encodes a JPEG without its metadata', async () => {
    const me = await signedInUser(app);
    const original = await jpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    await upload(me, me.id, original, 'camera.jpg');
    const photo = await download(me, me.id);

    expect(photo.headers['content-type']).toBe('image/jpeg');
    const meta = await sharp(photo.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect((photo.body as Buffer).includes('SecretCam')).toBe(false);
  });

  it('decides the type from the content: text named .png is 415', async () => {
    const me = await signedInUser(app);

    const res = await upload(
      me,
      me.id,
      Buffer.from('not an image at all'),
      'x.png',
    );
    const gif = await upload(
      me,
      me.id,
      await sharp({
        create: { background: '#000', channels: 3, height: 4, width: 4 },
      })
        .gif()
        .toBuffer(),
      'x.png',
    );

    expect([res.status, code(res)]).toEqual([415, 'FILE_TYPE_NOT_SUPPORTED']);
    expect([gif.status, code(gif)]).toEqual([415, 'FILE_TYPE_NOT_SUPPORTED']);
  });

  it('refuses a decompression bomb and truncated image data with 415', async () => {
    const me = await signedInUser(app);
    const bomb = await sharp({
      create: { background: '#fff', channels: 3, height: 8000, width: 8000 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const jpeg = await sharp({
      create: { background: '#f00', channels: 3, height: 200, width: 200 },
    })
      .jpeg()
      .toBuffer();

    const big = await upload(me, me.id, bomb);
    const cut = await upload(me, me.id, jpeg.subarray(0, 200), 'cut.jpg');

    expect([big.status, code(big)]).toEqual([415, 'FILE_TYPE_NOT_SUPPORTED']);
    expect([cut.status, code(cut)]).toEqual([415, 'FILE_TYPE_NOT_SUPPORTED']);
  });

  it('refuses a file over 5 MB with 413 and the limit, and a request without a file with 400', async () => {
    const me = await signedInUser(app);

    const big = await upload(me, me.id, Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    const none = await me.client.agent
      .put(`/api/users/${me.id}/photo`)
      .set('X-CSRF-Token', me.client.csrf)
      .field('other', 'x');

    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      context: { maxBytes: 5 * 1024 * 1024 },
    });
    expectContract('put', `/api/users/${me.id}/photo`, none);
    expect([none.status, code(none)]).toEqual([400, 'MALFORMED_REQUEST']);
  });

  it('replaces the previous photo and removes its object after commit', async () => {
    const me = await signedInUser(app);
    await upload(me, me.id, await png());
    const prisma = prismaOf(app);
    const first = await prisma.file.findFirstOrThrow({
      where: { ownerId: me.id },
    });

    await upload(me, me.id, await png(80, 80));
    await deliverOutbox(app);

    const files = await prisma.file.findMany({ where: { ownerId: me.id } });
    expect(files).toHaveLength(1);
    expect(files[0]?.id).not.toBe(first.id);
    expect(
      await app.get<StoragePort>(STORAGE_PORT).getObject(first.key),
    ).toBeNull();
  });

  it('applies Self-or-permission: users@read to see, users@update to change', async () => {
    const me = await signedInUser(app);
    const other = await signedInUser(app, 'other');
    const admin = await signedInAdmin(app);
    await upload(me, me.id, await png());

    const peek = await download(other, me.id);
    const overwrite = await upload(other, me.id, await png());
    const seen = await download(admin, me.id);
    const replaced = await upload(admin, me.id, await png(10, 10));

    expect([peek.status, code(peek)]).toEqual([403, 'AUTH_FORBIDDEN']);
    expect([overwrite.status, code(overwrite)]).toEqual([
      403,
      'AUTH_FORBIDDEN',
    ]);
    expect(seen.status).toBe(200);
    expect(replaced.status).toBe(200);
  });

  it('removes the photo idempotently; then there is none', async () => {
    const me = await signedInUser(app);
    await upload(me, me.id, await png());
    const url = `/api/users/${me.id}/photo`;

    for (let i = 0; i < 2; i++) {
      const res = await me.client.agent
        .delete(url)
        .set('X-CSRF-Token', me.client.csrf);
      expectContract('delete', url, res);
      expect(res.status).toBe(204);
    }
    const gone = await download(me, me.id);
    expect([gone.status, code(gone)]).toEqual([404, 'PHOTO_NOT_FOUND']);
    const profile = await me.client.agent.get(`/api/users/${me.id}`);
    expect(profile.body).toMatchObject({ profile: { photo: null } });
  });
});

describe('profile photo with the storage down', () => {
  let app: NestExpressApplication;
  const broken: StoragePort = {
    deleteObject: () => Promise.reject(new StorageUnavailableError('delete')),
    getObject: () => Promise.reject(new StorageUnavailableError('get')),
    putObject: () => Promise.reject(new StorageUnavailableError('put')),
  };

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(STORAGE_PORT).useValue(broken),
    );
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 500 STORAGE_UNAVAILABLE and records nothing', async () => {
    const me = await signedInUser(app);
    const url = `/api/users/${me.id}/photo`;

    const res = await me.client.agent
      .put(url)
      .set('X-CSRF-Token', me.client.csrf)
      .attach('file', await png(), 'photo.png');

    expectContract('put', url, res);
    expect([res.status, (res.body as { code: string }).code]).toEqual([
      500,
      'STORAGE_UNAVAILABLE',
    ]);
    expect(await prismaOf(app).file.count()).toBe(0);
  });
});
