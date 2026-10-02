import type { NestExpressApplication } from '@nestjs/platform-express';

import { createTestApp } from '../helpers/app';
import { documentedOperations } from '../helpers/contract';
import { registeredRoutes } from '../helpers/routes';

describe('route inventory vs openapi/openapi.yaml', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents every registered route and registers every documented operation', () => {
    const routes = new Set(registeredRoutes(app));
    const documented = new Set(documentedOperations());

    expect(
      [...routes].filter((route) => !documented.has(route)).sort(),
    ).toEqual([]);
    expect(
      [...documented].filter((operation) => !routes.has(operation)).sort(),
    ).toEqual([]);
  });
});
