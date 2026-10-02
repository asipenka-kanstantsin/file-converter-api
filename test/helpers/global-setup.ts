import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'dotenv';

// Applies migrations to the test database once per run (.env.test → app_test).
export default function globalSetup(): void {
  const root = join(__dirname, '..', '..');
  const testEnv = parse(readFileSync(join(root, '.env.test')));
  execSync('npx prisma migrate deploy', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: testEnv.DATABASE_URL },
    stdio: 'pipe',
  });
}
