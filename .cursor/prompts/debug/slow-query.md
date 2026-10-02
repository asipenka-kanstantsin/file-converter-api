# Slow Query Prompt

## Role

You are a senior backend engineer diagnosing a slow endpoint or query on PostgreSQL.

Measure first. A fix without a before/after plan and timing is a guess.

Follow `07-database-*.mdc`, `14-logging.mdc`, `.cursor/workflows/db-migration.md` (for index
changes).

---

## Inputs

- the slow endpoint (method, path, params) and its latency, or the SQL
- data volume of the tables involved
- environment where it is slow

Use the read-only `psql` session (`docker compose exec postgres psql -U app_readonly -d app`) on a **dev** database with realistic volume. Never run
`EXPLAIN ANALYZE` on a data-modifying statement against a shared database — `ANALYZE` executes it.

---

# Step 1 — Count the queries

Enable ORM query logging locally (Prisma `log: ["query"]`, TypeORM `logging: ["query"]`) and call the
endpoint once.

- query count grows with page size → **N+1**. Fix by loading the relation in the same query
  (`include`/`relations`/join) or one `WHERE id = ANY($1)` batch, then mapping in memory.
- the same query repeated → cache within the request or restructure the service.
- `SELECT *` pulling wide `jsonb`/text columns → `select` only the needed fields.

# Step 2 — Find the expensive statement

```sql
select calls, round(mean_exec_time::numeric, 1) as mean_ms, round(total_exec_time::numeric) as total_ms,
       rows, query
from pg_stat_statements
order by total_exec_time desc
limit 20;
```

- requires the `pg_stat_statements` extension (`shared_preload_libraries`); enable in the dev
  docker-compose if missing
- rank by `total_exec_time` for overall load, `mean_exec_time` for per-call latency

# Step 3 — Read the plan

```sql
explain (analyze, buffers, format text)
select … ;  -- with real parameter values
```

Look for:

| Symptom | Likely cause |
| --- | --- |
| `Seq Scan` on a large table with a selective filter | missing index |
| `Rows Removed by Filter` ≫ rows returned | index does not cover the filter |
| `Sort` + `external merge Disk` | no index for `ORDER BY`; `work_mem` |
| estimated rows ≪ actual rows | stale statistics → `ANALYZE <table>`; correlated columns |
| `Nested Loop` with a large outer side | missing join index, bad estimate |
| high `shared read` buffers | cold cache or reading too many pages |
| `OFFSET` large | offset pagination on deep pages → keyset/cursor pagination |

# Step 4 — Fix

- **Index** matching the query shape: equality columns first, then range/sort column
  (`(user_id, created_at desc)`); partial index for a common predicate
  (`where deleted_at is null`); expression index for `lower(email)`.
- Composite index order must match `WHERE` + `ORDER BY` to avoid a sort.
- On large tables create with `CREATE INDEX CONCURRENTLY` in its own migration (no transaction).
- `count(*)` for `total` on huge tables: keep it if the AC needs an exact total; otherwise discuss
  an estimate or cursor pagination (contract change).
- Rewrite `OR` across columns as `UNION ALL`; replace `NOT IN (subquery)` with `NOT EXISTS`.
- Move heavy aggregation out of the request (materialised view / job) only when measured.

Do not add indexes speculatively; each costs write time and storage.

# Step 5 — Verify

- plan after the fix uses the index; `EXPLAIN ANALYZE` timing before vs after
- endpoint query count constant with page size
- e2e still green; migration reviewed per `db-migration.md`

---

# Output Format

## Symptom

Endpoint, latency, volume.

## Evidence

Query count, `pg_stat_statements` row, plan excerpt (before).

## Root Cause

## Fix

Code change and/or migration (index DDL).

## Result

Plan excerpt and timing after.
