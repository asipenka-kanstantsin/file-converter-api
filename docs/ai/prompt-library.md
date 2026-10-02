# Prompt Library

## Generate

Location: `.cursor/prompts/generate/`

| Prompt | Creates |
|---|---|
| `create-module` | a business module: module, controller, service, repository, mapper, DTOs, `index.ts`, specs |
| `create-endpoint` | one endpoint: contract first, then DTOs, service, controller, e2e for each code |
| `create-entity` | a table / entity with conventions, indexes, named constraints, generated migration |
| `create-dto` | zod request, list-query and response DTOs that render into OpenAPI |
| `create-mail-template` | a typed, localised template, enqueued via the outbox, verified in Mailpit |

---

## Review

Location: `.cursor/prompts/review/`

| Prompt | Checks |
|---|---|
| `code-review` | architecture, contract, DB, security, side effects, errors, tests, performance |
| `security-review` | authn/authz (IDOR), CSRF, input, credentials, enumeration, rate limits, data exposure, files |
| `doc-conformance` | read-only: spec vs code vs `openapi/openapi.yaml` vs observed behaviour; conformance matrix |

`doc-conformance` requires a specification.

---

## Debug

Location: `.cursor/prompts/debug/`

| Prompt | For |
|---|---|
| `analyze-error` | DI/startup failures, 4xx/5xx by class, DB errors, stuck outbox, storage errors |
| `slow-query` | query counting (N+1), `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)`, index design |

---

## Setup

Location: `.cursor/prompts/setup/`

| Prompt | For |
|---|---|
| `project-init` | bootstrap: Nest app, strict TS, lint/boundaries, zod, config, ORM, compose, pino, hardening, OpenAPI contract, errors, health, tests, CI |
| `environment` | `docker-compose.yml`, `.env.example`, variable table, env validation |
| `git-workflow` | branch protection, `.gitignore`, branches, commits, migrations in Git |
| `add-dependency` | evaluating and adding an npm package |
