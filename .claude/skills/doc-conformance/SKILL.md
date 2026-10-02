---
name: doc-conformance
description: Read-only audit verifying that controllers, DTOs, guards, error codes and the OpenAPI contract document match a supplied specification — an OpenAPI file, an API design document, or the frontend's expectations — using a Requirements → Researcher → Skeptic loop. Use when the user asks to check, audit, compare or verify the API against a spec, contract, doc or client. Never modifies files.
---

# Workflow: Documentation Conformance Audit

Goal: verify that the implementation matches the provided specification. **Read-only — never modify files.** Scratch artefacts (diffs, request transcripts) go to the scratchpad.

Before starting, read `AGENTS.md`, `.cursor/rules/`, `01-architecture`, `05-api-design`, `08-errors`, `09-auth`, and `.cursor/prompts/review/doc-conformance.md` if present.

The user must provide the specification (path, URL, or the frontend repo/folder whose expectations are the spec). If not provided, ask. It may be passed as the skill argument.

Source of truth priority:

1. The specification supplied by the user, for the scope of this audit
2. `agreed` rows in `docs/decisions.md`
3. Acceptance criteria in Notion (`docs/requirements/`)
4. The OpenAPI contract (`openapi/openapi.yaml`) — compared, not trusted
5. `.cursor/knowledge/` for project conventions (envelope, pagination, casing)

Three artefacts are compared, not two: **the spec**, **the code** (controllers, DTOs, guards, services), and **the OpenAPI contract**. Code and OpenAPI disagreeing with each other is a finding even where both match the spec loosely.

## Step 0 — Requirements

Use `requirements-check` to pull the Notion pages for the area and the `docs/decisions.md` rows touching it. A spec is not automatically the requirement: where it and the Notion page disagree, report both sides with page file and version. When the spec is the frontend's expectations, AC-vs-frontend disagreements are findings in their own right.

Return `### Requirements`. If Notion is unreachable, say so and audit against the spec alone.

---

## Step 1 — Researcher

Map every documented requirement to the code. **Never change files.** Prefer `Explore` for the search.

Collect:

- the contract `openapi/openapi.yaml` and the result of `npm run openapi:lint` and the contract tests
- every controller and route (`@Controller`, `@Get/@Post/…`), global prefix, `@Public()`, `@RequirePermission()`, guards
- request/query/response zod DTOs, their limits and optional/nullable flags
- `x-error-codes` in `openapi/openapi.yaml` per endpoint vs the `AppException` codes the service path can actually throw
- the error envelope, the `AllExceptionsFilter` mappings (unique/FK/not-found → codes)
- pagination DTOs and sort whitelists
- cookie, CSRF and CORS setup in `main.ts` / auth module
- endpoints present in code but absent from the spec, and vice versa

Build one matrix row per endpoint:

| Method | Path | Auth / role | CSRF | Request DTO | Response DTO | Success status | Error statuses + codes | Pagination | Spec ref | Code location | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Status values: `PASS`, `FAIL`, `MISSING` (in spec, not in code), `EXTRA` (in code, not in spec), `UNDOCUMENTED` (in code, not in OpenAPI contract), `N/A` / `NOT IMPLEMENTED` (spec marks it deferred), `AC-ONLY` (in AC, absent from the spec).

Also cover global conventions (prefix, casing, date/money format, envelope, pagination shape, `X-Locale` handling) and shared enums.

Return:

### Specification summary
Scope, version, key constraints.
### Conformance matrix
### Field-level diffs
Per DTO: name, type, required/optional/nullable, limits — spec vs code vs OpenAPI.
### Gaps found
### Out of scope
### Recommendation

---

## Step 2 — Skeptic

Independently verify the matrix. **Never change files.** Prefer a fresh subagent.

Re-check every `FAIL`, `MISSING`, `EXTRA` and `UNDOCUMENTED`. Spot-check `PASS` rows — at least one per controller — by reading the code path end to end.

Verify in this order:

1. Global conventions — prefix, casing, envelope, dates, money, enum casing
2. Shared DTOs and enums
3. Validation — zod limits vs spec limits (stricter and looser both fail)
4. Endpoints one by one — method, path, success status per `05-api-design`
5. Auth — `@Public()` exactly where the spec says; permissions match the Notion pages and the RBAC seed; Self/ownership enforced in the service
6. CSRF on every cookie-authenticated unsafe method
7. Error codes — each code the service can throw is documented; each documented code is reachable; statuses match `08-errors`
8. Pagination — `limit` default/max, response shape, sort whitelist
9. Response DTOs — no entity returned directly; no extra fields beyond the DTO; secrets and internal ids never exposed
10. Documented flows — multi-step sequences (sign-up → OTP → login → refresh) work across endpoints

Look for:

- a route missing from OpenAPI, or an OpenAPI response the code cannot produce
- `x-error-codes` in `openapi/openapi.yaml` missing a code the service throws
- a bare `HttpException`/`NotFoundException` bypassing the envelope
- `@Public()` on a route the spec protects, or a protected route the spec marks public
- response DTO wider than the spec (leaks) or narrower (missing fields)
- optional vs nullable swapped
- unbounded list, missing pagination, raw client-supplied sort column
- token or secret in a response body instead of an HttpOnly cookie
- casing or date format drift in one DTO

Return only **### PASS** or **### FAIL**, then:

- Critical gaps (spec violation, security risk, broken flow)
- Medium gaps (partial implementation, wrong status or code, undocumented behaviour)
- Low priority notes (naming, description text)
- Not implemented (documented but intentionally absent — informational)
- Final verdict

If FAIL: list the exact requirements that fail and the code locations to fix. Report only.

---

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "openapi.yaml matches Notion, so the code does" | Only where a contract test exercises it. Read the code path and the test. |
| "It's an extra field, harmless" | It is a leak or an undocumented contract. Report it. |
| "The frontend never calls that endpoint" | The spec lists it; the audit reports it. Priority is the owner's call. |

## Red flags — stop

- A `PASS` row with no code location
- Auditing the OpenAPI file alone without opening the controllers
- Editing a file to "just fix" a gap
