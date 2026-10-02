---
name: refactor
description: Improve backend code without changing behaviour — HTTP responses, openapi/openapi.yaml and the DB schema stay identical — using a Requirements → Researcher → Executor → Skeptic → QA loop. Use when the user asks to refactor, clean up, deduplicate, restructure, split or move a module, service or repository, rename internals, or improve code quality in this NestJS repo.
---

# Workflow: Refactor

Goal: improve the code while every externally observable behaviour stays the same.

"Unchanged" here is measurable, and all three must hold:

1. **HTTP behaviour** — same statuses, bodies, error codes, headers, side effects for the same requests.
2. **OpenAPI contract** — `openapi/openapi.yaml` unchanged and the contract tests green before and after.
3. **Schema** — no migration, unless the refactor was explicitly scoped to include one (then it is declared, and follows `db-migration`).

Before starting, read `AGENTS.md`, `.cursor/rules/`, `01-architecture`, and the knowledge files for the area touched.

Run Step 0 first, then the four steps in order. If Step 3 returns FAIL, go back to Step 2. Step 4 runs only after Step 3 passes.

---

## Step 0 — Requirements

**Do not skip. Do not delegate to a subagent.**

Use `requirements-check` to pull the AC for the area. "Behaviour unchanged" is measured against the AC too: code that never satisfied the AC must not have that gap preserved as intended — report it as a finding, do not fix it inside the refactor.

Return `### Requirements`. Do not modify a file before it exists.

---

## Step 1 — Researcher and baseline

**Never change files** (baseline artefacts go to the scratchpad, not the repo). Prefer `Explore` for the search.

Capture the baseline **before any edit**, with the API running:

```bash
npm run test && npm run test:e2e   # must be green; paste the summary
```

If e2e coverage of the touched endpoints is thin, list the missing cases — they are written first, against the old code, in Step 2.

Search for: duplication and smells; the pattern the rest of the codebase uses; every importer of what will move (`grep` the symbol and the `@/modules/<x>` path); DI tokens and exported providers that other modules depend on.

Return:

### Existing implementation
### Related files
### Problems found
Duplication, layering violations, coupling, dead code.
### Baseline
Contract tests green on the unchanged code, test summary, coverage gaps to close first.
### Risks
Exports other modules rely on, DI wiring, DTO shapes the contract tests check, transaction boundaries that could shift.
### Recommendation

---

## Step 2 — Executor

Mission: restructure without changing behaviour.

Priority: 1. AGENTS.md  2. `.cursor/knowledge/`  3. Project architecture  4. Existing code

- first add the missing characterisation tests against the unchanged code, and see them pass
- keep each module's public API (`index.ts`) and exported providers stable unless the refactor's purpose is to change them — then update every importer in the same change
- keep DTO shapes exactly as `openapi/openapi.yaml` describes them
- keep transaction boundaries and query shapes, or show they are equivalent
- no new features, no bug fixes (report found bugs for a `bugfix` run)
- no migration unless explicitly in scope

Run and paste: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:e2e`. Then:

```bash
git diff --exit-code origin/main -- openapi/openapi.yaml && echo CONTRACT UNCHANGED
```

Any difference is a behaviour change — revert it, or stop and ask whether it is in scope. `jq -S` diffs help read it; they do not excuse it.

Return:

### Changes
### Implementation notes
What improved and why.
### Verification
Test summaries, `git diff` of `openapi/openapi.yaml` (must be empty), `git diff --stat` showing no migration.

---

## Step 3 — Skeptic

**Never change files.** Prefer a fresh subagent.

Verify:

1. behaviour unchanged and still consistent with `### Requirements`; e2e suite identical in outcome
2. `openapi/openapi.yaml` untouched in the diff and contract tests green (re-run, do not trust the report)
3. no migration files, no schema/entity diff, unless declared in scope
4. boundaries improved or preserved: no new cross-module deep import, no cycle, no `forwardRef`
5. no new duplication, no speculative abstraction (`BaseService` etc.)
6. error codes, log fields (no new PII), i18n keys unchanged
7. lint, typecheck, build, tests pass

Return only **### PASS** or **### FAIL**, then: Critical issues · Medium issues · Low priority improvements · Final verdict.

---

## Step 4 — QA acceptance

Only after Step 3 returns PASS. Use `acceptance-check` on every endpoint the refactor touched. The claim under test is "behaviour is unchanged" — "the code is equivalent" is an argument, not an observation. Watch what a move silently drops: a guard or `@RequirePermission` no longer applied, an interceptor, an `x-error-codes` in `openapi/openapi.yaml`, a locale key, an outbox event.

**Do not report the task done before the `### QA report` exists.**

---

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "The spec diff is just wording" | A refactor does not touch the contract. Any spec diff is out of scope. |
| "Renaming a response field is internal" | The contract test and the frontend disagree. It is a contract change. |
| "I fixed a small bug on the way" | Now the refactor changes behaviour and the fix has no test. Split it. |
| "Tests pass, so behaviour is the same" | Only for what the tests cover. Close the gaps first, against the old code. |

## Red flags — stop

- `openapi/openapi.yaml` in the diff of a refactor
- A migration file in the diff of a refactor not scoped for one
- A test changed its expected status or body
- A module's `index.ts` lost an export something still imports
