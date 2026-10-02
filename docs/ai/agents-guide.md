# AI Workflows Guide

## Purpose

Structured multi-step workflows for common backend tasks.

Location:

```
.cursor/workflows/
```

Most workflows embed three roles:

```
Researcher → Executor → Skeptic
```

The documentation conformance audit is read-only:

```
Researcher → Skeptic
```

Every workflow that changes behaviour ends with the `acceptance-check` skill (QA over HTTP against
the Notion AC). Claude Code skills with the same names (`feature`, `bugfix`, `refactor`,
`api-endpoint`, `db-migration`, `doc-conformance`, `nest-module`, `requirements-check`,
`acceptance-check`) drive the same procedure.

---

# Workflows

## Feature

File: `.cursor/workflows/feature.md`

Use for: new modules, endpoint groups, flows, capabilities. Starts with Superpowers
(`brainstorming → writing-plans`).

1. **Researcher** — AC, owning module, contract table, schema plan, side effects
2. **Executor** — schema → repository → service → controller → tests
3. **Skeptic** — AC coverage, boundaries, contract, DB safety, security, tests

---

## Bugfix

File: `.cursor/workflows/bugfix.md`

1. **Researcher** — reproduce with a concrete request, find the root cause
2. **Executor** — regression test first, then the minimal fix
3. **Skeptic** — verify the fix, no regressions, no contract drift

---

## Refactor

File: `.cursor/workflows/refactor.md`

1. **Researcher** — smells, coverage, OpenAPI snapshot
2. **Executor** — no behaviour, contract or schema change
3. **Skeptic** — tests untouched and green, OpenAPI identical

---

## API Endpoint

File: `.cursor/workflows/api-endpoint.md`

1. **Researcher** — write the contract (method, path, auth, DTOs, statuses, codes)
2. **Executor** — DTOs → codes → repository → service → mapper → controller → tests
3. **Skeptic** — OpenAPI entry vs contract, every code tested

---

## Database Migration

File: `.cursor/workflows/db-migration.md`

1. **Researcher** — current schema, measured data (nulls, duplicates, volume), deploy order
2. **Executor** — generated migration with the code that needs it; seeds and factories updated
3. **Skeptic** — reads the SQL; locks, rewrites, rolling-deploy safety, reversibility

---

## Documentation Conformance Audit

File: `.cursor/workflows/doc-conformance.md`

Prompt: `.cursor/prompts/review/doc-conformance.md`

1. **Researcher** — spec vs code vs `openapi/openapi.yaml` vs observed behaviour; conformance matrix
2. **Skeptic** — independently re-check; PASS or FAIL with gaps

Does not modify files.

---

# Roles

| Role | Responsibility |
|---|---|
| Researcher | Analyze code, schema, spec and AC; never modify files |
| Executor | Implement following the approved plan (not used in the audit) |
| Skeptic | Review against `15-review.mdc` or the spec; return PASS or FAIL |

---

# Rules

Agents must:

- follow project rules and read knowledge
- keep the contract and the schema consistent and never change them silently
- avoid unnecessary changes
- preserve module boundaries
