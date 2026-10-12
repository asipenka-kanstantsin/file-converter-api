import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'dotenv';

import { type MailSink, startMailSink } from './mail-sink';
import { startTestDatabase, type TestDatabase } from './postgres';

declare global {
  var __E2E_INFRA__: { database: TestDatabase; mail?: MailSink } | undefined;
}

// Brings up everything the e2e suites talk to, so a run needs no docker: a PostgreSQL cluster
// (the configured one if it answers, otherwise an embedded one of this run's own) with the
// migrations applied, and an SMTP sink in place of Mailpit. Both are addressed through
// environment variables, which win over `.env.test` (`loadAppConfig`).
export default async function globalSetup(): Promise<void> {
  const root = join(__dirname, '..', '..');
  const testEnv = parse(readFileSync(join(root, '.env.test')));
  const configured = testEnv.DATABASE_URL;
  if (!configured) throw new Error('.env.test has no DATABASE_URL');

  const database = await startTestDatabase(configured);
  // Registered before the migrations run: a failure there must still leave the cluster for
  // globalTeardown to stop, or an embedded one would outlive the run.
  globalThis.__E2E_INFRA__ = { database };
  process.env.DATABASE_URL = database.url;
  execSync('npx prisma migrate deploy', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: database.url },
    stdio: 'pipe',
  });

  const mail = await startMailSink();
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(mail.smtpPort);
  process.env.MAIL_SINK_URL = mail.readUrl;

  globalThis.__E2E_INFRA__ = { database, mail };
}
