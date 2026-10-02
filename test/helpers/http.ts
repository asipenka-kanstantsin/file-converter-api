import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { OutboxDispatcher } from '@/infrastructure/outbox';

export interface CsrfClient {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

// A cookie-keeping client that already holds the CSRF cookie, like a browser after
// GET /api/auth/csrf (09-auth).
export async function csrfClient(
  app: NestExpressApplication,
): Promise<CsrfClient> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.get('/api/auth/csrf').expect(204);
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const csrf = cookies
    .map((cookie) => /^csrf_token=([^;]+)/.exec(cookie)?.[1])
    .find((value) => value !== undefined);
  if (!csrf) throw new Error('csrf_token cookie was not set');
  return { agent, csrf };
}

export async function deliverOutbox(
  app: NestExpressApplication,
): Promise<void> {
  await app.get(OutboxDispatcher).tick();
}

let counter = 0;

export function uniqueEmail(label = 'user'): string {
  counter += 1;
  return `${label}-${String(Date.now())}-${String(counter)}@example.com`;
}
