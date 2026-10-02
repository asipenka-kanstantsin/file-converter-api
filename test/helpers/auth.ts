import type { NestExpressApplication } from '@nestjs/platform-express';

import { RbacAdminService } from '@/modules/rbac';

import { type CsrfClient, csrfClient, uniqueEmail } from './http';

export const PASSWORD = 'correct-horse-42';

export interface SignedInUser {
  client: CsrfClient;
  email: string;
  id: string;
}

// Registers (confirmation off) and signs in; the client keeps the session cookies.
export async function signedInUser(
  app: NestExpressApplication,
  label = 'user',
): Promise<SignedInUser> {
  const client = await csrfClient(app);
  const email = uniqueEmail(label);
  const credentials = { email, password: PASSWORD };
  const registered = await client.agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', client.csrf)
    .send(credentials)
    .expect(201);
  await client.agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', client.csrf)
    .send(credentials)
    .expect(200);
  return {
    client,
    email,
    id: (registered.body as { user: { id: string } }).user.id,
  };
}

// As the operator would with `npm run admin:grant` (decision R7).
export async function signedInAdmin(
  app: NestExpressApplication,
): Promise<SignedInUser> {
  const admin = await signedInUser(app, 'admin');
  await app.get(RbacAdminService).grantAdminByEmail(admin.email);
  return admin;
}
