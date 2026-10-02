# Workflow: Bugfix

Goal: fix a bug with minimal, targeted changes.

Before starting, read `AGENTS.md`, `.cursor/rules/`, and relevant `.cursor/knowledge/` files. Use
`superpowers:systematic-debugging`. Pull the AC with `requirements-check` — the AC decides whether
the reported behaviour is a bug.

---

## Step 1 — Researcher

Mission: find the root cause. Never change files. Never guess.

Reproduce first:

- the exact request (method, path, headers, body, locale, role) and the observed response
- the DB state before and after (read-only `psql` as `app_readonly` or the seed)
- logs for the request id
- the AC item that defines the expected behaviour

Search for:

- the controller → service → repository path for the endpoint
- the error code or filter branch that produced the response
- recent changes (`git log -p` on the files, recent migrations)
- other callers of the code you would change

Return:

### Reproduction

Request, expected (with AC reference), actual.

### Existing implementation

### Related files

### Root cause

File, line, mechanism.

### Risks

Other callers, contract impact, data already written in the wrong shape.

### Recommendation

Smallest fix, regression test to add, data fix if needed.

If the root cause is identified, continue to Step 2. If it does not reproduce, stop and report how
it was tried.

---

## Step 2 — Executor

Mission: fix only the root cause.

Priority:

1. Existing code
2. .cursor/rules
3. .cursor/knowledge
4. AGENTS.md

Requirements:

- write the regression test first; watch it fail
- fix the identified root cause only
- avoid unrelated refactoring
- preserve layering, contract, typing, localization
- a fix that changes a status, a field or a `code` is a contract change — call it out
- bad data already stored → a migration or a one-off script reviewed like a migration, never a
  manual `UPDATE` on a shared database
- keep changes minimal

Run `npm run verify`.

Return:

### Changes

Files created and modified.

### Contract changes

### Schema changes

### Implementation notes

Why this fix addresses the root cause.

### Verification

The regression test (red → green) and commands run.

---

## Step 3 — Skeptic

Mission: verify the fix. Never change files.

Verify:

- the original request now returns the AC behaviour
- the regression test fails without the fix
- no regressions in other callers
- layering, typing, error codes and localization intact
- no new PII in logs, no weakened auth

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
