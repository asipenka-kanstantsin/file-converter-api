# File Converter API

Back End for the Innowise training "[A] Обучение Back End для Front End разработчиков": convert
files between CSV, JSON, XML and YAML and images between PNG, JPEG and SVG, with user accounts,
e-mail confirmation, DB-driven RBAC, conversion history and saved results.

NestJS 11 · TypeScript strict · PostgreSQL 18 · Prisma 7 · zod 4 · contract-first OpenAPI 3.1.

## Run locally

Requirements: Node.js 24 (`.nvmrc`), Docker.

```bash
npm ci                    # also generates the Prisma client
cp .env.example .env
docker compose up -d      # Postgres 18, Mailpit (UI :8025), SeaweedFS S3 (:8333)
npm run db:migrate
npm run start:dev         # http://localhost:3001
```

- Health: `GET /health`, `/health/live`, `/health/ready`
- Contract: `GET /api/openapi.yaml` (source: [`openapi/openapi.yaml`](openapi/openapi.yaml))

The credentials in `docker-compose.yml`, `docker/`, `.env.example` and `.env.test` (`app:app`,
`readonly`, `s3-secret-key`) are throwaway values for local containers only.

## Quality gate

```bash
npm run verify   # format, lint, typecheck, OpenAPI lint, unit + e2e tests with ≥ 80 % coverage, build
```

e2e tests need the compose Postgres (`app_test` database). Every e2e response is validated against
`openapi/openapi.yaml`, and a route-inventory test keeps routes and the spec in sync.

## Where things are

| Path | What |
| --- | --- |
| `openapi/openapi.yaml` | The HTTP contract — written before the code |
| `docs/decisions.md` | How the open points of the Notion spec were resolved; task ids FC-0…FC-13 |
| `docs/requirements/` | Notion export (`npm run requirements:fetch`), git-ignored — confidential |
| `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.claude/` | Rules and workflows for AI agents and humans |
