# Workflow: API Endpoint

Goal: add or change one HTTP endpoint so that its behaviour, its OpenAPI entry and its tests agree.

Before starting, read `AGENTS.md`, `.cursor/rules/`, `05-api-design.mdc`, `06-validation.mdc`,
`08-errors.mdc`, `09-auth.mdc` and `.cursor/prompts/generate/create-endpoint.md`. Pull the AC with
`requirements-check`.

---

## Step 1 — Researcher

Mission: pin the contract before code. Never change files.

Search for:

- the owning module and its controller, service, repository, mapper
- an existing endpoint of the same shape (list, create, action) to copy
- reusable DTO fragments, pagination, error codes
- the frontend's expectation if it already calls this path (ticket, OpenAPI diff)
- the schema for the tables read or written

Determine:

- method, path, success status (`05-api-design.mdc` table)
- auth: roles, `@Public()`, CSRF, rate limit
- request DTO: every field, type, limits from the AC
- response DTO: every field, optional vs nullable
- every error: status + `code` + `context`
- ownership rule on the resource
- transaction and outbox needs
- breaking or non-breaking if the endpoint exists

Return:

### Contract

```
POST /api/<path>
Auth:     <roles> | public ; CSRF: yes/no ; rate limit: <n>/<window>
Request:  <DTO fields>
201:      <response DTO fields>
Errors:   404 X_NOT_FOUND, 409 X_CONFLICT {context}, 400 VALIDATION_FAILED
```

### Existing implementation

### Related files

### Schema impact

None, or hand off to `db-migration.md` first.

### Risks

### Recommendation

If the contract is complete, continue to Step 2.

---

## Step 2 — Executor

Mission: implement the endpoint exactly as the contract says.

Order:

1. DTOs (`create-dto.md`) — request and response zod schemas
2. error codes — enum + every locale catalogue
3. repository method — returns domain types, bounded, indexed
4. service method — rules, ownership, transaction, outbox
5. mapper — entity → response DTO, explicit fields
6. controller — route, guards, `x-error-codes` in `openapi/openapi.yaml`, one service call
7. tests — service spec for rules; e2e for success and each error `code`

Requirements:

- no ORM in controller or service
- no entity in the response
- every status the endpoint returns appears in OpenAPI
- a changed existing endpoint lists its contract change

Run `npm run verify` and fetch `openapi/openapi.yaml` to confirm the entry.

Return:

### Changes

### Contract changes

### Schema changes

### Verification

Commands run; the OpenAPI entry excerpt.

---

## Step 3 — Skeptic

Mission: verify the endpoint against its contract. Never change files.

Verify:

- OpenAPI entry matches the Step 1 contract field by field, status by status, code by code
- e2e covers success and every listed error `code`, asserting the envelope
- 401 without auth, 403/404 for another user's resource, CSRF enforced on unsafe methods
- validation limits match the AC
- list: `limit` capped, `sort` whitelisted, query count constant
- no PII in logs; no internals in error bodies

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

If PASS: run `acceptance-check`.
