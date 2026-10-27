import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  // `prisma generate` (postinstall) needs no database; migrate/seed fail clearly without one.
  datasource: { url: process.env.DATABASE_URL ?? '' },
  // No seed: the roles, permissions and the protected admin grant are created at startup by
  // RbacService.ensureSystemConfiguration (decisions R3, R6), so a fresh database needs no step.
  migrations: { path: 'prisma/migrations' },
  schema: 'prisma/schema.prisma',
});
