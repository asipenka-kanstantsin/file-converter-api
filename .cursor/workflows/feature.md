# Workflow: Feature

Goal: implement a new backend feature following the project architecture.

Before starting, read `AGENTS.md`, `.cursor/rules/`, and relevant `.cursor/knowledge/` files
(`01-architecture`, `05-api-design`, `08-errors`, `07-database-*`, plus the topic files the feature
touches). Run the Superpowers chain first (`brainstorming → writing-plans`) and pull the AC with
`requirements-check`.

---

## Step 1 — Researcher

Mission: analyze the codebase and the AC before implementation. Never change files.

Search for:

- the closest similar module, endpoint, DTO, mapper and e2e spec
- services other modules already export that cover part of the need
- existing error codes, pagination, guards, decorators
- current schema, constraints and indexes for the tables involved
- current OpenAPI for affected paths (`openapi/openapi.yaml`)
- side effects the AC implies: mail, files, notifications, jobs

Determine:

- which module owns the feature (existing or new)
- the endpoints: method, path, auth (`@Public()`?), CSRF, success status, error codes
- request and response DTOs
- schema changes and whether they need expand → migrate → contract
- transactions and outbox events
- which AC items are not deliverable and why

Return:

### AC summary

Numbered AC items with the observable behaviour each one requires.

### Existing implementation

### Related files

### Recommended reuse

### Architecture

Owning module, layers, cross-module calls.

### Contract

| Method | Path | Auth | Success | Error codes |
| --- | --- | --- | --- | --- |

### Schema

Tables, columns, constraints, indexes, migration plan.

### Side effects

Outbox events, mail templates, storage keys.

### File structure

New or modified files.

### Risks

Contract breaks, migration risk on populated tables, security, AC conflicts.

### Recommendation

Implementation plan in order: schema → repository → service → controller → tests.

If enough information is collected, continue to Step 2.

---

## Step 2 — Executor

Mission: implement the requested task according to the approved plan.

Priority:

1. Existing code
2. .cursor/rules
3. .cursor/knowledge
4. AGENTS.md

Requirements:

- follow the architecture from Step 1
- `Controller → Service → Repository → ORM`; cross-module only through exported services
- zod request and response DTOs; mapper to response DTO; entities never returned
- `AppException(ErrorCode.X, status, context?)`; new codes in the enum and every locale
- `x-error-codes` in `openapi/openapi.yaml` and response DTOs on each endpoint
- generated migration, safe on populated tables; indexes for FKs and list filters/sorts
- one transaction per multi-write operation, started in the service
- mail and external calls via the outbox in the same transaction
- auth by default; ownership checks in the service; rate limits on auth/OTP/mail endpoints
- unit specs for rules; e2e specs for every status and `code` the AC names

Never:

- redesign unrelated code
- refactor without request
- introduce new architecture or top-level folders
- change an existing contract silently
- edit an applied migration

Run `npm run verify`.

Return:

### Changes

Files created and modified.

### Contract changes

### Schema changes

### Implementation notes

Important decisions.

### Verification

Commands run and results.

---

## Step 3 — Skeptic

Mission: review the implementation as a senior reviewer. Never change files.

Assume there are problems. Use `.cursor/knowledge/15-review.mdc`.

Review in this order:

1. AC coverage — every numbered item has code and a test
2. Architecture and module boundaries
3. Contract — DTOs, statuses, codes, OpenAPI output
4. Database — migration safety, transactions, indexes, N+1
5. Security — auth, ownership, CSRF, rate limits, PII in logs
6. Side effects — outbox, idempotency
7. Errors and localization
8. Tests — error paths, real DB in e2e, no mocked repositories
9. Maintainability

Look for:

- IDOR (an id from the request used without an ownership check)
- a field that leaks because the mapper spreads the entity
- a unique rule enforced only in code
- duplicated code, hidden coupling, overengineering

Return only:

### PASS

or

### FAIL

Then provide:

- Critical issues
- Medium issues
- Low priority improvements
- Final verdict

If FAIL: return an exact list of problems for Step 2.

If PASS: run `acceptance-check`. Commit and push only after it returns ACCEPTED.
