## Summary

<!-- What was done and why -->

## Task

<!-- FC-n task id and the Notion page title + version (never paste the spec text: it is confidential) -->

## Changes

<!-- Main changes by module -->

## Contract changes

<!-- Endpoints added / changed / removed; request or response fields; statuses; error codes.
     Mark each as breaking or non-breaking. Write "None" if none. -->

## Schema changes / migrations

<!-- Migration files; tables, columns, indexes, constraints; backfills; reversible or not;
     deploy-order notes (expand → migrate → contract). Write "None" if none. -->

## Test plan

- [ ] Format check passes (`npm run format:check`)
- [ ] Lint passes (`npm run lint`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] Unit tests pass with coverage (`npm run test:cov`)
- [ ] Build succeeds (`npm run build`)
- [ ] e2e suite passes against Postgres (`npm run test:e2e`)
- [ ] Migrations apply on a database migrated from `main` (`npm run db:migrate`)
- [ ] `acceptance-check` QA report: ACCEPTED

## Checklist

- [ ] Branch is rebased on `origin/main`
- [ ] No temporary or debug code
- [ ] No applied migration was edited
- [ ] `openapi/openapi.yaml` updated first; `npm run openapi:lint` and contract tests green
- [ ] New error codes and mail keys added to every locale
- [ ] Auth and ownership checks on every new route; `@Public()` justified
- [ ] Mail and external calls go through the outbox
- [ ] No PII, secrets, tokens or OTPs in logs, errors or responses
- [ ] Module boundaries respected (no cross-module deep imports)
