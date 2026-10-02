# Create Module Prompt

## Role

You are a senior backend engineer adding a business module to a NestJS modular monolith.

Follow:

- `01-architecture.mdc` (layout, layering, boundaries)
- `03-nestjs.mdc`, `05-api-design.mdc`, `08-errors.mdc`, `07-database-*.mdc`
- `21-naming.mdc`, `22-imports.mdc`

---

## Before Writing

1. Confirm a new module is right: one module per business **domain**, not per table. If an existing
   module owns the concept, extend it.
2. Read the closest existing module end to end and mirror its shape.
3. List the services this module needs from other modules — they must be exported there. If the
   other module would also need this one, the boundary is wrong: stop and report.

Explain the plan (module name, public API, endpoints, tables) and wait for confirmation.

---

## Layout

```
src/modules/<domain>/
  <domain>.module.ts
  <domain>.controller.ts
  <domain>.service.ts
  <domain>.repository.ts
  <domain>.mapper.ts
  <domain>.types.ts
  dto/
    create-<entity>.dto.ts
    update-<entity>.dto.ts
    list-<entities>-query.dto.ts
    <entity>-response.dto.ts
  <domain>.service.spec.ts
  index.ts
test/<domain>/<domain>.e2e-spec.ts
```

---

## Module

```ts
@Module({
  controllers: [SavedSearchesController],
  exports: [SavedSearchesService],
  imports: [DatabaseModule, UsersModule],
  providers: [SavedSearchesMapper, SavedSearchesRepository, SavedSearchesService],
})
export class SavedSearchesModule {}
```

- export only the service (and types) other modules need; never the repository
- register the module in `app.module.ts`
- `index.ts` re-exports the module class, the exported service and public types — nothing else

---

## Layers

| File | Contains |
| --- | --- |
| controller | routes, guards/decorators, DTO params, one service call per handler, `x-error-codes` in `openapi/openapi.yaml` |
| service | rules, ownership checks, transactions, calls to repositories and other modules' services, outbox enqueue |
| repository | ORM queries only; returns domain types; accepts an optional transaction client |
| mapper | pure entity → response DTO |
| types | status unions, domain types |

---

## Checklist

- [ ] error codes with the domain prefix, in the enum and every locale
- [ ] migration for new tables (`create-entity.md`)
- [ ] OpenAPI tag for the controller
- [ ] boundaries lint passes (no deep imports into or out of the module)
- [ ] service spec for rules; e2e spec for every endpoint
- [ ] `npm run verify` passes

---

## Output

- files created / modified
- public API of the module
- contract changes (new endpoints)
- schema changes
