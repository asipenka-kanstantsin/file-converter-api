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
| A11 | Until RBAC exists (FC-4) the confirmation flags are changed in the `app_settings` table directly; `GET/PATCH /api/admin/settings` arrives with FC-4. | proposed |
| A12 | Rate limits: global 100/min; `mail` group (register, resend) 3/min; `confirm` group 10/min — per IP **and per route** (POST and GET confirm count separately), configurable (`THROTTLE_*`). Named groups add `-mail` / `-confirm` suffixed `X-RateLimit-*` / `Retry-After` headers; `Retry-After` itself is always set on 429. Attempt and resend limits on a challenge are enforced in the database, independent of the per-IP limiter. | proposed |
| A13 | A `pending_verification` account older than the confirmation window (10 min since registration) **and without a live challenge** (a resend extends it) is deleted when someone registers the same e-mail again, so nobody can squat an address. Inside the window a second registration answers 409; the owner uses resend. | proposed |
| A14 | The magic link is a state-changing `GET /api/auth/confirm?token=` because Notion gives that form. Risk: mail scanners that prefetch links confirm the registration; acceptable for registration (it only proves mailbox access). Login confirmation (FC-2) must not issue session cookies from this GET — to decide there. | proposed |

## RBAC

| # | Decision | Status |
| --- | --- | --- |
| R1 | Roles, permissions (`name` + allowed `actions`) and grants (role → permission → optional subset of actions) live in the DB, are loaded into an in-memory cache at startup and reloaded after every admin change. Single instance, so the cache needs no cross-process invalidation. | proposed |
| R2 | Routes declare `@RequirePermission("<permission>", "<action>")`; a global `PermissionGuard` replaces the kit's `RolesGuard` / `@Roles()`. Ownership (Self) is still decided in the service. | proposed |
| R3 | Seeded roles: `admin` (all), `user` (none — Self access needs no permission). Seeded permissions: `users` [`read`, `update`, `delete`, `list`], `transformations` [`history`, `download`], `rbac` [`manage`], `settings` [`manage`]. | proposed |
| R4 | Deleting a role or permission that has grants → 409 (no cascade). | proposed |

## Files and transformations

| # | Decision | Status |
| --- | --- | --- |
| F1 | Per-format input size limits and SVG raster limits are runtime settings in `app_settings` (admin-editable), with defaults: 10 MB per text format, 15 MB per image format, SVG raster max 4096×4096. History retention: 90 days. | proposed |
| F2 | Text conversion runs in worker threads (`piscina`), 30 s timeout per job; images use `sharp` (libuv pool) with `limitInputPixels`. The result is produced completely before the response starts, so an error never yields a partial file. | proposed |
| F3 | Conversion rules for ambiguous pairs are documented in `docs/conversion-rules.md` and tested. | proposed |
| F4 | Saved results and profile photos are private objects; downloads are streamed through the API after the permission check. No signed URLs are handed out. | proposed |
| F5 | Expired history rows and their files are removed by an hourly cron job. | proposed |
| F6 | A conversion that exceeds the 30 s timeout answers 400 `CONVERSION_TIMEOUT` (the Notion contracts list no 408/504) and is recorded in history as `error`. | proposed |
