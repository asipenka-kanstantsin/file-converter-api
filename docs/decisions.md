# Project decisions

The requirements live in Notion (`requirements-check` → `docs/requirements/`) and **Notion has the
highest priority** — over this file and over every kit rule. The spec leaves points open ("выбрать
один подход", "требует фиксации", "опционально"); this file records how each open point is resolved
and what the mentor agreed. A decision may only fill a gap Notion leaves; it never contradicts a
Notion page.

Status: `proposed` — our choice, not yet reviewed by the mentor · `agreed` — confirmed by the
mentor (date) · `rejected` — do not build.

## Task ids

Branches use `<type>/<TASK-ID>_<short_description>` (`16-git.mdc`). Ids map to Notion pages:

| Id | Notion page | Section review |
| --- | --- | --- |
| FC-0 | Нефункциональные требования + foundation (config, DB, errors, logging, health, Swagger) | — |
| FC-1 | Регистрация | users |
| FC-2 | Аутентификация | users |
| FC-3 | Авторизация | users |
| FC-4 | RBAC | users |
| FC-5 | Просмотр данных пользователя | users |
| FC-6 | Изменение данных пользователя | users |
| FC-7 | Удаление пользователя | users |
| FC-8 | Просмотр списка всех пользователей | users → **mentor review** |
| FC-9 | Общие требования к трансформации файлов | transformations |
| FC-10 | Трансформация текстовых форматов | transformations |
| FC-11 | Трансформация изображений | transformations |
| FC-12 | Просмотр истории трансформаций | transformations |
| FC-13 | Сохранение результатов трансформаций в хранилище | transformations → **mentor review** |

## Stack

| # | Decision | Status |
| --- | --- | --- |
| S1 | NestJS 11, Prisma 7 + PostgreSQL 18, zod 4 via `nestjs-zod`, nodemailer (Mailpit in dev, turboSMTP-compatible in prod), storage behind `StoragePort` with `local` and `s3` drivers; locally the S3 API is SeaweedFS (MinIO withdrew its public images). No Firebase driver. | proposed |
| S2 | Validation uses zod. Notion contradicts itself (NFR: class-validator; recommendations: "zod, joi или аналог"); the owner chose zod. Mentor to confirm. | agreed with the owner 2026-10-02 |

## HTTP contract

| # | Decision | Status |
| --- | --- | --- |
| H1 | Global prefix `/api` on every route; only the monitoring endpoints `/health`, `/health/live`, `/health/ready` (named so by the Notion NFR page) stay outside. Below the prefix, the Notion paths: `/api/auth/*` (magic link `/api/auth/confirm?token=`), `/api/users/{userId}…`, `/api/admin/users`, `/api/admin/rbac/*`, `/api/convert`, `/api/images/convert`, `/api/transformations/history…`, `/api/admin/users/{userId}/transformations/history…`; the contract at `/api/openapi.yaml`. | agreed with the owner 2026-10-02 |
| H2 | Lists use **cursor** pagination as the Notion pages require: `?cursor=&limit=` → `{ items, nextCursor }`, `limit` default 20, max 100. The cursor is an opaque base64url of the sort key + id. No offset pagination anywhere. | proposed |
| H3 | Validation failures return **400** `VALIDATION_FAILED` (the Notion contracts list 400 for bad input, not 422). | proposed |
| H4 | Error envelope `{ code, detail, context }` from the kit; `detail` in English only, from a typed message map (no i18n library until a second locale is needed — Notion requires none). | proposed |
| H5 | The admin list is `GET /api/admin/users` (Notion: it or `GET /api/users` with the admin right — choose one). | proposed |
| H6 | Admin changes e-mail through the common `PATCH /api/users/{userId}`; no separate `/email` route (Notion: choose one). | proposed |
| H7 | User deletion is `DELETE /api/users/{userId}` and runs synchronously (204); no job/status endpoint (Notion: sync or queue — choose). Self-delete first requires an e-mail confirmation (Notion: mandatory): `DELETE` by Self returns 202 + `challengeId`, `POST /api/users/{userId}/delete/confirm` finishes it. Admin deletes directly. | proposed |
| H8 | API documentation is a hand-written OpenAPI 3.1 contract `openapi/openapi.yaml` (contract-first), served at `/api/openapi.yaml`; no Swagger tooling. Meets the NFR "OpenAPI (Swagger) — актуальная документация"; currency is enforced by contract tests. | agreed with the owner 2026-10-02 |

## Auth

| # | Decision | Status |
| --- | --- | --- |
| A1 | Both tokens are **JWTs** in HttpOnly cookies `access_token` (15 min) and `refresh_token` (30 days). Refresh rotates: every refresh issues a new pair. **Nothing about refresh tokens is stored server-side** (no table, no `jti`, no family) — this replaces the kit's opaque refresh tokens and reuse detection, which the Notion page forbids. | proposed |
| A2 | Server-side invalidation without storing refresh tokens: every JWT carries the user's `tokenVersion`; deleting a user, resetting a password or an admin block increments it, and both guards reject tokens whose version or user status no longer matches. This is a per-user counter, not refresh-token storage — to confirm with the mentor (the "Удаление" page requires revoking sessions, the "Авторизация" page forbids storing refresh state). Logout only clears cookies. | proposed |
| A3 | CSRF double-submit (`csrf_token` cookie + `X-CSRF-Token`) from the kit stays: Notion asks for XSS/CSRF protection through cookie settings; this is stronger and costs nothing. | proposed |
| A4 | E-mail confirmation is one generic `challenges` table for every purpose (`registration`, `login`, `password_reset`, `email_change`, `account_deletion`). Each challenge supports both methods: a 6-digit OTP and a magic-link token (both stored hashed). Response carries `challengeId`; OTP: TTL 10 min, 5 attempts, resend ≥ 60 s. Magic link: `GET /api/auth/confirm?token=…`. | proposed |
| A5 | Registration with confirmation enabled creates the user in status `pending_verification` (not a separate pending-registration table). | proposed |
| A6 | Confirmation flags per scenario (registration, password reset, login) are runtime settings in the `app_settings` table, edited by an admin through `GET/PATCH /api/admin/settings`. Defaults: all off. | proposed |
| A7 | Account enumeration: registration of an existing e-mail answers 409 `USER_EMAIL_TAKEN` (the Notion page lists "Email уже зарегистрирован" as an error; the neutral variant is optional). Login always answers one `AUTH_INVALID_CREDENTIALS`. | proposed |
| A8 | Password policy: 8–128 characters, at least one letter and one digit. Hash: argon2id. | proposed |
| A9 | Registration without confirmation answers 201 `{ user }` and issues **no** tokens; the user logs in (FC-2). Notion makes tokens on registration optional ("если предусмотрено"). | proposed |
| A10 | Resend (`POST /api/auth/confirm/resend`) rotates the code and the link of the **same** challenge, resets the attempt counter and the 10-minute expiry; allowed once per 60 s (429 `RATE_LIMITED` + `Retry-After`). A locked challenge (5 wrong codes) is unlocked only by a resend. | proposed |
| A11 | The confirmation flags are changed through `GET/PATCH /api/admin/settings` (permission `settings@manage`, FC-4). PATCH takes only the given keys and refuses unknown ones; each change is logged with the actor. | proposed |
| A12 | Rate limits: global 100/min; `mail` group (register, resend) 3/min; `confirm` group 10/min — per IP **and per route** (POST and GET confirm count separately), configurable (`THROTTLE_*`). Named groups add `-mail` / `-confirm` suffixed `X-RateLimit-*` / `Retry-After` headers; `Retry-After` itself is always set on 429. Attempt and resend limits on a challenge are enforced in the database, independent of the per-IP limiter. | proposed |
| A13 | A `pending_verification` account older than the confirmation window (10 min since registration) **and without a live challenge** (a resend extends it) is deleted when someone registers the same e-mail again, so nobody can squat an address. Inside the window a second registration answers 409; the owner uses resend. | proposed |
| A14 | The magic link is a state-changing `GET /api/auth/confirm?token=` because Notion gives that form. Risk: mail scanners that prefetch links confirm a **registration** (acceptable: it only proves mailbox access). For sign-ins see A17. | proposed |
| A15 | Brute-force protection on sign-in (Notion 1.6 "rate limit, lockout"): `LoginLockout` counts only **failed** sign-ins per client IP + normalised e-mail; 5 failures within 60 s (`THROTTLE_LOGIN_LIMIT`, `THROTTLE_TTL_SECONDS`) block that pair for 15 min (`THROTTLE_LOGIN_BLOCK_SECONDS`) → 429 + `Retry-After`; a successful sign-in resets the count. Unknown e-mails are counted exactly like known ones (no enumeration); another client cannot lock the owner out. Accepted risk: a distributed attack on one account (many IPs) is limited only by the per-IP global limit. Each attempt reserves a slot while it runs, so more than 5 simultaneous sign-ins for one pair (e.g. many tabs) get a short 429 even without failures. Single-instance memory. | proposed |
| A16 | Wrong e-mail and wrong password answer one 401 `AUTH_INVALID_CREDENTIALS` with the same timing (argon2 verify against a dummy hash). A correct password on an unconfirmed registration answers 403 `AUTH_ACCOUNT_NOT_VERIFIED` (the caller already proved the password). | proposed |
| A17 | Confirming a sign-in (code or link) sets the session cookies — Notion 1.3.2 "выдать токены". Login CSRF guard: the 202 of `POST /api/auth/login` sets an HttpOnly `login_challenge` cookie (`Path=/api/auth/confirm`), and the sign-in link signs in only in a browser holding that cookie (else 403 `AUTH_CHALLENGE_OTHER_BROWSER`). So an attacker cannot push their session into a victim's browser, and a prefetching scanner gets no session. The 6-digit code works from any device (POST, CSRF-protected). A sign-in challenge records the user's `token_version`; a bump before confirmation voids it. A new sign-in voids the user's earlier pending sign-ins. | proposed |
| A18 | JWTs: HS256, separate access/refresh secrets (refused equal in production), `iss=file-converter-api`, `aud=file-converter`, claims `sub`, `typ`, `ver`. Successful sign-in stores `users.last_login_at` (used by the admin list, FC-8). | proposed |
| A19 | Authentication is **deny by default**: a global `JwtAuthGuard` (after throttling and CSRF) requires a valid `access_token` cookie on every route; `/health*`, the OpenAPI document and `/api/auth/*` opt out with `@Public()`. Every failure (missing, tampered, expired, wrong type, user gone, not active, `ver` ≠ `token_version`) answers one 401 `AUTH_UNAUTHENTICATED`; the precise reason is logged without the token (Notion "Авторизация" 1.4–1.5). The cookie's Max-Age equals the token TTL, so an expired access token usually just arrives as no cookie — one code is enough: the client refreshes on any 401. A contract test checks the 401 against the `accessCookie` security requirement for every route. | proposed |
| A20 | `GET /api/me` returns the signed-in user. Not on a Notion page; it fills a gap: after a reload the client has only HttpOnly cookies and no other way to learn its own user id for `/api/users/{userId}` (FC-5). | proposed |
| A21 | `POST /api/auth/refresh` answers 204 with a new pair (CSRF-protected like every POST). It checks the refresh JWT (signature with the refresh secret, `exp`, `iss`, `aud`, `typ`) and, per A2, that the user still exists, is active and has the same `token_version` — a check on the user, not on refresh-token state, which Notion forbids storing. Any failure → 401 `AUTH_REFRESH_INVALID` and both session cookies cleared. An earlier refresh token stays valid until it expires (no storage, so no reuse detection — accepted by Notion 1.1). `POST /api/auth/logout` is public (it must work with an expired access token), clears `access_token`, `refresh_token` and `login_challenge`, 204, and does not bump `token_version` (that would sign out every device). Refresh has no group of its own: the global 100/min per IP applies (each call costs one indexed query and two HMAC signatures). A refresh that fails with a server error leaves the cookies alone. The user checks depend on A2 being confirmed by the mentor. | proposed |

## RBAC

| # | Decision | Status |
| --- | --- | --- |
| R1 | Roles, permissions (`name` + allowed `actions`) and grants (role → permission → optional subset of actions) live in the DB, are loaded into an in-memory cache at startup and reloaded after every admin change. Single instance, so the cache needs no cross-process invalidation. | proposed |
| R2 | Routes declare `@RequirePermission("<permission>", "<action>")`; a global `PermissionGuard` replaces the kit's `RolesGuard` / `@Roles()`. Ownership (Self) is still decided in the service. | proposed |
| R3 | Built-in roles: `admin`, `user` (implicit, R5). Built-in permissions: `users` [`read`, `update`, `delete`, `list`], `transformations` [`history`, `download`], `rbac` [`manage`], `settings` [`manage`]. A built-in permission created at startup is granted to `admin` with every action; apart from `admin → rbac` (R6) these admin grants can later be narrowed or removed. If the code drops an action from a built-in permission, startup strips it from grants (a grant left with none is deleted, as empty would mean "all"). | proposed |
| R4 | Deleting a role still held by grants or users, or a permission still referenced by grants → 409 `RBAC_IN_USE` (Notion: "нельзя удалить ... или каскадно — требует решения"; no cascade), enforced by `ON DELETE RESTRICT`. Removing an action from a permission while a grant lists it → 409 `RBAC_ACTION_IN_USE`; a grant's actions must be actions of its permission → 400 `RBAC_ACTION_NOT_ALLOWED`. | proposed |
| R5 | The `user` role is **implicit**: every account holds it, it is never stored in `user_roles` and cannot be assigned. Grants on it apply to every signed-in user. So registration writes no role row and existing accounts need no backfill. | proposed |
| R6 | Guard rails, so the configuration cannot lock admins out: the permissions the code checks (`PERMISSIONS` in `require-permission.decorator.ts`) are created at startup if missing and are read-only through the API (`system: true`); the built-in roles cannot be renamed or deleted; the grant `admin → rbac` (all actions) is restored at startup and cannot be changed or deleted; `rbac` cannot be granted to the implicit `user` role (it would make every account an admin); only `active` accounts can hold roles (409 `USER_NOT_ACTIVE`), and the last **active** holder of `admin` cannot lose it — the admin role row is locked while user roles change. → 409 `RBAC_SYSTEM_ENTITY` / `RBAC_LAST_ADMIN`. **FC-7 must apply the same last-admin check (under the same lock) when deleting a user.** Every admin write locks the rows it depends on first, so concurrent changes wait rather than fail; a missing row is 404, never 500. | proposed |
| R7 | The first admin: register and confirm normally, then on the server `npm run admin:grant -- <email>` (idempotent; refuses an unconfirmed account). No admin credentials in env or seed data. The running server needs no restart: user roles are read on every request. | proposed |
| R8 | `GET/PUT /api/admin/users/{userId}/roles` (permission `rbac@manage`) lists and replaces a user's explicit roles. Notion makes a user "носитель одной или нескольких ролей" but defines no endpoint; this fills the gap. Roles are read from the DB on every request, so a change applies on the user's next request without re-login. | proposed |
| R9 | RBAC lists (`/api/admin/rbac/roles|permissions|grants`) return every item `{ items }` without pagination: configuration, not data, and Notion asks for a plain list (an exception to H2). Responses wrap single items as `{ role }`, `{ permission }`, `{ grant }`; POST 201, PUT 200 (full replace), DELETE 204. A 403 from `PermissionGuard` logs `actorUserId`, permission, action; every admin change logs actor, operation, entity, result, and each cache reload is logged (Notion 1.5). A reload that fails after a committed change is logged and retried, not turned into a 500. | proposed |

## User profiles

| # | Decision | Status |
| --- | --- | --- |
| P1 | Profile = `{ id, email, photo, fields }` (Notion minimum). Profile fields so far: `displayName` (optional, ≤ 100 chars), `status`, `createdAt`, `lastLoginAt`. Visibility (default-deny, `profile.policy.ts`): own profile `createdAt`, `displayName`, `lastLoginAt`, `status`; another user's (with `users@read`) `createdAt`, `displayName`, `status`. `photo` is an API path or `null` (F4); always `null` until photo upload arrives with FC-6. Responses carrying a profile are `Cache-Control: no-store`. | proposed |
| P2 | Without `users@read`, a foreign `userId` answers 403 whether the account exists or not (no enumeration; IDOR refused before the lookup). With it, a missing account is 404. Profile reads are rate-limited per IP in the `profile` group, 60/min (`THROTTLE_PROFILE_LIMIT`, Notion 1.4). Each view logs `viewerUserId`, `targetUserId`, result (1.5). A malformed `userId` answers 400 `VALIDATION_FAILED` like every other id parameter (H3); ids are canonicalised to lowercase before any comparison. | proposed |
| P3 | `/api/users/{userId}…` lives in an `accounts` module that depends on `users` and `rbac`, so neither of those depends on the other. | proposed |
| P4 | Profile photo (Notion lists "фото" but no upload contract): `PUT /api/users/{userId}/photo` (multipart `file`), `GET` (streamed, `Cache-Control: private, no-store`), `DELETE` (idempotent, 204). Self, or `users@update` to change / `users@read` to see. PNG or JPEG detected from the content (415 `FILE_TYPE_NOT_SUPPORTED` otherwise), ≤ 5 MB (413 `FILE_TOO_LARGE` + `context.maxBytes`, cut off while streaming), re-encoded with sharp (EXIF/GPS and trailing data dropped) and scaled to fit 1024×1024. Stored as a private `files` row + object (`avatar/<userId>/<uuid>`); a replaced or removed photo's row goes in the transaction, its object through the outbox (`storage.delete`). A missing file in a multipart request is 400 `MALFORMED_REQUEST`. | proposed |
| P5 | `PATCH /api/users/{userId}` (Notion 1.3.1/1.3.4, H6): body keys `displayName` (1–100 chars, `null` clears), `email`, `status` (`active` \| `blocked`); unknown keys → 400. Self without `users@update` may send `displayName` only — any other known key → 403 `AUTH_FORBIDDEN` with `context.fields`. With `users@update` every key, `email` directly (409 `USER_EMAIL_TAKEN` if taken). One transaction; the audit log has actor, target, field **names** and result. | proposed |
| P6 | New status `blocked` (Notion's admin list filters by it): set by `PATCH … status`, ends every session (`token_version` + 1, A2), sign-in then answers 403 `AUTH_ACCOUNT_BLOCKED`; refused for the last active admin (R6). `active` unblocks (and may also activate a pending account by hand). | proposed |
| P7 | Changing the `email` or `status` of an account whose roles hold `rbac@manage` requires `rbac@manage` from the actor (else 403): `users@update` alone (e.g. a support role) must not be able to take over or lock out an administrator — the e-mail is how an account is recovered. `displayName` and photos stay with `users@update`. | proposed |
| P8 | Writes to one account lock its row `FOR UPDATE` (a shared lock upgraded by the UPDATE deadlocks against a concurrent one); lock order everywhere: admin role → user → other roles → permission. Photo uploads: the object is put first, then its `files` row, the link and the old photo's removal commit in one transaction; any failure after the put removes the object (`FilesService.storeWithin`). A storage failure is 500 `STORAGE_UNAVAILABLE`; a stream failure before the first byte answers that envelope, after it aborts the connection (never a truncated 200, never the raw error). Photo uploads have their own rate limit group `upload`, 10/min (`THROTTLE_UPLOAD_LIMIT`). | proposed |
| E1 | E-mail change (Notion 1.3.2–1.3.3): `POST /api/users/{userId}/email-change` `{ newEmail }` (Self only, `mail` rate limit) → **200** `{ requiresConfirmation, challengeId, expiresAt }` as Notion specifies; a challenge `email_change` holds the new address, its code and link go **to the new address** (resends too). TTL 10 min, 5 attempts, resend ≥ 60 s — the A4/A10 values. A newer request voids the older; any `token_version` bump (block, password reset, deletion) voids it; an admin's direct change voids it too. Confirmed **only with the owner's session**: `POST …/email-change/confirm` with `{ challengeId, code }` or `{ token }`, or the e-mailed link `GET /api/auth/confirm?token=` opened where the owner is signed in (else 403 `AUTH_CHALLENGE_SESSION_REQUIRED`) — so a link scanner or whoever owns a mistyped address cannot move the account. `POST /api/auth/confirm` refuses it, and purpose and owner are checked before a code is compared (no attempt spent, no oracle). An abandoned registration of the address is released first (A13); a taken address → 409 at the start and at confirmation. When the e-mail changes (by the user or an admin) the previous address gets a notice without secrets. Limitation: the GET link needs a live access token (15 min); after it expired the link answers 403 and the user signs in again or enters the code — a client page that refreshes, then POSTs the token, would remove that. | proposed |

## Files and transformations

| # | Decision | Status |
| --- | --- | --- |
| F1 | Per-format input size limits and SVG raster limits are runtime settings in `app_settings` (admin-editable), with defaults: 10 MB per text format, 15 MB per image format, SVG raster max 4096×4096. History retention: 90 days. | proposed |
| F2 | Text conversion runs in worker threads (`piscina`), 30 s timeout per job; images use `sharp` (libuv pool) with `limitInputPixels`. The result is produced completely before the response starts, so an error never yields a partial file. | proposed |
| F3 | Conversion rules for ambiguous pairs are documented in `docs/conversion-rules.md` and tested. | proposed |
| F4 | Saved results and profile photos are private objects; downloads are streamed through the API after the permission check. No signed URLs are handed out. | proposed |
| F5 | Expired history rows and their files are removed by an hourly cron job. | proposed |
| F6 | A conversion that exceeds the 30 s timeout answers 400 `CONVERSION_TIMEOUT` (the Notion contracts list no 408/504) and is recorded in history as `error`. | proposed |
