---
name: nest-module
description: Recipe for creating a new business module in this NestJS modular monolith — folder layout, module wiring, index.ts public API, registration in AppModule, exporting only the service, boundary lint rules and the first e2e test. Use when a feature needs a new business domain, a new modules/<domain> folder, or when splitting a domain out of an existing module.
---

# Recipe: new business module

Read `01-architecture` and `03-nestjs`. First prove a new module is needed: one module per **business domain**, not per table. If an existing domain owns the concept, extend that module instead. Never create a new top-level folder.

## 1. Layout — `src/modules/<domain>/` (kebab-case, plural)

```
<domain>.module.ts
<domain>.controller.ts
<domain>.service.ts
<domain>.repository.ts
<domain>.mapper.ts
<domain>.types.ts          domain types, status unions
dto/                       one zod DTO per file
<domain>.service.spec.ts
index.ts                   public API
```

Add files only when used — no empty mapper or types file. A second controller (e.g. admin routes) is `<domain>-admin.controller.ts` in the same module.

## 2. Module wiring

```ts
@Module({
  controllers: [AssignmentsController],
  exports: [AssignmentsService],
  imports: [DatabaseModule, UsersModule],
  providers: [AssignmentsRepository, AssignmentsService],
})
export class AssignmentsModule {}
```

- `exports` holds the **service only** — never the repository.
- `imports` lists the modules whose exported services this one calls; infrastructure modules (database, mail, outbox, storage) as needed.
- No `forwardRef`. A cycle means one of the two modules owns something it should not — move it, or react through an outbox/domain event.
- No request-scoped providers unless required (they cascade scope).

## 3. Public API — `index.ts`

```ts
export { AssignmentsModule } from "./assignments.module";
export { AssignmentsService } from "./assignments.service";
export type { Assignment, AssignmentStatus } from "./assignments.types";
```

Other modules import `@/modules/assignments` only. DTOs, repository, mapper and controller are not exported.

## 4. Register

Add the module to `imports` in `src/app.module.ts` (sorted alphabetically). Global guards already apply: every route is authenticated until marked `@Public()`.

## 5. Boundaries lint

Confirm the `no-restricted-imports` layer rules in `eslint.config.mjs` cover the new folder: other modules may import only `@/modules/<domain>` (index), never `@/modules/<domain>/*`. If rules are listed per module rather than by glob, add the entry. Run `npm run lint` and check a deliberate deep import fails.

## 6. Schema and errors

Tables via `db-migration`. Error codes prefixed with the domain (`ASSIGNMENT_…`), in the enum and every locale. Config the module needs → `config/env.schema.ts` + `AppConfig`, never `process.env`.

## 7. First endpoint and e2e test

Build the first endpoint with `api-endpoint`. Create `test/<domain>/<domain>.e2e-spec.ts` using the shared helpers in `test/helpers` (app factory, DB reset, auth helper) — covering at least: happy path, 401 unauthenticated, 400 validation, another user's resource, missing permission. It proves the module is wired, the guards apply and the DB is reachable.

## 8. Verify

`npm run lint && npm run typecheck && npm run test && npm run build && npm run test:e2e`; the module's routes appear in `openapi/openapi.yaml` under their own tag.

## Red flags

- `exports: [XRepository]`
- Another module importing `@/modules/<domain>/<domain>.repository`
- A module created for one table that another domain obviously owns
- A generic `BaseService`/`BaseRepository` introduced "for the next module"
