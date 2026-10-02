import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

import { STORAGE_PORT, type StoragePort } from '@/infrastructure/storage';
import { TransformationsService } from '@/modules/transformations';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  type SignedInUser,
  signedInUser,
} from '../helpers/auth';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

const URL = '/api/convert';
const CSV = 'name,age\nAda,36\nAlan,41\n';

function code(res: request.Response): unknown {
  return (res.body as { code?: unknown }).code;
}

async function convert(
  _app: NestExpressApplication,
  who: SignedInUser,
  file: Buffer | string,
  filename: string,
  fields: Record<string, string>,
): Promise<request.Response> {
  let req = who.client.agent.post(URL).set('X-CSRF-Token', who.client.csrf);
  for (const [name, value] of Object.entries(fields))
    req = req.field(name, value);
  const res = await req
    .attach('file', Buffer.isBuffer(file) ? file : Buffer.from(file), filename)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const json = String(response.headers['content-type']).startsWith(
          'application/json',
        );
        callback(null, json ? (JSON.parse(body) as unknown) : body);
      });
    });
  expectContract('post', URL, res);
  return res;
}

describe('POST /api/convert', () => {
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

  async function setting(key: string, value: number): Promise<void> {
    await prismaOf(app).appSetting.upsert({
      create: { key, value },
      update: { value },
      where: { key },
    });
  }

  function history(): Promise<
    {
      errorCode: null | string;
      resultFileId: null | string;
      sourceFormat: null | string;
      status: string;
    }[]
  > {
    return prismaOf(app).transformation.findMany({
      orderBy: { createdAt: 'asc' },
      where: { userId: me.id },
    });
  }

  it('converts CSV to JSON as a whole file, and records the attempt', async () => {
    const res = await convert(app, me, CSV, 'people.csv', {
      targetFormat: 'json',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="converted.json"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual([
      { age: '36', name: 'Ada' },
      { age: '41', name: 'Alan' },
    ]);
    const [row] = await history();
    expect(row).toMatchObject({
      errorCode: null,
      fileSize: CSV.length,
      resultFileId: null,
      sourceFormat: 'csv',
      status: 'success',
      targetFormat: 'json',
      type: 'file',
    });
  });

  it.each([
    ['json', 'xml', '[{"a":"1"}]', 'x.json', '<?xml'],
    ['xml', 'yaml', '<r><a>1</a></r>', 'x.xml', 'r:'],
    ['yaml', 'csv', '- a: "1"\n', 'x.yaml', 'a\r\n1'],
  ])('%s → %s', async (_source, target, input, filename, expected) => {
    const res = await convert(app, me, input, filename, {
      targetFormat: target,
    });

    expect(res.status).toBe(200);
    expect(String(res.text || res.body)).toContain(expected);
  });

  it('detects XML and JSON from the content when the name says nothing', async () => {
    const xml = await convert(app, me, '<r><a>1</a></r>', 'upload', {
      targetFormat: 'json',
    });
    const csv = await convert(app, me, CSV, 'upload', { targetFormat: 'json' });
    const binary = await convert(app, me, 'just text', 'photo.png', {
      targetFormat: 'json',
    });

    expect(xml.status).toBe(200);
    expect([csv.status, code(csv)]).toEqual([415, 'FILE_TYPE_NOT_SUPPORTED']);
    expect([binary.status, code(binary)]).toEqual([
      415,
      'FILE_TYPE_NOT_SUPPORTED',
    ]);
  });

  it('refuses bad input with the matching code, and records each attempt as an error', async () => {
    const cases: [
      Buffer | string,
      string,
      Record<string, string>,
      number,
      string,
    ][] = [
      [CSV, 'x.csv', { targetFormat: 'csv' }, 400, 'CONVERSION_NOT_SUPPORTED'],
      ['', 'x.csv', { targetFormat: 'json' }, 400, 'FILE_EMPTY'],
      ['{"a":', 'x.json', { targetFormat: 'csv' }, 400, 'FILE_PARSE_ERROR'],
      [
        Buffer.from([0x61, 0xc3, 0x28]),
        'x.csv',
        { targetFormat: 'json' },
        400,
        'FILE_ENCODING_INVALID',
      ],
      [
        '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>',
        'x.xml',
        { targetFormat: 'json' },
        400,
        'FILE_PARSE_ERROR',
      ],
      [
        `${'['.repeat(200)}${']'.repeat(200)}`,
        'x.json',
        { targetFormat: 'yaml' },
        400,
        'STRUCTURE_TOO_COMPLEX',
      ],
    ];
    for (const [file, name, fields, status, expected] of cases) {
      const res = await convert(app, me, file, name, fields);
      expect([res.status, code(res)]).toEqual([status, expected]);
    }
    const rows = await history();
    expect(rows.map((row) => row.errorCode)).toEqual(
      cases.map((entry) => entry[4]),
    );
    expect(rows.every((row) => row.status === 'error')).toBe(true);
  });

  it('validates the fields before converting', async () => {
    const target = await convert(app, me, CSV, 'x.csv', {
      targetFormat: 'pdf',
    });
    const flag = await convert(app, me, CSV, 'x.csv', {
      save: 'yes',
      targetFormat: 'json',
    });
    const extra = await convert(app, me, CSV, 'x.csv', {
      mode: 'x',
      targetFormat: 'json',
    });
    const none = await me.client.agent
      .post(URL)
      .set('X-CSRF-Token', me.client.csrf)
      .field('targetFormat', 'json');

    for (const res of [target, flag, extra]) {
      expect([res.status, code(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect([none.status, code(none)]).toEqual([400, 'MALFORMED_REQUEST']);
    expect(await history()).toHaveLength(0);
  });

  it('applies the size limit of the source format, read at request time', async () => {
    await setting('convert.maxBytes.csv', 10);

    const res = await convert(app, me, CSV, 'x.csv', { targetFormat: 'json' });
    const json = await convert(app, me, '[{"a":"1"}]', 'x.json', {
      targetFormat: 'csv',
    });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      context: { format: 'csv', maxBytes: 10 },
    });
    expect(json.status).toBe(200);
    expect((await history())[0]).toMatchObject({ errorCode: 'FILE_TOO_LARGE' });
  });

  it('cuts off an upload larger than every text limit while streaming', async () => {
    for (const format of ['csv', 'json', 'xml', 'yaml']) {
      await setting(`convert.maxBytes.${format}`, 16);
    }

    const res = await convert(app, me, 'x'.repeat(64), 'x.csv', {
      targetFormat: 'json',
    });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      context: { maxBytes: 16 },
    });
  });

  it('saves the result after responding when save=true, and only then', async () => {
    await convert(app, me, CSV, 'x.csv', { targetFormat: 'json' });
    await convert(app, me, CSV, 'x.csv', {
      save: 'true',
      targetFormat: 'yaml',
    });
    await app.get(TransformationsService).idle();

    const [plain, saved] = await history();
    expect(plain?.resultFileId).toBeNull();
    expect(saved?.resultFileId).not.toBeNull();
    const file = await prismaOf(app).file.findUniqueOrThrow({
      where: { id: saved?.resultFileId ?? '' },
    });
    expect(file).toMatchObject({
      mime: 'application/yaml; charset=utf-8',
      originalName: 'converted.yaml',
      ownerId: me.id,
      purpose: 'transformation_result',
    });
    expect(file.expiresAt).not.toBeNull();
    const object = await app.get<StoragePort>(STORAGE_PORT).getObject(file.key);
    expect(object).not.toBeNull();
    object?.body.destroy();
  });

  it('lists the 12 supported directions', async () => {
    const res = await me.client.agent.get('/api/convert/formats');

    expectContract('get', '/api/convert/formats', res);
    expect(res.body).toEqual([
      { source: 'csv', target: ['json', 'xml', 'yaml'] },
      { source: 'json', target: ['csv', 'xml', 'yaml'] },
      { source: 'xml', target: ['csv', 'json', 'yaml'] },
      { source: 'yaml', target: ['csv', 'json', 'xml'] },
    ]);
  });

  it("removes the user's history with the account", async () => {
    const admin = await signedInAdmin(app);
    await convert(app, me, CSV, 'x.csv', {
      save: 'true',
      targetFormat: 'json',
    });
    await app.get(TransformationsService).idle();

    await admin.client.agent
      .delete(`/api/users/${me.id}`)
      .set('X-CSRF-Token', admin.client.csrf)
      .expect(204);

    expect(
      await prismaOf(app).transformation.count({ where: { userId: me.id } }),
    ).toBe(0);
    expect(await prismaOf(app).file.count({ where: { ownerId: me.id } })).toBe(
      0,
    );
  });
});

describe('POST /api/convert with a tiny timeout', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(testConfig({ conversion: { timeoutMs: 1 } })),
    );
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 400 CONVERSION_TIMEOUT and records it', async () => {
    const me = await signedInUser(app);
    const rows = Array.from(
      { length: 20_000 },
      (_, i) => `${String(i)},value-${String(i)}`,
    );

    const res = await convert(
      app,
      me,
      `id,v\n${rows.join('\n')}\n`,
      'big.csv',
      {
        targetFormat: 'xml',
      },
    );

    expect([res.status, code(res)]).toEqual([400, 'CONVERSION_TIMEOUT']);
    const [row] = await prismaOf(app).transformation.findMany({
      where: { userId: me.id },
    });
    expect(row?.errorCode).toBe('CONVERSION_TIMEOUT');
  });
});
