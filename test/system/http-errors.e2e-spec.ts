import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestApp } from '../helpers/app';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract, expectErrorEnvelope } from '../helpers/contract';

describe('HTTP-level errors', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 400 MALFORMED_REQUEST to an unparsable JSON body', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expectContract('get', '/health/live', res);
    expect(res.body).toMatchObject({ code: 'MALFORMED_REQUEST' });
  });

  it('answers 413 PAYLOAD_TOO_LARGE above the JSON body limit', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(1024 * 1024 + 1) }));

    expect(res.status).toBe(413);
    expectContract('get', '/health/live', res);
  });

  it('answers 415 UNSUPPORTED_MEDIA_TYPE to an unsupported charset', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('Content-Type', 'application/json; charset=koi8-r')
      .send('{}');

    expect(res.status).toBe(415);
    expectContract('get', '/health/live', res);
  });

  it('answers 404 ROUTE_NOT_FOUND with the envelope for unknown paths', async () => {
    const res = await request(app.getHttpServer()).get('/does-not-exist');

    expect(res.status).toBe(404);
    expectErrorEnvelope(res, 'ROUTE_NOT_FOUND');
  });
});

describe('rate limiting', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(testConfig({ throttle: { limit: 2, ttlSeconds: 60 } })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 with Retry-After once the window is used up', async () => {
    const server = app.getHttpServer();
    const first = await request(server).get('/api/openapi.json');
    await request(server).get('/api/openapi.json');
    const limited = await request(server).get('/api/openapi.json');

    expectContract('get', '/api/openapi.json', first);
    expect(first.headers['x-ratelimit-limit']).toBe('2');
    expect(limited.status).toBe(429);
    expectContract('get', '/api/openapi.json', limited);
    expect(Number(limited.headers['retry-after'])).toBe(
      (limited.body as { context: { retryAfter: number } }).context.retryAfter,
    );
  });

  it('never throttles health checks', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i++) {
      await request(server).get('/health/live').expect(200);
    }
  });
});
