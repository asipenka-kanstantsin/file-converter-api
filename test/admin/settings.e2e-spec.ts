import type { NestExpressApplication } from '@nestjs/platform-express';
import type request from 'supertest';

import { createTestApp } from '../helpers/app';
import {
  signedInAdmin,
  signedInUser,
  type SignedInUser,
} from '../helpers/auth';
import { expectContract } from '../helpers/contract';
import { resetDatabase } from '../helpers/db';
import { csrfClient, uniqueEmail } from '../helpers/http';

const URL = '/api/admin/settings';

describe('admin settings', () => {
  let app: NestExpressApplication;
  let admin: SignedInUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    admin = await signedInAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function patch(body: object): Promise<request.Response> {
    const res = await admin.client.agent
      .patch(URL)
      .set('X-CSRF-Token', admin.client.csrf)
      .send(body);
    expectContract('patch', URL, res);
    return res;
  }

  it('lists every setting with its default', async () => {
    const res = await admin.client.agent.get(URL);

    expectContract('get', URL, res);
    expect(res.body).toMatchObject({
      settings: {
        'confirmation.login': false,
        'confirmation.registration': false,
        'convert.maxBytes.csv': 10 * 1024 * 1024,
        'convert.maxBytes.png': 15 * 1024 * 1024,
        'convert.svg.maxWidth': 4096,
        'history.retentionDays': 90,
      },
    });
  });

  it('changes a numeric setting within its bounds only', async () => {
    const ok = await patch({ 'convert.maxBytes.csv': 1024 });
    expect(ok.body).toMatchObject({
      settings: { 'convert.maxBytes.csv': 1024 },
    });

    for (const body of [
      { 'convert.maxBytes.csv': 0 },
      { 'history.retentionDays': 1.5 },
      { 'convert.svg.maxWidth': 100_000 },
    ]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
    }
  });

  it('changes only the given keys, and the change applies at once', async () => {
    const res = await patch({ 'confirmation.registration': true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      settings: {
        'confirmation.login': false,
        'confirmation.registration': true,
      },
    });
    const { agent, csrf } = await csrfClient(app);
    const registered = await agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({ email: uniqueEmail(), password: 'correct-horse-42' });
    expect(registered.status).toBe(202);
  });

  it('refuses unknown keys, wrong types and an empty change', async () => {
    for (const body of [
      { 'confirmation.signup': true },
      { 'confirmation.login': 'yes' },
      {},
    ]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('refuses a user without settings@manage', async () => {
    const user = await signedInUser(app);

    const res = await user.client.agent
      .patch(URL)
      .set('X-CSRF-Token', user.client.csrf)
      .send({ 'confirmation.login': true });

    expectContract('patch', URL, res);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });
});
