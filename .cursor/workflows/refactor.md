# Workflow: Refactor

Goal: improve code without changing behavior — neither the HTTP contract nor the schema.

Before starting, read `AGENTS.md`, `.cursor/rules/`, and relevant `.cursor/knowledge/` files.

---

## Step 1 — Researcher

Mission: analyze the current implementation. Never change files.

Search for:

- duplication and code smells (fat controllers, ORM in services, cross-module deep imports)
- existing patterns to align with
- architectural constraints
- test coverage of the code in scope — a refactor without tests covering it starts by adding them

Snapshot the contract for the endpoints in scope (`openapi/openapi.yaml` paths and schemas) so Step 3 can
diff it.

Return:

### Existing implementation

### Related files

### Problems found

Duplication, smells, coupling, boundary violations.

### Test coverage

What is covered; which characterization tests to add first.

### Risks

What could break: callers, transactions, query count, error mapping.

### Recommendation

Suggested refactor plan in small, independently green steps.

If enough information is collected, continue to Step 2.

---

## Step 2 — Executor

Mission: improve code without changing behavior.

Priority:

1. Existing code
2. .cursor/rules
3. .cursor/knowledge
4. AGENTS.md

Requirements:

- do not change behavior, response shapes, statuses, codes or the schema
- no migration (a refactor that needs one is not a refactor — stop and report)
- preserve layering, typing, localization, exported module APIs
- keep changes focused on the refactor scope
- reuse existing abstractions where possible
- keep the query count per request the same or lower

Run `npm run verify`.

Return:

### Changes

Files created and modified.

### Implementation notes

What improved and why.

### Verification

Commands run and results.

---

## Step 3 — Skeptic

Mission: verify the refactor. Never change files.

Verify:

- behavior unchanged: tests green without being edited to fit
- OpenAPI for the endpoints in scope identical to the Step 1 snapshot
- no migration, no schema drift
- architecture improved; no new duplication, coupling or cycles
- typing and localization intact
- `npm run verify` passes

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

If PASS: run `acceptance-check` on the endpoints in scope.
