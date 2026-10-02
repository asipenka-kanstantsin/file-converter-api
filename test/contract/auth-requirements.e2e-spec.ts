import type { NestExpressApplication } from '@nestjs/platform-express';

import { createTestApp } from '../helpers/app';
import { spec } from '../helpers/contract';
import { csrfClient } from '../helpers/http';
import { registeredRoutes } from '../helpers/routes';

const ANY_ID = '00000000-0000-4000-8000-000000000000';

interface Operation {
  security?: Record<string, string[]>[];
}

function needsAccessToken(route: string): boolean {
  const [method = '', path = ''] = route.split(' ');
  const operations = spec.paths[path] as
    Record<string, Operation | undefined> | undefined;
  const operation = operations?.[method.toLowerCase()];
  return (operation?.security ?? []).some(
    (requirement) => 'accessCookie' in requirement,
  );
}

// The guard is global and routes opt out with @Public(): this keeps that list in step with the
// `accessCookie` security requirements in openapi.yaml, in both directions.
describe('access-token requirement vs openapi/openapi.yaml', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a session exactly where the contract requires a token', async () => {
    const { agent, csrf } = await csrfClient(app);
    const mismatches: string[] = [];

    for (const route of registeredRoutes(app)) {
      const [method = '', path = ''] = route.split(' ');
      const url = path.replace(/\{\w+\}/g, ANY_ID);
      const res = await agent[
        method.toLowerCase() as 'delete' | 'get' | 'patch' | 'post' | 'put'
      ](url)
        .set('X-CSRF-Token', csrf)
        .send({});
      const unauthenticated =
        res.status === 401 &&
        (res.body as { code?: unknown }).code === 'AUTH_UNAUTHENTICATED';
      if (unauthenticated !== needsAccessToken(route)) {
        mismatches.push(`${route} → ${String(res.status)}`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
