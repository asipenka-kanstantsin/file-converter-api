# Workflow: Documentation Conformance Audit

Goal: verify that the implementation matches the provided specification. Read-only — never modify
files.

Before starting, read `AGENTS.md`, `.cursor/rules/`, `05-api-design.mdc`, `08-errors.mdc`,
`09-auth.mdc`, and `.cursor/prompts/review/doc-conformance.md`.

The user must provide the specification (a Notion page, an API spec document, an OpenAPI file
the frontend agreed on). If not provided, ask before proceeding.

Source of truth priority:

1. Specification provided by the user (and the Notion AC it belongs to)
2. The OpenAPI contract at `openapi/openapi.yaml` — as evidence of what the server **claims**
3. The running server — as evidence of what the server **does**
4. `.cursor/knowledge/` for project conventions

A mismatch between 2 and 3 is itself a defect: the contract lies.

---

## Step 1 — Researcher

Mission: map every documented requirement to code and to observed behaviour. Never change files.

Search for:

- controllers and routes for each documented path
- request and response DTOs and their zod limits
- `ErrorCode` entries and where each is thrown
- guards, `@Public()`, CSRF, throttler settings
- migrations for documented fields, constraints and defaults
- side effects the spec names: mail templates, stored files, outbox events
- endpoints present in code but absent from the spec

Diff the spec against `openapi/openapi.yaml` at the level of operations **and** parameters, not only
schema leaves. Where needed, call the running dev API to confirm (read-only requests, or writes on
test accounts only).

Build a conformance matrix covering:

- global conventions (prefix, casing, envelope, pagination, date format, auth transport)
- shared DTOs and enums
- field validation rules
- each endpoint (method, path, auth, CSRF, status, request, response, errors)
- documented flows (multi-step sequences, state transitions)
- side effects
- items the spec marks as deferred (`N/A`, not failures)

Return:

### Specification summary

Scope, version/date, key constraints.

### Conformance matrix

| Requirement | Spec reference | Code location | Observed | Status |
| --- | --- | --- | --- | --- |
| ... | ... | ... | ... | PASS / FAIL / MISSING / N/A |

### Gaps found

### Out of scope

### Recommendation

If the matrix is complete, continue to Step 2.

---

## Step 2 — Skeptic

Mission: independently verify the conformance matrix. Never change files.

Re-check every `FAIL` and `MISSING`. Spot-check `PASS` items — do not trust the matrix blindly.
Check the spec's last-edit date before calling a difference a defect.

Verify in this order:

1. Global conventions
2. Shared DTOs and enums
3. Validation rules (zod limits vs spec)
4. Endpoints (one by one)
5. Error envelope and codes (every documented code reachable, none undocumented)
6. Documented flows
7. Security constraints (auth, ownership, CSRF, rate limits, enumeration, PII)
8. Side effects (mail sent via outbox, correct locale, files private)

Look for:

- wrong method, path or success status
- field casing or type different from the spec
- a code the spec lists that is never thrown, or thrown with another status
- OpenAPI claiming something the server does not do
- validation weaker or stricter than the spec
- missing rate limit or CSRF where the spec requires it

Return only:

### PASS

or

### FAIL

Then provide:

- Critical gaps (spec violation, security risk, broken flow)
- Medium gaps (partial implementation, wrong status or code)
- Low priority notes
- Not implemented (documented but intentionally absent — informational)
- Final verdict

If FAIL: list the exact requirements that fail and the code locations to fix. Do not implement
fixes — report only.
