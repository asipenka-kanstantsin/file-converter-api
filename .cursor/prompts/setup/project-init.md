# Project Initialization Prompt

## Role

You are a senior backend architect bootstrapping a production-ready NestJS API.

Follow:

- `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`
- `00-project`, `01-architecture`, `02-typescript`, `03-nestjs`, `05-api-design`, `06-validation`,
  `07-database-*`, `08-errors`, `09-auth`, `10-config`, `14-logging`, `18-testing`, `19-security`

---

# Goal

A foundation that is predictable for developers and agents: strict types, enforced boundaries, a
generated contract, a real database in tests, and one command (`npm run verify`) as the PR gate.

Do each step as a separate, reviewable commit. Do not add domain modules yet beyond `health`.

---

# Step 1 — Environment check

- Node 24 LTS (pin in `.nvmrc` and `engines`), npm, Docker + Compose
- no global CLIs assumed; use `npx`

# Step 2 — Create the app

```bash
npx @nestjs/cli@11 new api --package-manager npm --strict --skip-git
```

- pin the CLI to 11: version 12 generates ESM + Vitest + oxlint, which this kit does not describe and
  `nestjs-zod` does not support; install every `@nestjs/*` package at major 11
- remove the sample controller/service; keep `main.ts`, `app.module.ts`
- create `src/config`, `src/common`, `src/infrastructure`, `src/modules`, `test/helpers`

# Step 3 — Strict TypeScript and alias

`tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`exactOptionalPropertyTypes` (if the ORM tolerates it), `forceConsistentCasingInFileNames`,
`paths: { "@/*": ["src/*"] }`, `baseUrl: "."`. Add `tsc-alias` or Nest's `tsconfig-paths` so the
build resolves `@/`. `npm run typecheck` = `tsc --noEmit`.

# Step 4 — Lint and format

- ESLint flat config with `typescript-eslint` (strict-type-checked), `eslint-plugin-perfectionist`
  (sorted object keys, interfaces, imports), `no-restricted-imports` layer rules enforcing `config ← common ← infrastructure ← modules` and no deep
  imports into another module
- rules: `no-console`, `@typescript-eslint/no-explicit-any`, `no-non-null-assertion`,
  `import/no-default-export`
- Prettier; `format`, `format:check`, `lint`, `lint:fix` scripts. The generated `lint` script ends
  with `--fix` — remove it: `lint` checks, `lint:fix` fixes

# Step 5 — Validation

`zod` 4 + `nestjs-zod` 5: global `ZodValidationPipe`, `ZodSerializerInterceptor`, and
no `@nestjs/swagger`. No `class-validator`.

# Step 6 — Config module

`src/config/env.schema.ts` (zod) → `AppConfig` typed object; `AppConfigModule` global (no `@nestjs/config`); the process
exits on invalid env with a message listing the failing keys. `.env.example` mirrors the schema
(`environment.md`).

# Step 7 — ORM

Pick **one** — Prisma or TypeORM — and delete the other knowledge file
(`07-database-prisma.mdc` / `07-database-typeorm.mdc`) and the ORM placeholders in `CLAUDE.md`/
`AGENTS.md`.

- `infrastructure/database`: client provider, transaction helper, graceful shutdown
- migrations folder, `db:migrate`, `db:generate`, `db:seed` scripts
- Prisma 7: `prisma.config.ts`, `prisma-client` generator into `src/generated/prisma`,
  `@prisma/adapter-pg`, `postinstall: prisma generate` (`07-database-prisma.mdc`)
- naming: snake_case tables/columns mapped to camelCase

# Step 8 — Local infrastructure

`docker-compose.yml` with `postgres:18-alpine`, `axllent/mailpit`, `chrislusf/seaweedfs` S3 (+ bucket init). See
`environment.md`.

# Step 9 — Logging

`nestjs-pino`: JSON in prod, pretty in dev; request id (from `X-Request-Id` or generated) on every
line; redact `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.code`,
`*.email`.

# Step 10 — HTTP hardening

In `main.ts`: global prefix `api` (health excluded), `helmet`, `cookie-parser`, CORS allow-list from
`APP_CORS_ORIGINS` with `credentials: true`, body size limit, `enableShutdownHooks()`, trust proxy per
deployment. `@nestjs/throttler` global with per-route overrides.

# Step 11 — OpenAPI (contract-first)

`openapi/openapi.yaml` (OpenAPI 3.1) written by hand: info, cookie security scheme, error envelope
and cursor-page components, `/health`. `@redocly/cli` + `npm run openapi:lint`. `OpenApiController`
serves the file at `/api/openapi.yaml` and `/api/openapi.json`. `test/helpers/contract.ts` (Ajv 2020) and
the route-inventory spec (`18-testing.mdc`). No `@nestjs/swagger`.

# Step 12 — Errors

`common/errors`: `ErrorCode` enum, `AppException`, envelope types. `common/filters/
all-exceptions.filter.ts` per `08-errors.mdc` (AppException, zod, ORM constraint map, throttler,
fallback 500). Locale catalogues for error `detail` under the i18n folder (`13-i18n.mdc`).

# Step 13 — Auth skeleton

Global `JwtAuthGuard`, `PermissionGuard`, `CsrfGuard`; `@Public()`, `@RequirePermission()`, `@CurrentUser()`
decorators. Implementation of flows comes later (`09-auth.mdc`).

# Step 14 — Health

`modules/health` (own controller, no `@nestjs/terminus`): `GET /health/live` (liveness, public) and
`GET /health/ready` (DB ping), per `14-logging.mdc`. No secrets in output.

# Step 15 — Tests

- Jest unit config: `src/**/*.spec.ts`, alias mapping, coverage threshold (start at the current
  number, ratchet up)
- one `jest.config.ts` with `unit` and `e2e` projects; e2e `--runInBand`; Jest under
  `node --experimental-vm-modules` (Prisma 7 WASM)
- `test/helpers`: app factory (same bootstrap as `main.ts`), DB reset (truncate all but migrations
  table), auth helper (login + CSRF), Mailpit reader, S3 cleanup
- e2e against the compose Postgres on a separate database (`<name>_test`)

# Step 16 — Scripts and CI gate

`package.json` scripts listed in `CLAUDE.md`. `verify` =
`format:check && lint && typecheck && test:cov && build && test:e2e`.
CI (GitHub Actions): services `postgres:18-alpine` and `axllent/mailpit`, `npm ci`, `db:migrate`,
`npm run verify`. Required status check on `main`.

# Step 17 — Repo files

`.gitignore` (`node_modules`, `dist`, `coverage`, `.env*` except `.env.example`, local storage dir),
`.env.example`, `.nvmrc`, `.github/pull_request_template.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/`.

---

# Validation

- `docker compose up -d && npm run db:migrate && npm run start:dev` → `GET /health/live` 200
- `GET /api/openapi.yaml` returns the spec; `npm run openapi:lint` is clean
- a request with an invalid body returns the 400 `VALIDATION_FAILED` envelope
- an unknown route returns the 404 envelope; a thrown `Error` returns a generic 500 envelope and is
  logged with the request id
- `npm run verify` green locally and in CI
- a deliberate `modules/a` → `modules/b/b.repository` import fails lint

---

# Final Output

## Installed Dependencies

## Created Files

## Configuration Decisions

ORM, id strategy, casing, locales, coverage start value.

## Next Steps

First module (`auth` or `users`) via the `feature` workflow.
