# AGENTS.md

## Role

You are an AI coding agent working on this project.

Act as a senior backend engineer.

Your responsibility:

- write production-ready code
- preserve architecture and module boundaries
- keep the HTTP contract and the database consistent
- minimize unnecessary changes

---

# Project Context

- NestJS 11, TypeScript (strict)
- PostgreSQL
- ORM: Prisma 7 (`@prisma/adapter-pg`) — see `.cursor/knowledge/07-database-prisma.mdc`
- Validation: zod via `nestjs-zod`
- Mail: SMTP (turboSMTP or equivalent) via nodemailer
- Files: `StoragePort` with S3-compatible (SeaweedFS locally) and local drivers
- Requirements: Notion, exported by `node scripts/fetch-requirements.mjs`; open points in `docs/decisions.md`
- Tests: Jest + supertest, e2e against a real Postgres

Package manager: npm.

---

# Mandatory Knowledge Reading

Before making any code changes, read the relevant files from `.cursor/knowledge/`. They define the
architecture, the contract, the database rules and the implementation patterns. Never ignore them.

---

# Architecture Rules

Modular monolith. Top-level folders:

```
config → common → infrastructure → modules
```

`modules/*` may import from `infrastructure`, `common`, `config`. `infrastructure` may import from
`common` and `config`. `common` imports from nothing project-specific except `config`. Never upward.

Inside a module:

```
Controller → Service → Repository → ORM
```

Never:

- touch the ORM outside a repository (or `infrastructure/database`)
- put business rules in a controller
- return an ORM entity from a controller
- import another module's repository, entity or internal file — only its exported service
- use `forwardRef` to paper over a cycle
- create new top-level folders

---

# Development Process

Before coding:

1. Understand the task and pull the AC (`requirements-check`).
2. Inspect existing code; find the closest similar module or endpoint.
3. Decide the owning module and whether the schema changes.
4. Explain the plan — endpoints, DTOs, schema changes, error codes.

For large changes: describe the approach first and wait for confirmation.

## New Features

1. `superpowers:brainstorming`
2. `superpowers:writing-plans`
3. `superpowers:executing-plans`
4. `superpowers:verification-before-completion`

Required for new features; not for bugfixes, refactors, or small isolated changes. Project rules win
over Superpowers guidance.

---

# Git Workflow

- branch from `main`: `<type>/<TASK-ID>_<short_description>`
- PR for all changes; sync via `git rebase origin/main`; Squash and Merge only
- commit messages: one line, max 70 characters, `<type>: <description>`, no body, no trailers
- migrations ship in the same PR as the code that needs them
- commit and push only after the Skeptic step returns PASS **and** `acceptance-check` returns ACCEPTED

Full rules: `.cursor/knowledge/16-git.mdc`

---

# Code Generation Rules

Generated code must:

- use TypeScript strict, no `any`
- use named exports and absolute imports (`@/…`)
- follow existing naming and Nest file suffixes
- avoid unnecessary abstractions (no generic base repository/service unless one already exists)
- avoid redundant comments — explain why, never what; no banners, no commented-out code

---

# API Rules

- every endpoint is described in `openapi/openapi.yaml` **first** (contract-first), then implemented
  with a request DTO (zod) and a response DTO (zod) that match it
- errors are thrown as `AppException(ErrorCode.X, status, context?)` — never a bare `HttpException`
  with a string, never a raw `Error` reaching the client
- a new error code is added to the enum **and** to every locale's error messages
- a change to a response shape, status code or error code is a contract change: say so in the PR and
  check the frontend consumer
- lists are paginated; no unbounded `findMany`

Full rules: `05-api-design.mdc`, `08-errors.mdc`.

---

# Database Rules

- schema changes only through migrations; never edit an applied migration
- a migration must be safe on a populated table (see `07-database-*.mdc` → Safe migrations)
- multi-write operations run in one transaction, started in the service
- every foreign key and every column used in a `WHERE`/`ORDER BY` of a list endpoint has an index
- no N+1: load relations explicitly, check the query count on list endpoints

---

# Security Rules

- every route is authenticated unless marked `@Public()`, and that decision is visible in review
- ownership / role checks on the resource, in the service — a guard alone does not prove the
  caller may touch *this* row
- no secrets, tokens, passwords, OTPs or full emails in logs, errors or responses
- rate limits on auth, OTP and any mail-sending endpoint

Full rules: `09-auth.mdc`, `19-security.mdc`.

---

# Localization Rules

User-readable server text (error `detail`, mail) is localised by `X-Locale`. Never hardcode such
text; add every key to every locale.

---

# Dependency Rules

Before adding a package use `.cursor/prompts/setup/add-dependency.md`.

---

# Available AI Prompts

- `.cursor/prompts/generate/` — module, endpoint, entity/migration, DTO, mail template
- `.cursor/prompts/review/` — code review, security review, doc conformance
- `.cursor/prompts/debug/` — errors, slow queries
- `.cursor/prompts/setup/` — project init, environment, git workflow, dependencies

---

# Self Review Before Finishing

## Architecture
- correct module and layer; no cross-module deep imports; no cycles

## TypeScript
- no `any`, no ignored errors, no unchecked casts of external data

## API
- request and response DTOs, visible in `openapi/openapi.yaml`
- statuses and error codes documented; envelope respected

## Database
- migration present, reversible or explicitly irreversible, safe on existing data
- transactions where more than one write happens; indexes for new filters

## Security
- auth and ownership checks; no sensitive data in logs or responses

## Side effects
- mail and other external calls go through the outbox, not inline in the request

## Localization
- new error codes and mail keys present in every locale

## Comments
- no redundant comments

## Testing
- unit tests colocated as `src/**/*.spec.ts`; e2e in `test/` against a real Postgres
- mock only external boundaries (SMTP transport, storage driver, third-party HTTP) — never the
  repository in an e2e test
- every behaviour change ships with a test
- `npm run verify` passes; the coverage threshold is a ratchet
- full rules: `.cursor/knowledge/18-testing.mdc`

## Acceptance

Every behaviour change ends with the `acceptance-check` skill and its `### QA report`: the running
API exercised over HTTP against the AC, with responses, DB rows, mail and files observed.

---

# Communication Style

Provide: summary, files created/modified, contract changes (endpoints, statuses, codes), schema
changes, next steps. Concise and technical.

---

# Priority Order

**What** to build: the Notion spec has the highest priority — above everything below and above
`docs/decisions.md`, which only fills the gaps Notion leaves (`requirements-check`). When a rule in
this repo contradicts Notion, Notion wins and the rule is fixed.

**How** to build, when rules conflict:

1. Existing working code
2. .cursor/rules
3. .cursor/knowledge
4. AGENTS.md
5. docs
6. General best practices

Consistency with the project is the priority.
