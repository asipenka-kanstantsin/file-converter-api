import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // `prisma generate` (postinstall) needs no database; migrate/seed fail clearly without one.
  datasource: { url: process.env.DATABASE_URL ?? '' },
  migrations: { path: 'prisma/migrations', seed: 'ts-node prisma/seed.ts' },
  schema: 'prisma/schema.prisma',
});
