# AI First Project Checklist

## Repository Setup

- [ ] AGENTS.md and CLAUDE.md exist (ORM placeholders resolved)
- [ ] .cursor/rules, .cursor/knowledge, .cursor/prompts, .cursor/workflows exist
- [ ] `node scripts/fetch-requirements.mjs` exports the Notion spec; `app_readonly` Postgres role created for read-only `psql`
- [ ] .claude/skills present
- [ ] Cursor project settings configured
- [ ] Branch protection on `main` with the `verify` check

---

## Foundation

- [ ] Strict TypeScript, `@/` alias
- [ ] ESLint (typescript-eslint, perfectionist, layer rules) + Prettier
- [ ] Config module: zod env schema, typed `AppConfig`, `.env.example`
- [ ] Database: ORM client, transaction helper, migrations, seed
- [ ] Error foundation: `ErrorCode`, `AppException`, `AllExceptionsFilter`, locale catalogues
- [ ] Validation: `nestjs-zod` global pipe and serializer
- [ ] Auth guards and decorators (`@Public()`, `@RequirePermission()`, `@CurrentUser()`), CSRF
- [ ] Logging: pino, request id, redaction
- [ ] Hardening: helmet, cookie-parser, CORS allow-list, throttler
- [ ] `openapi/openapi.yaml` (contract-first), `openapi:lint`, contract + inventory tests
- [ ] Mail: `MailService`, SMTP transport, template registry, outbox dispatcher
- [ ] Storage: `StoragePort` with s3 / local drivers
- [ ] Health endpoints
- [ ] docker-compose: Postgres, Mailpit, S3 (SeaweedFS)
- [ ] Tests: Jest unit + e2e on real Postgres, helpers, coverage threshold
- [ ] CI running `npm run verify`

---

# Knowledge

- [ ] 00-project
- [ ] 01-architecture
- [ ] 02-typescript
- [ ] 03-nestjs
- [ ] 05-api-design
- [ ] 06-validation
- [ ] 07-database (one ORM file kept)
- [ ] 08-errors
- [ ] 09-auth
- [ ] 10-config
- [ ] 11-mail
- [ ] 12-storage
- [ ] 13-i18n
- [ ] 14-logging
- [ ] 15-review
- [ ] 16-git
- [ ] 17-agent-workflow
- [ ] 18-testing
- [ ] 19-security
- [ ] 20-jobs
- [ ] 21-naming
- [ ] 22-imports

---

# Prompts

## Generate

- [ ] module
- [ ] endpoint
- [ ] entity
- [ ] DTO
- [ ] mail template

## Review

- [ ] code review
- [ ] security review
- [ ] doc conformance

## Debug

- [ ] analyze error
- [ ] slow query

## Setup

- [ ] project init
- [ ] environment
- [ ] git workflow
- [ ] dependencies

---

# MCP

- [ ] none (Notion via `scripts/fetch-requirements.mjs`)
- [ ] `app_readonly` role for read-only `psql` (dev only)

---

# Agent Workflow

1. Pull the AC.
2. Read knowledge.
3. Inspect existing code and schema.
4. Plan: endpoints, DTOs, codes, schema.
5. Implement.
6. Verify (`npm run verify`, Skeptic).
7. Accept (`acceptance-check`).
8. Summarize with contract and schema changes.

---

# Before Coding

- Does this already exist?
- Which module owns it?
- Does the contract change? Breaking?
- Does the schema change? Safe on existing data?
- Which side effects, and are they in the outbox?
- Which error codes, in every locale?
- Is a dependency necessary?

---

# Before Finishing

- TypeScript and lint
- module boundaries
- OpenAPI output
- migrations applied on fresh and populated DB
- auth and ownership checks
- no PII in logs
- tests for every new behaviour and error code
- changed files are the expected ones

---

# Remaining Bootstrap Tasks

- [ ] Choose the ORM; delete the other `07-database-*` file and placeholders
- [ ] Confirm field casing (camelCase default) with the frontend
- [ ] Confirm id strategy (UUID v7 default) and supported locales
- [ ] First module (`auth` / `users`) via the `feature` workflow
