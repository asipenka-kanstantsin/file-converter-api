import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const DATABASE = 'app_test';
const PASSWORD = 'app';
const PROBE_TIMEOUT_MS = 2_000;
const USER = 'app';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('no free port'));
      });
    });
  });
}

// Whether a server is already listening on the configured URL — docker compose locally, a service
// container in CI. Anything else (wrong password, missing database) counts as unreachable, so the
// run falls back to a cluster it owns rather than failing half-way through the migrations.
async function reachable(url: string): Promise<boolean> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// A PostgreSQL 18 cluster of this run's own: real binaries from the `embedded-postgres` package,
// a fresh data directory under the temp dir, removed again on teardown (`persistent: false`).
// So `npm run test:e2e` needs no docker — `18-testing`.
async function startEmbedded(): Promise<{
  stop: () => Promise<void>;
  url: string;
}> {
  const port = await freePort();
  const postgres = new EmbeddedPostgres({
    authMethod: 'password',
    createPostgresUser: false,
    databaseDir: join(mkdtempSync(join(tmpdir(), 'fc-e2e-pg-')), 'data'),
    onError: () => undefined,
    onLog: () => undefined,
    password: PASSWORD,
    persistent: false,
    port,
    postgresFlags: [
      // initdb takes the host's zone, the postgres image runs UTC. Timestamps reach the server
      // without an offset, so the zone decides what a `timestamptz` means: anything but UTC
      // shifts every stored instant (16-git: `timestamptz` in UTC).
      '-c',
      'timezone=UTC',
      '-c',
      'log_timezone=UTC',
      // A cluster thrown away at the end of the run has nothing to recover, and native Windows
      // fsync is slow enough to time out the suites' seeds without this.
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ],
    user: USER,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(DATABASE);
  return {
    stop: () => postgres.stop(),
    url: `postgresql://${USER}:${PASSWORD}@127.0.0.1:${String(port)}/${DATABASE}`,
  };
}

export interface TestDatabase {
  stop: () => Promise<void>;
  url: string;
}

export async function startTestDatabase(
  configured: string,
): Promise<TestDatabase> {
  if (await reachable(configured)) {
    return { stop: () => Promise.resolve(), url: configured };
  }
  return startEmbedded();
}
