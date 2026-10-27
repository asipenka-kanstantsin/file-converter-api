# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start:dev     # start the API in watch mode (http://localhost:3001)
npm run build         # production build (nest build)
npm run start:prod    # run the production build
npm run requirements:fetch  # export the Notion spec into docs/requirements/ (git-ignored)
npm run lint          # ESLint
npm run lint:fix      # ESLint with autofix
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run typecheck     # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run test          # Jest unit tests, single run
npm run test:watch    # Jest, watch mode
npm run test:cov      # Jest with the enforced coverage threshold
npm run test:e2e      # e2e suite; starts its own Postgres and SMTP sink, no docker needed
npm run test:e2e:s3   # S3 adapter suite only — needs `docker compose up -d`
npm run db:migrate    # apply pending migrations
npm run db:generate   # generate a migration from the schema diff
npm run openapi:lint  # Redocly lint of openapi/openapi.yaml
npm run verify        # the whole PR gate, locally
docker compose up -d  # dev only: Postgres 18, Mailpit (UI :8025), SeaweedFS (S3 API :8333)
```

Unit tests are colocated as `src/**/*.spec.ts`; e2e tests live in `test/**/*.e2e-spec.ts` and run against a real database — the one `.env.test` points at when it answers, otherwise an embedded PostgreSQL 18 the run starts itself, so no suite in `verify` needs docker. `npm run verify` runs the full pull-request gate. Rules: `.cursor/knowledge/18-testing.mdc`.

## Requirements

What to build comes from the Notion training spec, exported with `npm run requirements:fetch` into the git-ignored `docs/requirements/` (confidential — never commit or paste it anywhere). Open points of the spec and mentor agreements are in `docs/decisions.md`; task ids `FC-0…FC-13` map to the Notion pages there. Always start with the `requirements-check` skill.

## Authoritative rule sources — read before coding

- `AGENTS.md` — top-level agent contract (dev process, layering, API/DB/security rules, self-review checklist, **priority order when rules conflict**).
- `.cursor/rules/*.mdc` — always-apply core / architecture / code-quality / security / database rules.
- `.cursor/knowledge/*.mdc` — deep per-topic knowledge. Read the topic file before working in that area:
  `01-architecture` · `03-nestjs` · `04-transformations` · `05-api-design` · `06-validation` · `07-database-*` · `08-errors` · `09-auth` · `10-config` · `11-mail` · `12-storage` · `13-i18n` · `14-logging` · `18-testing` · `19-security` · `20-jobs`.

**Notion has the highest priority**: when any rule, decision, contract or code disagrees with the Notion spec, Notion wins. Among the repo's own rules the order (from `AGENTS.md`) is: existing working code → `.cursor/rules` → `.cursor/knowledge` → `AGENTS.md` → docs → general best practices.

## New features — start with Superpowers

Every **new feature** (endpoint group, module, flow, capability) runs through:

`superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:executing-plans` → `superpowers:verification-before-completion`

Not required for bugfixes, refactors, or small isolated changes. Project rules override Superpowers guidance on conflict.

## Every change ends with a QA pass

Any change that alters behaviour finishes with the `acceptance-check` skill: the running API is exercised over HTTP against the Notion requirements — responses, database state, sent mail, stored files — and reported as a `### QA report`. Do not report a task done without it. Read-only: it reports defects, it does not fix them.

## Architecture

NestJS 11 + TypeScript (strict) + PostgreSQL 18 + Prisma 7 + zod 4 (`nestjs-zod`), a **modular monolith**. The product: a file-conversion API (CSV/JSON/XML/YAML, PNG/JPEG/SVG) with users, e-mail confirmation and DB-driven RBAC.

```
src/
  main.ts               bootstrap: global prefix /api, pipes, filters, cookies, CORS (no Swagger)
  app.module.ts
  config/               zod-validated env → typed AppConfig. The only reader of process.env
  common/               cross-cutting, no business logic: errors, filters, guards, decorators,
                        interceptors, pagination, i18n, utils
  infrastructure/       adapters to the outside world: database, mail, storage, outbox/jobs
  modules/<domain>/     one folder per business domain
prisma/ or src/infrastructure/database/migrations/
test/                   e2e specs and helpers
```

Inside a module the call chain is fixed:

```
Controller → Service → Repository → ORM
```

- **Controller** — HTTP only: route, guards, parse a DTO, call one service method, map to a response DTO. No business rules, no ORM.
- **Service** — business rules, permission checks on the resource, transactions, emitting outbox events.
- **Repository** — the only class that touches the ORM client. Returns domain types, never raw ORM rows with relations leaking.
- Modules talk to each other only through a service the other module **exports**. Never import another module's repository or entity. No `forwardRef` — a cycle means a boundary is wrong.

### HTTP contract

- Global prefix `/api` on every route except `/health*`; below it the Notion paths (`/api/auth/*`, `/api/users/*`, `/api/admin/*`, `/api/convert`, `/api/images/convert`, `/api/transformations/*`). JSON only (file endpoints: multipart in, file stream out). Field casing: **camelCase**.
- Every response is a response DTO; entities never go out directly.
- Errors always use one envelope: `{ "code": "USER_NOT_FOUND", "detail": "<localised message>", "context": { … } }`. Clients branch on `code`, show `detail`. Codes live in one enum, `common/errors/error-code.ts`. Full rules: `08-errors.mdc`.
- Lists: cursor pagination `?cursor=&limit=` → `{ items, nextCursor }`, `limit` ≤ 100.
- **Contract-first OpenAPI**: `openapi/openapi.yaml` (OpenAPI 3.1) is written by hand **before** the code and is the contract the frontend reads; it is served at `/api/openapi.yaml`. e2e contract tests validate every response against it and a route-inventory test keeps routes and spec in sync. No `@nestjs/swagger`. An undocumented field or status is a defect.

### Configuration

Never read `process.env` outside `src/config`. Inject the typed config. Env is validated with zod at startup and the process exits on invalid config.

### Auth

Cookie-based: access JWT (15 min) + refresh JWT (30 days, rotated on every refresh, **never stored server-side**), both HttpOnly `SameSite=Lax` cookies; CSRF double-submit (`csrf_token` cookie + `X-CSRF-Token` header) on every unsafe method. `JwtAuthGuard` and `PermissionGuard` are global; opt out with `@Public()`, declare access with `@RequirePermission(permission, action)`. Roles, permissions and grants live in the DB (RBAC). Self/ownership checks live in the service. Full rules: `09-auth.mdc`.

### Mail, files, locale

- Mail goes through `MailService` (`infrastructure/mail`) — nodemailer SMTP transport (turboSMTP or any SMTP host from env), localised templates, sent **via the outbox**, never inline in a request. Dev SMTP is Mailpit.
- Files go through the `StoragePort` (`infrastructure/storage`), driver chosen by `STORAGE_DRIVER=s3|local`. Private, downloads streamed through the API after the permission check, keys generated server-side, type checked by content. Conversions: `04-transformations.mdc`.
- The client sends `X-Locale`; it selects the language of error `detail` and of mail. Locales: `en` only.

## Conventions (enforced by rules / ESLint)

- TypeScript strict, no `any`, no non-null `!` on external data. Named exports only.
- Files kebab-case with Nest suffixes: `user.service.ts`, `create-user.dto.ts`, `user.repository.ts`.
- Validation only through zod DTOs + the global `ZodValidationPipe`. No `class-validator`.
- Money as integer minor units, timestamps as `timestamptz` in UTC, ids as UUID v7.
- Alphabetical sorting of object keys and interface members (`eslint-plugin-perfectionist`).
- **No redundant comments**: comment only non-obvious decisions (why, not what). No section banners, no commented-out code.
- Secrets, tokens, passwords, OTP codes and full emails never reach logs.

## Git workflow

- One task = one branch off `main`: `<type>/<TASK-ID>_<short_description>` (types: feat, fix, hotfix, refactor, chore, docs, test).
- Commit messages: **single line, max 70 chars**, `<type>: <description>`. No body, no trailers.
- Sync via `git rebase origin/main`; merge PRs with **Squash and Merge** only.
- A migration ships in the same PR as the code that needs it.
- Never run `git reset --hard`, `git clean`, force push, or history rewrites without explicit instruction. Full rules in `.cursor/knowledge/16-git.mdc`.
