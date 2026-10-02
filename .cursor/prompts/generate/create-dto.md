# Create DTO Prompt

## Role

You are a senior backend engineer defining request and response DTOs with zod (`nestjs-zod`).
They generate the OpenAPI the frontend reads, so they are the contract.

Follow `05-api-design.mdc`, `06-validation.mdc`.

---

## Rules

- one DTO per file in `modules/<domain>/dto/`, kebab-case: `create-saved-search.dto.ts`
- export the schema (`createSavedSearchSchema`) and the class (`CreateSavedSearchDto`)
- request DTOs validate everything the handler reads; response DTOs list every field returned
- reuse shared fragments (`paginationQuerySchema`, `uuidSchema`, `isoDateSchema`) from `common/`
- limits come from the AC; if the AC has none, pick one and note it
- no `z.any()`, no `z.unknown()` without a following parse, no passthrough objects
- object keys sorted alphabetically

---

## Request

```ts
export const createSavedSearchSchema = z.object({
  filters: savedSearchFiltersSchema,
  name: z.string().trim().min(1).max(100),
});
export class CreateSavedSearchDto extends createZodDto(createSavedSearchSchema) {}

export const updateSavedSearchSchema = createSavedSearchSchema.partial();
export class UpdateSavedSearchDto extends createZodDto(updateSavedSearchSchema) {}
```

- strings: `trim()` + `max()`; emails `trim().toLowerCase().email().max(254)`
- ids: `z.string().uuid()`
- numbers from query: `z.coerce.number().int().min().max()`
- booleans from query: explicit `"true" | "false"` transform, not `z.coerce.boolean()`
- enums: `z.enum([...])` from the domain union
- dates: ISO string → `z.string().datetime()`; date-only `z.string().date()`

## List query

```ts
export const listSavedSearchesQuerySchema = paginationQuerySchema.extend({
  order: z.enum(["asc", "desc"]).default("desc"),
  sort: z.enum(["createdAt", "name"]).default("createdAt"),
});
```

## Response

```ts
export const savedSearchResponseSchema = z.object({
  createdAt: z.string().datetime(),
  filters: savedSearchFiltersSchema,
  id: z.string().uuid(),
  name: z.string(),
  updatedAt: z.string().datetime(),
});
export class SavedSearchResponseDto extends createZodDto(savedSearchResponseSchema) {}
```

- nullable (`.nullable()`) = present and may be `null`; optional (`.optional()`) = may be absent.
  Choose deliberately; prefer always-present nullable fields in responses.
- no internal fields (hashes, internal flags, other users' data)
- the mapper builds the object field by field — never spread an entity

---

## Checklist

- [ ] OpenAPI shows the schema with limits and enums
- [ ] a 400 test for at least one limit
- [ ] response DTO fields match the mapper exactly
- [ ] a changed existing DTO is listed under contract changes (breaking?)
