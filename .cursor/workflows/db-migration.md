# Workflow: Database Migration

Goal: change the schema safely — on a fresh database, on a populated one, and during a rolling
deploy where old and new code run side by side.

Before starting, read `AGENTS.md`, `.cursor/rules/04-database.mdc`, `07-database-*.mdc` (the one
for the project's ORM), `16-git.mdc` → Migrations, and `.cursor/prompts/generate/create-entity.md`.

---

## Step 1 — Researcher

Mission: understand the current schema and the data in it. Never change files.

Inspect:

- current schema file / entities and the latest migrations on the branch and on `main`
- the dev database through read-only `psql` as `app_readonly`: table size, null counts, duplicates that
  would break a new unique constraint, existing indexes and constraint names
- every reader and writer of the affected tables (grep repositories)
- deploy order: which code must be live before or after the migration

Classify each change:

| Change | Safe in one step? |
| --- | --- |
| add nullable column / new table / new index (small table) | yes |
| add NOT NULL column | only with a default that needs no rewrite, else add nullable → backfill → constrain |
| add unique / FK / check constraint on existing data | after verifying data; `NOT VALID` then `VALIDATE` on large tables |
| index on a large table | `CREATE INDEX CONCURRENTLY` (outside a transaction) |
| rename / drop column or table, narrow a type | no — expand → migrate → contract across PRs |
| data backfill | batched, idempotent, separate from DDL if large |

Return:

### Current schema

### Data findings

Row counts, nulls, duplicates, measured with queries (quote them).

### Affected code

### Migration plan

Ordered steps, which PR each lands in, reversibility of each.

### Risks

Locks, long rewrites, deploy order, irreversible steps.

### Recommendation

If the plan is complete, continue to Step 2.

---

## Step 2 — Executor

Mission: implement the migration and the code that needs it, in the same PR.

Requirements:

- edit the schema/entities, then generate the migration (`npm run db:generate`); review the SQL
- name it after the change; one logical change per migration
- snake_case, plural tables, uuid `id`, `created_at`/`updated_at` timestamptz, FKs indexed,
  constraint names explicit so `AllExceptionsFilter` can map them
- a new unique constraint → map its name to an `ErrorCode` in the filter
- down migration written, or the file states it is irreversible and why
- never edit a migration already applied on a shared environment — add a new one
- update seeds and test factories
- repositories updated; no raw SQL built by concatenation

Verify:

```bash
npm run db:migrate           # on a database migrated from main
npm run db:seed
npm run test:e2e
```

Also apply on a fresh database (reset local only) and roll back once if a down exists.

Return:

### Changes

### Schema changes

Migration file names and the SQL summary.

### Contract changes

### Verification

Commands run on fresh and populated databases.

---

## Step 3 — Skeptic

Mission: verify the migration is safe. Never change files.

Read the generated SQL, not only the schema diff.

Verify:

- runs on a populated table without a long exclusive lock or full rewrite
- old code keeps working after the migration (rolling deploy), new code works before the contract step
- constraints match the data measured in Step 1
- indexes exist for new FKs and list filters/sorts
- no applied migration edited; migration order correct after rebase
- down path correct or irreversibility stated
- seeds, factories and e2e updated

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

If PASS: run `acceptance-check` on the behaviour the migration enables.
