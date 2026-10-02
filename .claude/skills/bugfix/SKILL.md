---
name: bugfix
description: Fix a backend bug with a minimal, targeted change using a Requirements → Researcher → Executor → Skeptic → QA loop, reproducing it with a failing test first. Use when the user reports a bug, defect, wrong status code, wrong error code, 500, bad response body, broken endpoint, missing mail, data corruption, slow query or any server error to diagnose and fix.
---

# Workflow: Bugfix

Goal: fix the root cause with the smallest change, proven by a test that failed before the fix and passes after.

Before starting, read `AGENTS.md`, `.cursor/rules/`, and the relevant `.cursor/knowledge/` files (`08-errors` for anything status/code related, `07-database-*` for data bugs, `09-auth` / `19-security` for access bugs, `18-testing` for the test).

Use `superpowers:systematic-debugging` inside Step 1.

Run Step 0 first, then the four steps in order. If Step 3 returns FAIL, go back to Step 2. Step 4 runs only after Step 3 passes.

---

## Step 0 — Requirements

**Do not skip. Do not delegate to a subagent.**

Use `requirements-check` to pull the AC. Expected behaviour is defined by the AC, not by what the code does now, and not by what the frontend happens to tolerate. Without it there is no way to tell a defect from an unbuilt requirement — or from a contract change dressed as a fix.

Return `### Requirements` as `requirements-check` specifies. Do not modify a file before it exists.

---

## Step 1 — Researcher and reproduction

Find the root cause. **Never guess.** Prefer the `Explore` subagent for the search.

1. Reproduce against the running API (`docker compose up -d`, `npm run start:dev`): the exact request, headers (`X-Locale`, cookies, CSRF) and the observed status + body. Check logs by request id for 500s.
2. Trace the chain: controller → pipe/guard → service → repository → SQL. Enable query logging if the bug is data-shaped.
3. Write the **failing test first** — e2e (`test/**/*.e2e-spec.ts`) when the bug is visible over HTTP, a unit spec when it is a pure rule. Run it and paste the failure. A bug that cannot be made to fail in a test is not understood yet.

Return:

### Reproduction
Request, observed response, expected response (with AC reference).
### Failing test
File, test name, the failure output.
### Related files
### Root cause
The line or decision that is wrong, and why.
### Risks
Other callers of the same code; data already written wrong (does it need a backfill?); contract impact.
### Recommendation

---

## Step 2 — Executor

Mission: fix only the root cause.

Priority: 1. AGENTS.md  2. `.cursor/knowledge/`  3. Project architecture  4. Existing code

- change the least code that makes the failing test pass
- no unrelated refactoring, no drive-by renames
- if the fix changes a status, error code or response shape, it is a **contract change**: list it and flag the frontend consumer — never ship it silently as a fix
- data already corrupted → a separate, explicit backfill migration (`db-migration`), not a hidden fix in application code
- new error code → enum + every locale + `x-error-codes` in `openapi/openapi.yaml` + assertion

Run and paste: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:e2e` when an endpoint, guard, filter or migration changed. The test from Step 1 must now pass; show it.

Return:

### Changes
### Contract changes
None, or the list.
### Implementation notes
Why this fix addresses the root cause.
### Verification
Failing test now passing; full suite outcome.

---

## Step 3 — Skeptic

**Never change files.** Prefer a fresh subagent.

Verify, in order:

1. behaviour now matches the `### Requirements`, not an assumption about intent
2. the test fails without the fix (revert mentally or actually on a scratch copy) and passes with it
3. root cause fixed, not a symptom (e.g. a `try/catch` that hides a 500 is not a fix)
4. no regressions in other callers; boundaries and layering preserved
5. contract unchanged, or the change is declared
6. DB: no unsafe migration, transactions intact, no new N+1
7. security: no weakened check, no PII added to logs
8. i18n: new keys in every locale

Return only **### PASS** or **### FAIL**, then: Critical issues · Medium issues · Low priority improvements · Final verdict.

---

## Step 4 — QA acceptance

Only after Step 3 returns PASS. Use `acceptance-check` against the `### Requirements`, including the original reproduction request. **Do not report the task done before the `### QA report` exists.**

---

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "I can see the bug, no need for a test" | Then the test takes a minute. Without it nobody knows the fix works or stays fixed. |
| "Catching the error stops the 500" | It hides the defect and returns the wrong thing. Fix what throws. |
| "The frontend expects this status anyway" | The AC and the OpenAPI document define the status. A changed status is a contract change. |
| "The bad rows will fix themselves" | They will not. Backfill explicitly or report them. |
| "While I'm here I'll tidy this service" | Separate `refactor` run. A fix diff that mixes both cannot be reviewed. |

## Red flags — stop

- A fix with no test that failed before it
- A changed status/code/field not listed under Contract changes
- A new `catch` that returns success or swallows the error
- The reproduction was never run against the live API
