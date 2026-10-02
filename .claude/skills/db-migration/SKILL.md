---
name: db-migration
description: Recipe for any database schema change in PostgreSQL with Prisma or TypeORM — adding/removing/renaming columns or tables, indexes, constraints, enums, backfills — covering migration generation, hand review of the SQL, safe expand/backfill/contract patterns, CREATE INDEX CONCURRENTLY, down migrations, seed updates and testing on real data. Use whenever a schema, entity, model or migration file changes.
---

# Recipe: schema change

Read `04-database` and `07-database-prisma` / `07-database-typeorm` (only one applies). A migration ships in the same PR as the code that needs it; an applied migration is never edited.

## 1. Classify the change

| Change | Safe in one release? | Pattern |
| --- | --- | --- |
| new table, new nullable column | yes | plain |
| new column NOT NULL | only with a constant default (PG 11+ adds it without rewrite) | add with default; or expand → backfill → constrain |
| index on a populated table | no lock only with `CONCURRENTLY` | separate migration, non-transactional |
| unique constraint | build `CREATE UNIQUE INDEX CONCURRENTLY`, then `ADD CONSTRAINT … USING INDEX` | two steps |
| FK on a populated table | `ADD CONSTRAINT … NOT VALID`, then `VALIDATE CONSTRAINT` | two steps |
| rename column/table | **no** | add new → dual-write + copy → switch reads → drop old, across releases |
| type change | **no** (rewrite + lock) | as rename |
| drop column | only after no deployed code reads it | contract step in a later release |
| enum value add | yes (`ALTER TYPE … ADD VALUE`, outside a transaction on older PG) | plain; removal = new type + swap |
| backfill | batched, idempotent | separate migration or job (`20-jobs`), never one giant `UPDATE` |

Expand/backfill/contract: release N adds the new shape and writes both; a backfill fills history; release N+1 reads the new shape; release N+2 drops the old. Say in the PR which step this is.

## 2. Edit the schema

snake_case plural tables, `id uuid` PK, `created_at`/`updated_at timestamptz`, FK columns indexed, every column a list filters or sorts by indexed.

## 3. Generate

**Prisma** (`prisma/schema.prisma`):

```bash
npx prisma migrate dev --create-only --name add_assignment_published_at   # = npm run db:generate
# edit prisma/migrations/<ts>_add_…/migration.sql by hand if needed
npx prisma migrate dev          # apply locally
npx prisma generate             # Prisma 7: migrate dev no longer regenerates the client
npx prisma migrate deploy       # CI / prod
```

Prisma has no down migrations: write the reverse SQL next to it (`down.sql`, applied manually) or state "irreversible" in the PR. `CONCURRENTLY` cannot run in Prisma's per-migration transaction — put it alone in its own migration.

**TypeORM** (entities in `modules/*`, data source in `infrastructure/database`):

```bash
npx typeorm-ts-node-commonjs migration:generate -d src/infrastructure/database/data-source.ts \
  src/infrastructure/database/migrations/AddAssignmentPublishedAt       # = npm run db:generate
npx typeorm-ts-node-commonjs migration:run    -d src/infrastructure/database/data-source.ts
npx typeorm-ts-node-commonjs migration:revert -d src/infrastructure/database/data-source.ts
```

Fill `down()` for real, or make it throw with a sentence saying why it is irreversible. For `CONCURRENTLY` set `transaction = false` on that migration class. `synchronize` stays `false` everywhere.

## 4. Review the SQL by hand

Read every statement. Reject or rewrite:

- `DROP`/`ALTER … TYPE` you did not intend (generators turn renames into drop + add — data loss)
- `ADD COLUMN … NOT NULL` without a default on an existing table
- `CREATE INDEX` without `CONCURRENTLY` on a populated table
- a constraint validated in the same step it is added on a big table
- a missing index on a new FK
- anything that rewrites the whole table under an `ACCESS EXCLUSIVE` lock

## 5. Seed and code

Update `db:seed` so a fresh dev DB is valid under the new constraints. Update repository, DTOs and mapper in the same change; a new column never reaches a response without the response DTO listing it.

## 6. Test

- Fresh: drop the dev DB, `npm run db:migrate && npm run db:seed` — clean.
- **On data**: restore a copy with realistic rows (seed at volume or an anonymised dump), run the migration, time it, check row counts and the backfilled values.
- Down: run revert/`down.sql`, then up again — or confirm the PR says irreversible.
- `npm run test:e2e` (runs migrations on the test DB).

## PR notes

Migration name, the pattern step (expand / backfill / contract), lock impact, reversibility, required deploy order.

## Red flags

- Editing a migration already applied on a shared environment
- A generated migration committed without being read
- `migrate reset` or `db push` against anything but a throwaway local DB
- A rename done as a single migration
