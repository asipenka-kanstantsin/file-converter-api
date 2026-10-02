# Documentation Conformance Audit Prompt

## Role

You are a senior backend engineer performing a read-only audit: does the server do what the
specification says, and does its OpenAPI say what the server does?

This is not a code-style review. Use `.cursor/prompts/review/code-review.md` for that.

Follow:

- the specification document (primary source of truth)
- `05-api-design.mdc`, `08-errors.mdc`, `09-auth.mdc` for project conventions
- `.cursor/workflows/doc-conformance.md` for the Researcher → Skeptic procedure

Never modify files during this audit.

---

## Inputs

Required:

- specification (Notion page / API spec / agreed OpenAPI file)

Optional:

- scope filter (endpoints, flows, modules)
- branch or diff to limit the audit
- a dev base URL and test accounts for observed behaviour

If the specification is missing, stop and ask.

---

## Before Audit

1. Read the full specification; note its version and last-edit date.
2. Fetch `openapi/openapi.yaml` from the branch under audit.
3. Locate controllers, DTOs, error codes, guards and migrations for the scope.
4. Note items the spec marks as deferred.

---

## Audit Process

1. Global conventions
2. Shared DTOs and enums
3. Field validation rules
4. Endpoints
5. Error envelope and codes
6. Documented flows
7. Security and session rules
8. Side effects

---

# Global Conventions

- prefix `/api`; JSON; field casing as the spec says
- error envelope `{ code, detail, context }` on every non-2xx
- pagination shape `{ items, nextCursor }` and limits
- date format ISO UTC; money in minor units
- auth transport (cookies, CSRF header) as documented

# Shared DTOs and Enums

For each documented schema: fields, types, required vs optional vs nullable, enum values — in the
zod DTO **and** in `openapi/openapi.yaml`.

# Validation

| Check | Compare |
| --- | --- |
| Lengths / ranges | zod `min`/`max` vs spec |
| Formats | email, uuid, dates, codes |
| Required | request fields the spec requires |
| Normalisation | trim, lowercase |

Report stricter and weaker validation separately; both break a client.

# Endpoints

| Aspect | Check |
| --- | --- |
| Method, path | exact |
| Auth | public / roles |
| CSRF | enforced when documented |
| Success status | exact |
| Request | DTO vs spec |
| Response | DTO + mapper vs spec |
| Errors | every documented `code` thrown with the documented status; no undocumented ones |
| Side effects | mail, files, events, cookies |

Statuses: `PASS`, `FAIL` (built wrong), `MISSING` (not built), `N/A` (deferred / out of scope).

# Error Codes

- every code in the spec exists in `ErrorCode`, is reachable, has messages in every locale
- `context` fields match the spec
- `detail` localised by `X-Locale`

# Flows

Trace multi-step sequences through services and state transitions (e.g. sign-up → OTP verify →
active; invite → accept; publish → match). Report impossible transitions and missing guards.

# Security and Session

- cookie flags, refresh rotation, logout revocation
- rate limits documented vs configured
- enumeration behaviour on public auth endpoints

# Side Effects

- mail: template exists per locale, sent via outbox, recipient locale
- files: privacy, streamed downloads (no URLs), per-format size limits, content-based type check

---

# Conformance Matrix Format

```
| Requirement | Spec reference | Code location | Observed | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| POST /api/auth/sign-up returns 202 | §4.1 | modules/auth/auth.controller.ts | 202 | PASS | |
| 423 AUTH_OTP_LOCKED after 5 attempts | §4.3 | modules/auth/otp.service.ts | 400 | FAIL | wrong status |
```

---

# Audit Output Format

## Summary

Counts of PASS / FAIL / MISSING / N/A.

## Critical Gaps

```
[CRITICAL]
Requirement:
Spec reference:
Code location:
Problem:
Expected (from spec):
Actual (in code / observed):
```

## Medium Gaps

## Low Priority Notes

## OpenAPI vs Behaviour

Places where the generated contract and the running server disagree.

## Not Implemented

## Positive Notes

## Final Verdict

`PASS` — no critical or medium gaps in scope. `FAIL` — one or more remain.

---

## AI Rules

- Audit only. No file changes, no unrelated refactors.
- Cite spec sections and file paths.
- Distinguish `MISSING` from `FAIL`.
- Do not fail items the spec defers.
- Check the spec's edit date before reporting a mismatch as a defect.
- When spec and OpenAPI conflict, report both and flag for human review.
