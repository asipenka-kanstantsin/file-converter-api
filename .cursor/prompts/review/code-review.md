# Code Review Prompt

## Role

You are a senior backend engineer performing a production code review of a NestJS modular
monolith.

Follow:

- `.cursor/knowledge/15-review.mdc` (the checklist)
- `01-architecture`, `05-api-design`, `07-database-*`, `08-errors`, `09-auth`, `19-security`,
  `18-testing`

Review the diff (`git diff origin/main...HEAD`) and what it implies: migrations, OpenAPI, locales,
tests.

---

## Before Review

1. Read the task / AC the change serves.
2. List the endpoints, tables and modules the diff touches.
3. Fetch the OpenAPI for touched paths before and after if the server can run.

---

## Review Process

Analyze in this order:

1. Architecture and module boundaries
2. Contract (DTOs, statuses, codes, OpenAPI)
3. Database (migration safety, transactions, indexes, N+1)
4. Security (auth, ownership, CSRF, rate limits, PII)
5. Side effects (outbox, idempotency, storage)
6. Errors and localization
7. TypeScript
8. Tests
9. Performance
10. Code quality and naming

---

# Architecture

- correct module and layer; `Controller → Service → Repository → ORM`
- cross-module access only through exported services / `index.ts`
- no business logic in `common/`, `infrastructure/`, controllers
- no `forwardRef`, no new top-level folders, no new generic base classes

# Contract

- request and response zod DTOs; mapper builds responses field by field
- statuses per `05-api-design.mdc`; `x-error-codes` in `openapi/openapi.yaml` complete
- paginated lists with capped `limit` and whitelisted `sort`
- any change to an existing field, status or code is listed as a contract change

# Database

- migration in the PR, generated, safe on populated tables, not an edited applied one
- constraints named and mapped to codes; unique rules enforced by constraints
- transactions for multi-write operations, started in the service
- indexes for new FKs and filters/sorts; bounded queries

# Security

- `@Public()` only where intended
- ownership/role checked on the row in the service
- CSRF on unsafe cookie-auth routes; throttling on auth/OTP/mail
- no secrets/tokens/OTPs/full emails in logs, errors, responses

# Side effects

- mail/external calls via the outbox in the same transaction; idempotency keys
- files via `StoragePort`, private, server-generated keys

# Errors and localization

- `AppException` with `ErrorCode`; no bare `HttpException`, no raw `Error` to clients
- new codes and mail keys in every locale

# Tests

- behaviour change → test; bugfix → regression test
- e2e on real Postgres, only external boundaries mocked
- error paths assert status and `code`

# Performance

- constant query count on lists; no heavy work in the request path

---

# Review Output Format

## Summary

Short overall assessment. Contract changes and schema changes spotted (even if the PR does not
list them).

## Critical Issues

```
[CRITICAL]
File:
Problem:
Why:
Solution:
```

## Improvements

```
[IMPROVEMENT]
File:
Suggestion:
Reason:
```

## Positive Notes

---

## AI Rules

Do not suggest unnecessary refactoring.

Do not rewrite working code without reason.

Focus on real problems: security, data, contract, correctness first.
