---
name: api-endpoint
description: Step-by-step checklist for adding or changing one HTTP endpoint in an existing NestJS module — zod request/response DTOs, controller method with guards, service method with ownership check, repository query, mapper, error codes with locale messages, e2e test matrix and contract check against openapi/openapi.yaml. Use when adding a route, action, list, CRUD operation or sub-resource.
---

# Recipe: one endpoint

Runs inside Step 2 of `feature` / `bugfix`. Read `05-api-design`, `06-validation`, `08-errors`, `09-auth` first. Copy the shape of the closest existing endpoint in the same module.

## 0. Decide (write it down)

Method + path (`/api` prefix is global — never in the controller; below it, the Notion path) · auth: Self / `@RequirePermission(…)`, or `@Public()` with a reason · success status · request/query/response DTOs · every failure → `ErrorCode` + status · side effects · breaking or not.

## 1. Contract — `openapi/openapi.yaml`

Write the operation first: path, `operationId`, parameters, request body, every response status
with schema, headers and `x-error-codes`, security. `npm run openapi:lint`.

## 1b. DTOs — `modules/<m>/dto/`

- One file per DTO: `create-<x>.dto.ts`, `list-<x>-query.dto.ts`, `<x>-response.dto.ts`.
- zod schema + `createZodDto`. `.trim()` strings, `.max()` every string and array, enums as lower_snake unions, dates as ISO strings.
- List queries extend the shared `CursorPaginationQueryDto` (`cursor`, `limit` default 20, max 100) with a per-endpoint `sort` whitelist; responses are `{ items, nextCursor }`.
- Decide optional vs nullable per field; the response schema lists every field the mapper emits, no more.
- Reuse an existing schema instead of copying it (`.pick()` / `.extend()`).

## 2. Error codes — `common/errors/error-code.ts`

- Reuse a code if the meaning is identical; else add `<DOMAIN>_<REASON>`.
- Add the message to **every** locale catalogue (`13-i18n`).
- Unique constraint that can fire → map the constraint name to the code in the filter's table.

## 3. Repository — `<m>.repository.ts`

- The only place touching the ORM. Select explicit fields/relations; no N+1 (`include`/`relations` or one batched query).
- Scope queries by owner where the rule is "only yours" (`where: { id, ownerId }`) — defence in depth, the service still decides.
- Lists: keyset pagination with `take: limit + 1` (`common/pagination`); order by a whitelisted column plus `id` as tiebreak, backed by a `(column, id)` index.
- Accept an optional transaction client (`07-database-*` → Transactions).
- New filter/sort column → index → `db-migration`.

## 4. Service — `<m>.service.ts`

- Load the resource, then check ownership/role; not yours → `AppException(…_NOT_FOUND, 404)` (or 403 where existence is not secret — follow the module's existing choice).
- Enforce state transitions (illegal → 409).
- More than one write → one transaction here; outbox event inside the same transaction; never send mail inline.
- Other modules only through their exported service.
- Return domain types, not DTOs.

## 5. Mapper — `<m>.mapper.ts`

Pure function domain → response DTO. No I/O. Never spread the entity (`...row`) — list fields.

## 6. Controller — `<m>.controller.ts`

```ts
@Post(":id/publish")
@RequirePermission("users", "update")
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: "Publish an assignment" })
@ZodSerializerDto(AssignmentResponseDto)
async publish(@CurrentUser() user: AuthUser, @Param() { id }: IdParamDto) {
  return toAssignmentResponse(await this.assignments.publish(user, id));
}
```

One service call, then the mapper. No `try/catch`, no ORM, no `@Req()`/`@Res()` unless setting cookies. Rate-limit (`@Throttle`) auth, OTP and anything that sends mail.

## 7. Tests

Unit (`<m>.service.spec.ts`): each business rule and state transition.

E2E (`test/<m>/<name>.e2e-spec.ts`, real DB) — the matrix:

| Case | Expect |
| --- | --- |
| happy path | status, body shape, DB row |
| each invalid field | 400 `VALIDATION_FAILED`, `context.fields[].path` |
| no auth | 401 |
| unsafe method without CSRF header | 403 `CSRF_INVALID` |
| other user's id | 404/403, DB unchanged |
| no permission | 403 `AUTH_FORBIDDEN` |
| each code in the operation's `x-error-codes` | its status + `code` |
| list limits | default, max, 101 → 400, `nextCursor` walk to the end, tampered cursor → 400, empty page |
| side effect | outbox row / Mailpit message / stored object |
| `X-Locale` | `detail` in each locale |

## 8. Verify

`npm run lint && npm run typecheck && npm run test && npm run build && npm run test:e2e`, with the contract helper on every request and the route-inventory spec green; the operation in `openapi/openapi.yaml` lists every status and error code the tests reach. List the endpoint under "Contract changes" in the PR.

## Red flags

- A response built with `...entity`
- A service method taking an id without a caller to check it against
- An error code with a message in one locale only
- A list endpoint without `limit`
