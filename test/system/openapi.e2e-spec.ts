import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { parse } from 'yaml';

import { createTestApp } from '../helpers/app';
import { expectContract, spec } from '../helpers/contract';

describe('OpenAPI document', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /openapi.yaml serves the source file', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/openapi.yaml')
      .expect(200);

    expectContract('get', '/api/openapi.yaml', res);
    expect(res.headers['content-type']).toMatch(/^application\/yaml/);
    expect(parse(res.text)).toEqual(spec);
  });

  it('GET /openapi.json serves the same document as JSON', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/openapi.json')
      .expect(200);

    expectContract('get', '/api/openapi.json', res);
    expect(res.body).toEqual(spec);
  });

  it('GET /docs serves Swagger UI bound to the JSON document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs').expect(200);

    expectContract('get', '/api/docs', res);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['content-security-policy']).toMatch(
      /script-src https:\/\/cdn\.jsdelivr\.net\/npm\/swagger-ui-dist@5\/ 'sha256-/,
    );
    expect(res.text).toContain("url: '/api/openapi.json'");
  });

  it('sends hardening headers and no x-powered-by', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows CORS only for trusted origins', async () => {
    const trusted = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'http://localhost:3000');
    const untrusted = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'https://evil.example');

    expect(trusted.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(trusted.headers['access-control-allow-credentials']).toBe('true');
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight only for trusted origins', async () => {
    const preflight = (origin: string): request.Test =>
      request(app.getHttpServer())
        .options('/health/live')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, X-CSRF-Token');

    const trusted = await preflight('http://localhost:3000');
    const untrusted = await preflight('https://evil.example');

    expect(trusted.status).toBe(204);
    expect(trusted.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(trusted.headers['access-control-allow-headers']).toMatch(
      /X-CSRF-Token/,
    );
    expect(untrusted.headers['access-control-allow-origin']).toBeUndefined();
  });
});
