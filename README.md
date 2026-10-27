# File Converter API

Back End for the Innowise training "[A] Обучение Back End для Front End разработчиков": convert
files between CSV, JSON, XML and YAML and images between PNG, JPEG and SVG, with user accounts,
e-mail confirmation, DB-driven RBAC, conversion history and saved results.

NestJS 11 · TypeScript strict · PostgreSQL 18 · Prisma 7 · zod 4 · contract-first OpenAPI 3.1.

## Run locally

Requirements: Node.js 24 (`.nvmrc`). Docker for the dev stack — the tests do not need it.

```bash
npm ci                    # also generates the Prisma client
cp .env.example .env
docker compose up -d      # dev stack: Postgres 18, Mailpit (UI :8025), SeaweedFS S3 (:8333)
npm run db:migrate
npm run start:dev         # http://localhost:3001
```

- Health: `GET /health`, `/health/live`, `/health/ready`
- Contract: `GET /api/openapi.yaml` (source: [`openapi/openapi.yaml`](openapi/openapi.yaml))

The credentials in `docker-compose.yml`, `docker/`, `.env.example` and `.env.test` (`app:app`,
`readonly`, `s3-secret-key`) are throwaway values for local containers only.

## Quality gate

```bash
npm run verify   # format, lint, typecheck, OpenAPI lint, unit + e2e tests with ≥ 80 % coverage, build
```

`verify` needs no docker. The e2e suites use the `.env.test` Postgres when one answers there and
otherwise start a PostgreSQL 18 cluster of their own (`embedded-postgres`, dropped afterwards), and
mail goes to an SMTP server inside the test process instead of Mailpit. Every e2e response is
validated against `openapi/openapi.yaml`, and a route-inventory test keeps routes and the spec in
sync.

The one suite that does need the dev stack is the S3 adapter's:

```bash
docker compose up -d && npm run test:e2e:s3
```

## Deploying

```bash
docker build -t file-converter-api .
docker build -t file-converter-api-migrate --target migrate .   # release step
```

The runtime image carries `dist/` and the production dependencies only; it runs as `node` and its
`HEALTHCHECK` polls `/health/ready`.

**Every release applies the migration chain before the new version starts.** The `migrate` target
exists for exactly that — it keeps the dev dependencies, because the Prisma CLI is one and
`prisma.config.ts` is what carries the datasource URL:

```bash
docker run --rm -e DATABASE_URL=... file-converter-api-migrate
```

Migrations are **forward-fix only**: there are no down migrations, and a bad one is corrected by
appending another, never by editing or reverting a migration that has been applied anywhere. CI
runs `npm run db:drift` so the chain and `prisma/schema.prisma` cannot diverge unnoticed.

Required configuration is in [`.env.example`](.env.example); the process exits on startup if any
of it is invalid. In production the config additionally refuses placeholder secrets, an `APP_TRUST_PROXY`
that was never set, non-HTTPS CORS origins and SMTP without credentials.

### One instance at a time

Several pieces of state live in process memory, so the API **must run as a single replica** until
they move to Postgres or Redis:

| State | Where | What a second replica would break |
|---|---|---|
| RBAC roles, permissions and grants | `RbacService` snapshot | A grant revoked on one replica stays in force on the others until restart |
| Sign-in lockout | `LoginLockout` | The failure count is per replica, so the limit is effectively multiplied |
| Rate limiting | `@nestjs/throttler` in-memory store | Same |
| Per-account conversion slots | `UserSlots` | Same |
| Background saves in flight | `TransformationsService` | Only the cap, which is per replica by design |

## Where things are

| Path | What |
| --- | --- |
| `openapi/openapi.yaml` | The HTTP contract — written before the code |
| `docs/decisions.md` | How the open points of the Notion spec were resolved; task ids FC-0…FC-13 |
| `docs/requirements/` | Notion export (`npm run requirements:fetch`), git-ignored — confidential |
| `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.claude/` | Rules and workflows for AI agents and humans |
