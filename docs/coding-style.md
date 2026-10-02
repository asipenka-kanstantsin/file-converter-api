# Coding Style Documentation

## General

The project follows strict and predictable coding conventions.

The main goals:

- readability
- consistency
- maintainability
- easy navigation

Prefer clear code over clever code.

---

# TypeScript Style

## Strict Mode

Strict mode with `noUncheckedIndexedAccess` is always on. Do not bypass compiler checks.

Never use:

- `any`
- `@ts-ignore`, `@ts-nocheck`
- `as` casts of external data (request, DB JSON, third-party responses, env)
- non-null `!` on external data

External data is parsed with zod; its type is `z.infer` of the schema.

---

## Types

Explicit types for:

- exported functions and service methods (return types)
- public module APIs
- DTOs (inferred from zod)

Prefer inferred types for locals. Status and role values are string unions or enums.

`interface` for object shapes that describe contracts (ports, domain types); `type` for unions and
`z.infer` results.

---

## Exports

Named exports only.

```ts
export class UsersService {}
```

Other modules import a module's `index.ts`, never its internal files.

---

## Imports

Absolute imports through `@/`.

```ts
import { AppException, ErrorCode } from "@/common/errors";
import { UsersService } from "@/modules/users";
```

Relative imports only within the same module folder. Order and grouping per `22-imports.mdc`
(enforced by perfectionist).

---

# NestJS Style

## Classes and Injection

- dependencies injected through the constructor as `private readonly`
- no `new` for injectables; no static mutable state
- one class per file; file named after it with its Nest suffix

```ts
@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly mapper: UsersMapper,
  ) {}
}
```

## Controllers

- one service call per handler
- no try/catch unless converting a specific error
- return the response DTO; no `@Res()` unless streaming

## Services

- one public method per use case, named by intent (`inviteMember`, `publishAssignment`)
- start the transaction here when more than one write happens
- throw `AppException(ErrorCode.X, status, context?)`

## Repositories

- the only place that uses the ORM
- methods named by query intent (`findOwned`, `listByCompany`, `countActiveByUser`)
- accept an optional transaction client; return domain types

---

# Naming

| Thing | Style | Example |
| --- | --- | --- |
| Files | kebab-case + suffix | `saved-searches.service.ts`, `create-saved-search.dto.ts` |
| Classes | PascalCase + suffix | `SavedSearchesService`, `CreateSavedSearchDto` |
| zod schemas | camelCase + `Schema` | `createSavedSearchSchema` |
| Functions / methods | camelCase verb | `createUser()`, `findOwned()` |
| Booleans | `is` / `has` / `can` | `isVerified`, `hasSeat`, `canPublish` |
| Constants | UPPER_SNAKE | `SAVED_SEARCH_LIMIT` |
| Error codes | UPPER_SNAKE, domain prefix | `SAVED_SEARCH_NOT_FOUND` |
| Tables / columns | snake_case, plural tables | `saved_searches.user_id` |
| Enum values on the wire | lower_snake | `pending_review` |
| Mail templates | `<domain>.<event>` | `auth.password-reset` |

Full rules: `21-naming.mdc`.

---

# Sorting

Object keys, interface members and imports are sorted alphabetically (perfectionist). Do not fight
the autofix.

---

# Error Handling

- never swallow errors

Bad:

```ts
try {
  await this.repository.save(row);
} catch {}
```

Good:

```ts
const user = await this.repository.findOwned(id, caller.id);
if (!user) {
  throw new AppException(ErrorCode.USER_NOT_FOUND, HttpStatus.NOT_FOUND, { userId: id });
}
```

- catch only to convert a specific, expected error; let the global filter handle the rest
- no `console.log`; use the injected logger with structured fields, no PII

---

# Async

- always `await` or return promises; no floating promises (lint rule)
- no fire-and-forget work in a request — enqueue to the outbox
- `Promise.all` for independent reads; never for writes that must be atomic

---

# Comments

Comments explain why something exists or why a decision was made.

Bad:

```ts
// find the user
const user = await this.repository.findById(id);
```

Good:

```ts
// 404 instead of 403: revealing that the assignment exists would leak another company's pipeline
```

No redundant comments, section banners, commented-out code, or JSDoc on self-explanatory members.

---

# Functions and Files

- functions do one thing, have clear names, keep side effects explicit
- files have one purpose; no dead code
- no generic helpers "for later"

---

# Formatting

Use the project Prettier and ESLint configuration. Do not manually fight formatting rules.

---

# Code Quality Checklist

- Is the responsibility clear and in the right layer?
- Is the name understandable?
- Are types correct without casts?
- Are imports clean and boundary-safe?
- Is existing code reused?
- Is every error an `AppException` with a code?

---

# AI Development

Generated code matches existing project style. Do not introduce personal preferences.

Consistency with the repository is the priority.
