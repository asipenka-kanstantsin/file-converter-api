# Environment Setup Prompt

## Role

You are a senior backend engineer configuring environments and local infrastructure.

Follow `10-config.mdc`, `11-mail.mdc`, `12-storage.mdc`, `13-i18n.mdc`, `19-security.mdc`.

---

# Task

Configure env variables, their validation, and local services so the app runs identically on every
developer machine and in CI, and fails fast when misconfigured in any environment.

---

# Rules

- `process.env` is read **only** in `src/config`; everything else injects `AppConfig`
- every variable is in the zod schema, in `.env.example`, and described below
- secrets have no default; non-secrets may have a documented dev default
- invalid or missing env → the process exits at startup listing the failing keys
- `.env` is never committed; `.env.example` has safe placeholders only
- production secrets come from the deployment's secret store, not files in the image

---

# Local services — `docker-compose.yml`

The committed `docker-compose.yml` is the source: `postgres:18-alpine` (volume on
`/var/lib/postgresql`, init scripts in `docker/postgres/init` create `app_test` and the
`app_readonly` role), `axllent/mailpit` (SMTP `:1025`, UI/API `:8025`), `chrislusf/seaweedfs` as the
S3 API on `:8333` (credentials in `docker/seaweedfs/s3.json`), and `s3-init` (`amazon/aws-cli`)
creating buckets `app-dev` and `app-test`. MinIO is not used: its public images were withdrawn.

(Init scripts run only on an empty volume; `docker compose down -v` to re-run locally.)

# `.env.example`

```dotenv
# App
NODE_ENV=development
APP_PORT=3001
APP_FRONTEND_URL=http://localhost:3000
APP_CORS_ORIGINS=http://localhost:3000
APP_TRUST_PROXY=0
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://app:app@localhost:5432/app

# Auth
AUTH_JWT_SECRET=change-me-32-chars-minimum-xxxxxxxx
AUTH_OTP_PEPPER=change-me-32-chars-minimum-xxxxxxxx
AUTH_ACCESS_TTL_SECONDS=900
AUTH_REFRESH_TTL_SECONDS=2592000
AUTH_COOKIE_SECURE=false
AUTH_COOKIE_DOMAIN=

# Mail (Mailpit in dev)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM="Product <no-reply@mail.example.com>"

# Storage
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:8333
S3_REGION=us-east-1
S3_BUCKET=app-dev
S3_ACCESS_KEY_ID=s3-access-key
S3_SECRET_ACCESS_KEY=s3-secret-key
S3_FORCE_PATH_STYLE=true
STORAGE_LOCAL_DIR=./var/storage
STORAGE_LOCAL_SECRET=change-me-32-chars-minimum-xxxxxxxx
FIREBASE_PROJECT_ID=
FIREBASE_STORAGE_BUCKET=
FIREBASE_CREDENTIALS_JSON=

# Locale
DEFAULT_LOCALE=en
SUPPORTED_LOCALES=en

# Jobs
JOBS_ENABLED=true
WORKER=false
```

| Variable | Secret | Notes |
| --- | --- | --- |
| `NODE_ENV` | no | read only inside `src/config` to pick non-secret defaults |
| `APP_PORT` | no | HTTP port of the API |
| `APP_FRONTEND_URL` | no | public frontend URL; base for links in mail. Never derived from the request `Host` |
| `APP_CORS_ORIGINS` | no | comma-separated allow-list; parsed to an array; no `*` |
| `APP_TRUST_PROXY` | no | number of proxy hops to trust for client IP (rate limits) |
| `LOG_LEVEL` | no | `debug` \| `info` \| `warn` \| `error`; `info` in prod |
| `DATABASE_URL` | yes | Postgres connection string; `?sslmode=require` in shared envs |
| `AUTH_JWT_SECRET` / `AUTH_OTP_PEPPER` | yes | ≥ 32 chars, no default |
| `AUTH_ACCESS_TTL_SECONDS` / `AUTH_REFRESH_TTL_SECONDS` | no | 900 / 2592000 by default |
| `AUTH_COOKIE_SECURE` | no | `false` only on plain-http localhost |
| `AUTH_COOKIE_DOMAIN` | no | cookie `Domain`; empty = host-only |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | no | 587 + `false` (STARTTLS) or 465 + `true` |
| `SMTP_USER` / `SMTP_PASS` | yes | empty for Mailpit; required in production |
| `MAIL_FROM` | no | sender on a domain you control |
| `STORAGE_DRIVER` | no | `s3` \| `local`; the schema requires the matching group below |
| `S3_*` | key/secret yes | SeaweedFS locally; `S3_FORCE_PATH_STYLE=true` |
| `STORAGE_LOCAL_DIR` / `STORAGE_LOCAL_SECRET` | secret yes | only for `local`; refused in production |
| `FIREBASE_*` | credentials yes | `FIREBASE_CREDENTIALS_JSON` is the service-account JSON (or base64 of it) |
| `DEFAULT_LOCALE` | no | must be in `SUPPORTED_LOCALES` |
| `SUPPORTED_LOCALES` | no | comma-separated; each needs error and mail catalogues |
| `JOBS_ENABLED` / `WORKER` | no | outbox dispatcher and schedules on/off; `WORKER=true` runs the worker-only process (`20-jobs`) |

Use a zod `discriminatedUnion` on `STORAGE_DRIVER` so a missing `S3_BUCKET` with `s3` fails at
startup, and `superRefine` for cross-field rules (default locale in supported list, production
requires SMTP auth and `sslmode`).

---

# Environments

| Env | Database | Mail | Storage |
| --- | --- | --- | --- |
| local | compose Postgres | Mailpit | SeaweedFS S3 or `local` |
| test / CI | compose/CI Postgres, `app_test` | Mailpit | SeaweedFS S3 or `local` in a temp dir |
| dev / staging | managed Postgres | real SMTP to test inboxes, or Mailpit | S3 bucket per env |
| production | managed Postgres | SMTP provider (turboSMTP) | S3, private |

---

# Output Format

## Files

`docker-compose.yml`, `docker/postgres/init/*`, `.env.example`, `src/config/*`.

## Variables

Name, secret yes/no, default, validation.

## Security Notes

## Validation

How a bad env is rejected; the command that proves the stack runs
(`docker compose up -d && npm run db:migrate && npm run start:dev`).
