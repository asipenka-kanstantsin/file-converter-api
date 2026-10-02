import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { createTestApp } from '../helpers/app';
import { AppConfig, testConfig } from '../helpers/config';
import { expectContract } from '../helpers/contract';

describe('health', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/health', '/health/ready'])(
    'GET %s reports the database up',
    async (url) => {
      const res = await request(app.getHttpServer()).get(url).expect(200);

      expectContract('get', url, res);
      expect(res.body).toEqual({ checks: { database: 'up' }, status: 'ok' });
    },
  );

  it('GET /health/live does not touch dependencies', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expectContract('get', '/health/live', res);
    expect(res.body).toEqual({ checks: {}, status: 'ok' });
  });

  it('echoes a valid X-Request-Id and replaces an unsafe one', async () => {
    const valid = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'abc-123');
    const unsafe = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'bad id with spaces');

    expect(valid.headers['x-request-id']).toBe('abc-123');
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('health with the database unreachable', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(AppConfig)
        .useValue(
          testConfig({ db: { url: 'postgresql://app:app@127.0.0.1:1/app' } }),
        ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/health', '/health/ready'])(
    'GET %s answers 503 SERVICE_UNAVAILABLE',
    async (url) => {
      const res = await request(app.getHttpServer()).get(url).expect(503);

      expectContract('get', url, res);
      expect(res.body).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        context: { checks: { database: 'down' } },
      });
    },
  );

  it('GET /health/live still answers 200', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
  });
});
