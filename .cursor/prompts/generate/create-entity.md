# Create Entity Prompt

## Role

You are a senior backend engineer adding a table (entity / Prisma model) and its migration.

Follow `04-database.mdc`, `07-database-*.mdc` (the project's ORM), `.cursor/workflows/db-migration.md`.

---

## Before Writing

- confirm the owning module; the table belongs to exactly one module
- check an existing table does not already model it
- list every query the module will run against it (filters, sorts, joins) — they decide the indexes

---

## Conventions

| Item | Rule |
| --- | --- |
| Table | snake_case plural: `saved_searches` |
| Columns | snake_case; code sees camelCase via ORM mapping |
| Primary key | `id uuid` (v7 generated in the app unless the project decided otherwise) |
| Timestamps | `created_at`, `updated_at` `timestamptz`, UTC, defaults from the DB |
| Soft delete | only if the AC needs it: `deleted_at timestamptz null` + partial indexes |
| Money | integer minor units + `currency char(3)` |
| Enums | text + check constraint, or a native enum per `07-database-*.mdc`; values lower_snake |
| JSON | `jsonb`, with a zod schema that parses it on read |
| FK | explicit `ON DELETE` behaviour; always indexed |
| Constraint names | explicit: `<table>_<cols>_key`, `<table>_<col>_fkey`, `<table>_<rule>_check` |

---

## Example (Prisma)

```prisma
model SavedSearch {
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  filters   Json
  id        String   @id @db.Uuid
  name      String   @db.VarChar(100)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String   @map("user_id") @db.Uuid

  @@index([userId, createdAt(sort: Desc)])
  @@unique([userId, name], map: "saved_searches_user_id_name_key")
  @@map("saved_searches")
}
```

TypeORM: the same columns with `@Entity("saved_searches")`, `@Index`, `@Unique`, `name:` on each
column and constraint, `timestamptz` types.

---

## Migration

1. change the schema / entity
2. `npm run db:generate -- <name>`
3. read the generated SQL; fix what is unsafe for a populated database
4. `npm run db:migrate` on a DB migrated from `main`; also on a fresh DB
5. map new unique/FK constraint names to `ErrorCode`s in `AllExceptionsFilter`
6. update seeds and test factories

---

## Repository

- the only class that uses the model
- methods named by intent (`findOwned(id, userId)`, `listByUser(userId, page)`)
- accept an optional transaction client
- return domain types; parse `jsonb` with its zod schema

---

## Output

- schema/entity file, migration file name, SQL summary
- indexes and why each exists
- constraint → error code mappings added
