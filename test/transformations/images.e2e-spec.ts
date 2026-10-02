import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import type request from 'supertest';

import { TransformationsService } from '@/modules/transformations';

import { createTestApp } from '../helpers/app';
import { type SignedInUser, signedInUser } from '../helpers/auth';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';
import { prismaOf, resetDatabase } from '../helpers/db';

const URL = '/api/images/convert';

const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">
  <rect x="0" y="0" width="20" height="20" fill="#ff0000"/>
</svg>`;

function code(res: request.Response): unknown {
  return (res.body as { code?: unknown }).code;
}

// Images arrive as bytes, errors as JSON.
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

describe('POST /api/images/convert', () => {
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

  async function convert(
    file: Buffer | string,
    fields: Record<string, string>,
    filename = 'upload',
  ): Promise<request.Response> {
    let req = me.client.agent.post(URL).set('X-CSRF-Token', me.client.csrf);
    for (const [name, value] of Object.entries(fields))
      req = req.field(name, value);
    const res = await req
      .attach(
        'file',
        Buffer.isBuffer(file) ? file : Buffer.from(file),
        filename,
      )
      .buffer(true)
      .parse(binary as never);
    expectContract('post', URL, res);
    return res;
  }

  function png(width = 32, height = 32, alpha = false): Promise<Buffer> {
    return sharp({
      create: {
        background: alpha ? { alpha: 0, b: 0, g: 0, r: 0 } : '#00ff00',
        channels: alpha ? 4 : 3,
        height,
        width,
      },
    })
      .png()
      .toBuffer();
  }

  it('turns a PNG into a JPEG, transparency onto white, with the requested quality', async () => {
    const source = await sharp({
      create: { background: '#336699', channels: 3, height: 64, width: 64 },
    })
      .composite([{ input: await png(64, 64, true), left: 0, top: 0 }])
      .png()
      .toBuffer();
    const noisy = await sharp(
      Buffer.from(
        Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 37) % 256),
      ),
      {
        raw: { channels: 3, height: 64, width: 64 },
      },
    )
      .png()
      .toBuffer();

    const res = await convert(source, { targetFormat: 'jpeg' });
    const low = await convert(noisy, {
      options: '{"quality":5}',
      targetFormat: 'jpeg',
    });
    const high = await convert(noisy, {
      options: '{"quality":95}',
      targetFormat: 'jpeg',
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="converted.jpg"',
    );
    expect((await sharp(res.body as Buffer).metadata()).format).toBe('jpeg');
    expect((low.body as Buffer).length).toBeLessThan(
      (high.body as Buffer).length,
    );
    const transparent = await convert(await png(8, 8, true), {
      targetFormat: 'jpeg',
    });
    const { data } = await sharp(transparent.body as Buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThan(240);
  });

  it('turns a JPEG into a PNG', async () => {
    const jpeg = await sharp(await png())
      .jpeg()
      .toBuffer();

    const res = await convert(jpeg, { targetFormat: 'png' });

    expect(res.headers['content-type']).toBe('image/png');
    expect((await sharp(res.body as Buffer).metadata()).format).toBe('png');
  });

  it('rasterises an SVG at its intrinsic size, at a requested width, on a background', async () => {
    const intrinsic = await convert(SVG, { targetFormat: 'png' });
    const wide = await convert(SVG, {
      options: '{"width":200}',
      targetFormat: 'jpeg',
    });
    const exact = await convert(SVG, {
      options: '{"background":"#0000ff","height":10,"width":10}',
      targetFormat: 'png',
    });

    expect(await sharp(intrinsic.body as Buffer).metadata()).toMatchObject({
      height: 20,
      width: 40,
    });
    expect(await sharp(wide.body as Buffer).metadata()).toMatchObject({
      format: 'jpeg',
      height: 100,
      width: 200,
    });
    const pixel = await sharp(exact.body as Buffer)
      .extract({ height: 1, left: 9, top: 0, width: 1 })
      .raw()
      .toBuffer();
    expect([...pixel.subarray(0, 3)]).toEqual([0, 0, 255]);
  });

  it('never turns a raster into SVG, nor a format into itself', async () => {
    for (const [file, target] of [
      [await png(), 'svg'],
      [await png(), 'png'],
      [SVG, 'svg'],
    ] as const) {
      const res = await convert(file, { targetFormat: target });
      expect([res.status, code(res)]).toEqual([
        400,
        'CONVERSION_NOT_SUPPORTED',
      ]);
    }
  });

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an event handler', '<rect width="1" height="1" onload="alert(1)"/>'],
    [
      'an external image',
      '<image href="http://evil.example/x.png" width="1" height="1"/>',
    ],
    [
      'a local file',
      '<image xlink:href="file:///etc/passwd" width="1" height="1"/>',
    ],
    [
      'foreignObject',
      '<foreignObject width="1" height="1"><p>x</p></foreignObject>',
    ],
    [
      'a javascript: link',
      '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>',
    ],
    [
      'an external style',
      '<rect width="1" height="1" style="fill:url(http://evil.example/p)"/>',
    ],
  ])('refuses an SVG with %s', async (_label, inner) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="4" height="4">${inner}</svg>`;

    const res = await convert(svg, { targetFormat: 'png' });

    expect([res.status, code(res)]).toEqual([400, 'SVG_UNSAFE']);
  });

  it('refuses an SVG with a DTD (entities), but allows internal fragment references', async () => {
    const dtd = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>`;
    const fragment = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="4" height="4" fill="url(#g)"/></svg>`;

    expect(code(await convert(dtd, { targetFormat: 'png' }))).toBe(
      'SVG_UNSAFE',
    );
    expect((await convert(fragment, { targetFormat: 'png' })).status).toBe(200);
  });

  it('keeps sizes within limits: SVG output maximum and raster decompression bombs', async () => {
    await prismaOf(app).appSetting.create({
      data: { key: 'convert.svg.maxWidth', value: 100 },
    });
    const tooWide = await convert(SVG, {
      options: '{"width":101}',
      targetFormat: 'png',
    });
    const bomb = await sharp({
      create: { background: '#fff', channels: 3, height: 8000, width: 8000 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    expect(tooWide.body).toMatchObject({
      code: 'IMAGE_TOO_LARGE',
      context: { maxHeight: 4096, maxWidth: 100 },
    });
    expect(code(await convert(bomb, { targetFormat: 'jpeg' }))).toBe(
      'IMAGE_TOO_LARGE',
    );
  });

  it('decides the type from the content and refuses broken images', async () => {
    const text = await convert('hello', { targetFormat: 'png' }, 'image.png');
    const truncated = await convert((await png(64, 64)).subarray(0, 60), {
      targetFormat: 'jpeg',
    });
    const named = await convert(
      await png(),
      { targetFormat: 'jpeg' },
      'actually.svg',
    );

    expect([text.status, code(text)]).toEqual([415, 'FILE_TYPE_NOT_SUPPORTED']);
    expect([truncated.status, code(truncated)]).toEqual([
      400,
      'FILE_PARSE_ERROR',
    ]);
    expect(named.status).toBe(200);
  });

  it('validates the options', async () => {
    for (const options of [
      'not json',
      '{"quality":0}',
      '{"quality":101}',
      '{"width":0}',
      '{"background":"red"}',
      '{"dpi":300}',
    ]) {
      const res = await convert(await png(), { options, targetFormat: 'jpeg' });
      expect([res.status, code(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('applies the size limit of the source format', async () => {
    await prismaOf(app).appSetting.create({
      data: { key: 'convert.maxBytes.png', value: 50 },
    });

    const res = await convert(await png(), { targetFormat: 'jpeg' });

    expect(res.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      context: { format: 'png', maxBytes: 50 },
    });
  });

  it('records image conversions and saves on request', async () => {
    await convert(await png(), { save: 'true', targetFormat: 'jpeg' });
    await app.get(TransformationsService).idle();

    const [row] = await prismaOf(app).transformation.findMany({
      where: { userId: me.id },
    });
    expect(row).toMatchObject({
      sourceFormat: 'png',
      status: 'success',
      targetFormat: 'jpeg',
      type: 'image',
    });
    expect(row?.resultFileId).not.toBeNull();
  });

  it('lists the supported directions', async () => {
    const res = await me.client.agent.get('/api/images/convert/formats');

    expectContract('get', '/api/images/convert/formats', res);
    expect(res.body).toEqual([
      { source: 'jpeg', target: ['png'] },
      { source: 'png', target: ['jpeg'] },
      { source: 'svg', target: ['jpeg', 'png'] },
    ]);
  });

  it('refuses a CSS-escaped url() in a presentation attribute (librsvg decodes it as CSS)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="\\75rl(data:image/svg+xml;base64,AA#p)"/></svg>';

    const res = await convert(svg, { targetFormat: 'png' });

    expect([res.status, code(res)]).toEqual([400, 'SVG_UNSAFE']);
  });

  it('refuses an entity-encoded data: reference and records the refusal', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="url&#40;data:image/svg+xml;base64,AA#p)"/></svg>`;

    const res = await convert(svg, { targetFormat: 'png' });

    expect([res.status, code(res)]).toEqual([400, 'SVG_UNSAFE']);
    const [row] = await prismaOf(app).transformation.findMany({
      where: { userId: me.id },
    });
    expect(row).toMatchObject({
      errorCode: 'SVG_UNSAFE',
      sourceFormat: 'svg',
      status: 'error',
    });
  });

  it('downscales an SVG with a huge intrinsic size, sizes one without dimensions by its content, keeps the aspect for one side', async () => {
    const huge = `<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="50000"><rect width="100000" height="50000" fill="#f00"/></svg>`;
    const sizeless = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`;

    const small = await convert(huge, {
      options: '{"width":512}',
      targetFormat: 'png',
    });
    const fallback = await convert(sizeless, { targetFormat: 'png' });
    const tall = await convert(SVG, {
      options: '{"height":50}',
      targetFormat: 'png',
    });

    expect(await sharp(small.body as Buffer).metadata()).toMatchObject({
      height: 256,
      width: 512,
    });
    // No width/height/viewBox: librsvg takes the content's bounds as the intrinsic size.
    expect(await sharp(fallback.body as Buffer).metadata()).toMatchObject({
      height: 10,
      width: 10,
    });
    expect(await sharp(tall.body as Buffer).metadata()).toMatchObject({
      height: 50,
      width: 100,
    });
  });

  it('applies EXIF orientation, so a phone photo stays upright', async () => {
    const rotated = await sharp({
      create: { background: '#808080', channels: 3, height: 20, width: 40 },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const res = await convert(rotated, { targetFormat: 'png' });

    expect(await sharp(res.body as Buffer).metadata()).toMatchObject({
      height: 40,
      width: 20,
    });
  });

  it('refuses a JPEG decompression bomb and an alpha background, and unknown fields', async () => {
    const bomb = await sharp({
      create: { background: '#fff', channels: 3, height: 8000, width: 8000 },
    })
      .jpeg({ quality: 1 })
      .toBuffer();

    expect(code(await convert(bomb, { targetFormat: 'png' }))).toBe(
      'IMAGE_TOO_LARGE',
    );
    expect(
      code(
        await convert(SVG, {
          options: '{"background":"#ff000080"}',
          targetFormat: 'png',
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(code(await convert(SVG, { extra: '1', targetFormat: 'png' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('POST /api/images/convert with a tiny timeout', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(testConfig({ conversion: { timeoutMs: 50 } })),
    );
    await resetDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('kills an SVG render that overruns and answers 400 CONVERSION_TIMEOUT', async () => {
    const me = await signedInUser(app);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;

    const res = await me.client.agent
      .post(URL)
      .set('X-CSRF-Token', me.client.csrf)
      .field('targetFormat', 'png')
      .field('options', '{"width":4096,"height":4096}')
      .attach('file', Buffer.from(svg), 'x.svg');

    expectContract('post', URL, res);
    expect([res.status, code(res)]).toEqual([400, 'CONVERSION_TIMEOUT']);
  });
});
