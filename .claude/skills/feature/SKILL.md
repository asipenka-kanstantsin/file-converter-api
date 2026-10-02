---
name: feature
description: Implement a new backend feature — endpoint group, module, business flow, background job or capability — in this NestJS modular monolith using a Requirements → Researcher → Executor → Skeptic → QA loop. Use when the user asks to add, build or implement an endpoint, API, module, flow, integration, mail, upload or any new server behaviour.
---

# Workflow: Feature

Goal: implement a new feature inside the modular monolith without breaking module boundaries, the HTTP contract or the database.

Before starting, read `AGENTS.md`, `.cursor/rules/`, and the `.cursor/knowledge/` files for the area: always `01-architecture`, `05-api-design`, `08-errors`; plus `03-nestjs`, `06-validation`, `07-database-*`, `09-auth`, `19-security` as the feature touches them, and `11-mail` / `12-storage` / `13-i18n` / `20-jobs` for side effects.

A new feature also runs the Superpowers chain (`brainstorming → writing-plans → executing-plans → verification-before-completion`). This skill is the frame those steps run inside; project rules win on conflict.

Run Step 0 first, then the four steps in order. If Step 3 returns FAIL, go back to Step 2 with its problem list and repeat until PASS. Step 4 runs only after Step 3 passes.

---

## Step 0 — Requirements

**Do not skip. Do not delegate to a subagent** — the acceptance criteria must land in the driving context, not in a report about it.

Use the `requirements-check` skill to pull the AC from Notion (`docs/requirements/`) before Step 1. An `agreed` row in `docs/decisions.md` can have rewritten the flow; a feature built from a stale page is rework, not delivery.

Return `### Requirements` exactly as `requirements-check` specifies: source page file and version, the clauses that constrain this task, the decision rows and their status, conflicts, gaps.

Do not modify a file before `### Requirements` exists.

---

## Step 1 — Researcher

**Read-only. Never change files.** Prefer the `Explore` subagent so the main thread stays clean.

Search for: the closest existing module and endpoint to copy the shape of; existing services other modules already export; DTOs, error codes, mail templates, storage usage, outbox events, guards and decorators that can be reused; the current schema for the tables involved; the frontend consumer, if one exists, and what it already sends and expects.

Decide, and justify each:

- **Owning module** — one business domain owns the feature. New module only if no existing domain owns it (then use `nest-module`).
- **Endpoints** — method, path, auth (`@Public()` or role), CSRF, success status, per `05-api-design`.
- **DTOs** — request, query and response zod schemas; optional vs nullable; pagination and sort whitelist.
- **Schema change** — tables, columns, indexes, constraints; is the migration safe on a populated table (use `db-migration`).
- **Error codes** — each failure mode → an existing or new `ErrorCode`, its status, its `context`.
- **Cross-module calls** — which exported services; who starts the transaction; events instead of call-backs.
- **Side effects** — mail (always via outbox), storage objects, outbox events, jobs; what happens on retry.
- **Security** — ownership check per resource, role, rate limit, which fields are PII.

Return:

### Existing implementation
### Related files
### Recommended reuse
### Architecture
Owning module, layer of every piece, cross-module calls.
### Contract
Endpoint table: method, path, auth, CSRF, request DTO, response DTO, success status, error codes.
### Schema
Tables/columns/indexes, migration pattern, backfill.
### Side effects
Mail, storage, outbox, jobs — and their retry behaviour.
### Risks
Boundary violations, breaking contract changes, lock-heavy migrations, BOLA.
### Recommendation
Ordered implementation plan (schema → repository → service → controller → tests).

For a large change, present this and wait for confirmation before Step 2.

---

## Step 2 — Executor

Mission: implement the approved plan. Per endpoint follow `api-endpoint`; per schema change follow `db-migration`.

Priority: 1. AGENTS.md  2. `.cursor/knowledge/`  3. Project architecture  4. Existing code

Requirements:

- `Controller → Service → Repository → ORM`; controller calls one service method
- ownership and role checks on the resource in the service
- more than one write → one transaction started in the service
- every response through a response DTO and mapper; errors only as `AppException(ErrorCode.X, …)`
- new error codes and mail keys in every locale catalogue
- mail and external calls through the outbox, never inline in the request
- a migration in the same change as the code that needs it
- tests with the change: unit specs for service rules, e2e specs for every endpoint

Never: import another module's repository or internals, use `forwardRef`, read `process.env`, add an unbounded list, log PII or secrets, change an existing response shape/status/code without listing it as a contract change.

Run, and paste the result: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:e2e` when any endpoint, guard, filter or migration changed (`docker compose up -d` first).

Return:

### Changes
Files created and modified.
### Contract changes
Endpoints, fields, statuses, codes — breaking or not.
### Schema changes
Migration name and what it does.
### Implementation notes
### Verification
Commands and their outcome.

---

## Step 3 — Skeptic

Review as a senior backend reviewer. **Never change files.** Prefer a fresh subagent. Assume there are problems.

Review in this order:

1. **Requirements** — every AC clause implemented; nothing from a `rejected` decision built; every open point decided is in `docs/decisions.md`. A missing clause is critical however clean the code.
2. **Module boundaries and layering** — owning module right; no deep cross-module imports, no cycles; controller thin; no ORM outside repositories; no business logic in `common/` or `infrastructure/`.
3. **Contract** — request/response DTOs present and visible in `openapi/openapi.yaml`; statuses per `05-api-design`; every error code documented with `x-error-codes` in `openapi/openapi.yaml`; envelope respected; casing; optional vs nullable; pagination limits; breaking changes called out.
4. **Database** — migration safe on populated tables, reversible or declared irreversible; transactions around multi-writes; indexes for FKs and every filter/sort column; no N+1 (count queries on list endpoints); unique constraints mapped to codes.
5. **Security** — `@Public()` justified; ownership check on every id from the client (BOLA); role checks; CSRF on unsafe methods; rate limits on auth/OTP/mail-sending; no secrets, tokens, OTPs or full emails in logs, errors or responses; uploads validated by content.
6. **Side effects** — mail/external calls via outbox; idempotent on retry; nothing sent when the transaction rolls back.
7. **i18n** — every new code and mail key in every locale; no hardcoded user-readable text.
8. **Tests** — every behaviour and every error code asserted; e2e hits a real DB; mocks only at external boundaries.
9. **Maintainability** — duplication, needless abstraction, naming, redundant comments.

Return only **### PASS** or **### FAIL**, then: Critical issues · Medium issues · Low priority improvements · Final verdict.

If FAIL: return an exact list of problems and repeat Step 2.

---

## Step 4 — QA acceptance

Only after Step 3 returns PASS. Use the `acceptance-check` skill: exercise the running API over HTTP against the `### Requirements` and report a `### QA report`.

Step 3 read the code; Step 4 runs it. **Do not report the task done before the QA report exists.** On REJECTED, fix each defect with one `bugfix` run per root cause and re-run Step 4.

---

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "The guard checks the role, that's enough" | A role says what kind of user it is, not whether this row is theirs. Ownership is checked in the service. |
| "I'll send the mail right after the insert" | Inline mail fires even when the transaction rolls back, and blocks the request. Outbox. |
| "It's just one more field on the response" | Still a contract change; list it. Removing or renaming one is breaking. |
| "The table is small" | It will not be in production. Write the migration as if it were big. |
| "Unit tests cover it" | Guards, pipes, filters and the DB only meet in e2e. Endpoints need e2e. |
| "I'll add the `nl` message later" | A missing locale key ships as the raw code to the user. Every locale, now. |
| "forwardRef makes it compile" | A cycle means a boundary is wrong. Move the ownership. |

## Red flags — stop

- Editing code before `### Requirements` and the Researcher's contract table exist
- An endpoint with no e2e test, or an error code no test asserts
- `findMany`/`find` without `take`/`limit` on a list path
- A repository or entity imported from `@/modules/<other>/…`
- A migration you have not read as SQL
- `@Public()` added without a sentence explaining why
