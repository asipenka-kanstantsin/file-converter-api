# Create Endpoint Prompt

## Role

You are a senior backend engineer adding one HTTP endpoint whose OpenAPI entry is the contract the
frontend builds against.

Follow `05-api-design.mdc`, `06-validation.mdc`, `08-errors.mdc`, `09-auth.mdc`,
`.cursor/workflows/api-endpoint.md`.

---

## Inputs

- the AC item(s) the endpoint serves
- owning module
- method + path, or the action it performs

---

## Step 1 — Write the contract first

```
<METHOD> /api/<path>
Summary:  <one line>
Auth:     roles <…> | @Public() ; CSRF: yes (unsafe + cookie) | no ; throttle: <n>/<ttl>
Params:   id: uuid
Query:    cursor, limit, sort (whitelist), <filters>
Body:     <field: type, limits>
Success:  <status> <ResponseDto>
Errors:   <status> <CODE> <context shape>
Ownership: <rule>
Side effects: <outbox events>
```

Statuses per `05-api-design.mdc`: create 201, delete 204, queued action 202, 404 instead of 403 when
existence is itself a leak.

---

## Step 2 — Implement

```ts
@ApiTags("saved-searches")
@Controller("saved-searches")
export class SavedSearchesController {
  constructor(private readonly savedSearches: SavedSearchesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: SavedSearchResponseDto })
  `x-error-codes`(ErrorCode.SAVED_SEARCH_LIMIT_REACHED, ErrorCode.SAVED_SEARCH_NAME_TAKEN)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    return this.savedSearches.create(user, dto);
  }
}
```

Service:

```ts
async create(user: AuthUser, dto: CreateSavedSearchDto): Promise<SavedSearchResponseDto> {
  const count = await this.repository.countByUser(user.id);
  if (count >= SAVED_SEARCH_LIMIT) {
    throw new AppException(ErrorCode.SAVED_SEARCH_LIMIT_REACHED, HttpStatus.CONFLICT, {
      limit: SAVED_SEARCH_LIMIT,
    });
  }
  const row = await this.repository.create({ ...dto, userId: user.id });
  return this.mapper.toResponse(row);
}
```

- unique name → unique constraint mapped in the filter, not a pre-check alone (race)
- lists: repository returns `{ rows, total }` in one bounded query pair; controller returns
  `paginated(items, total, query)`
- reading a resource by id: the repository query includes the owner (`where: { id, userId }`) or
  the service checks it, then throws the not-found code

---

## Step 3 — Tests

e2e (`test/<domain>/*.e2e-spec.ts`), real database:

- success: status, body shape, DB row
- 401 unauthenticated; CSRF missing on unsafe method
- another user's resource → 404/403 as specified
- each error `code` in the contract, asserting `code` and `context`
- 400 on invalid body with `context.fields`
- list: pagination bounds, sort whitelist

Unit: service rules that have branches.

---

## Final Check

- [ ] `openapi/openapi.yaml` shows request, response, every status and code
- [ ] no ORM outside repository, no entity in response
- [ ] new codes in every locale
- [ ] rate limit where the endpoint sends mail or handles credentials
- [ ] contract change listed if the endpoint existed
