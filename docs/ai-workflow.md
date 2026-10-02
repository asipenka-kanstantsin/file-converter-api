# AI Workflow Documentation

## Purpose

How AI agents work with this backend repository.

The goal:

- predictable AI behavior
- consistent code generation
- a stable contract, a safe schema, no architectural violations

---

# Agent Workflow

```
Understand → Inspect → Plan → Implement → Review → Accept → Branch & PR
```

Full description: `.cursor/knowledge/17-agent-workflow.mdc`.

---

# Understand

The agent must understand:

- the requirement and its AC (Notion via `requirements-check`)
- the observable result: status, body, `code`, DB rows, mail, files
- the affected module, tables and consumers

---

# Inspect

The agent inspects:

- the closest similar module and endpoint
- exported services, error codes, DTO fragments
- schema and migrations for the tables involved
- `openapi/openapi.yaml` for affected paths

Priority:

1. Existing working code
2. .cursor/rules
3. .cursor/knowledge
4. AGENTS.md
5. docs
6. General best practices

---

# Plan

For non-trivial tasks the agent provides:

- owning module
- endpoints with statuses and error codes
- DTOs
- schema change and migration plan
- transactions and side effects
- tests

---

# Implement

Follow:

- layering and module boundaries
- TypeScript rules
- API and error rules
- database rules
- security rules
- localization of error `detail` and mail

---

# Review

Before finishing:

- `npm run verify`
- the Skeptic step of the workflow (`15-review.mdc`)
- `acceptance-check` — the running API exercised over HTTP against the AC

---

# Branch & PR

1. Branch from `main` (one task — one branch): `<type>/<TASK-ID>_<short_description>`.
2. Migrations in the same PR as the code that needs them.
3. Sync via `git rebase origin/main`, re-run migrations and `verify`.
4. Open a PR with the template, including Contract changes and Schema changes.
5. CI green, debug code removed.
6. Squash and Merge only.

Full rules: `.cursor/knowledge/16-git.mdc`.

---

# AI Decision Rules

## Before Creating

"Does a module, service, DTO or error code for this already exist?"

## Before Adding a Module

"Is this a new business domain, or a capability of an existing one?"

## Before Changing a Response or Status

"Who consumes this, and is it breaking?"

## Before Changing the Schema

"Is it safe on a populated table and during a rolling deploy?"

## Before a Side Effect

"Does it go through the outbox in the same transaction?"

## Before Adding a Dependency

"Can Nest, the current stack or Node solve this?"

---

# Forbidden AI Behavior

Do not:

- create random folders or modules
- duplicate existing code
- add libraries without approval
- ignore module boundaries
- change the contract or the schema silently
- edit an applied migration
- hardcode user-readable server text
- log secrets or PII
- use any
