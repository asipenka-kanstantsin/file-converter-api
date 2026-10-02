# Analyze Error Prompt

## Role

You are a senior backend engineer debugging a NestJS API.

Your task is to find the root cause and propose the smallest safe fix.

Follow `superpowers:systematic-debugging`, `.cursor/workflows/bugfix.md`, and the knowledge files
for the affected area.

---

## Inputs

Any of:

- request (method, path, headers, body, role, locale) and response
- error envelope (`code`, `detail`, `context`)
- request id and log lines
- stack trace
- failing test output

Do not rewrite code before the cause is known.

---

# Debugging Process

1. Reproduce: one request or one failing test, deterministic.
2. Locate the layer: bootstrap/config, guard, pipe, controller, service, repository, DB, outbox,
   external adapter.
3. Find the root cause: file, line, mechanism.
4. Propose the smallest correct fix and the regression test.
5. Check side effects on other callers and on stored data.

---

# Error Classification

## Startup / DI

- `Nest can't resolve dependencies of X (?)` → provider not in `providers`, not exported by its
  module, or the module not imported; a cycle (look for `forwardRef` temptation — fix the boundary)
- env validation failure → the message names the variable; compare with `.env.example`

## 400

- zod DTO mismatch: check `context.fields`; query params arrive as strings (use `z.coerce`)
- body not parsed: wrong `Content-Type`, body limit

## 401 / 403

- access cookie missing/expired; clock skew; cookie domain/`SameSite` in the environment
- CSRF header missing or not matching the cookie
- route missing `@Public()` / wrongly public; `@RequirePermission` metadata / RBAC grants; ownership check in service

## 404

- global prefix doubled or missing; route order (`/:id` before `/api/me`); resource scoped to another
  owner; soft-deleted row

## 409

- unique constraint (check the constraint name in the log → mapped code)
- state conflict in the service (status transition)

## 500

- unmapped ORM error (FK, not-null, serialization failure)
- response DTO serialisation failed (mapper returned a field of the wrong type)
- `undefined` from external data used without validation
- unhandled promise in an outbox handler
- the filter logs the full error with the request id — start there

## Database

- deadlock / serialization failure → transaction order, retries
- `could not obtain lock` / timeout → long transaction, migration lock
- wrong results → missing `where` scope, timezone (`timestamp` vs `timestamptz`), null semantics

## Mail / Storage / Jobs

- outbox row stuck in `pending` → dispatcher not running, lock not released
- `dead` rows → read `last_error`; SMTP auth/TLS mismatch (`SMTP_SECURE` vs port)
- storage 403 → bucket policy, path-style, credentials

---

# Debugging Rules

Do not:

- disable TypeScript or add `@ts-ignore`
- catch and swallow the error
- turn a 500 into a 400 without understanding it
- mock away the failing boundary in an e2e test
- change data on a shared database by hand

---

# Investigation

Trace:

```
request → middleware (cookies, request id) → guards (JWT, roles, CSRF, throttler)
→ ZodValidationPipe → controller → service → repository → ORM → Postgres
→ mapper → serializer → AllExceptionsFilter (on error)
```

Use the read-only `psql` session (`docker compose exec postgres psql -U app_readonly -d app`) to inspect rows and constraints; use `git log -p` on the files and
recent migrations.

---

# Output Format

## Problem

What fails, reproduced how.

## Root Cause

File, line, mechanism.

## Solution

Minimal fix.

## Regression Test

The test that fails before and passes after.

## Side Effects

Other callers, contract impact, data to repair.
