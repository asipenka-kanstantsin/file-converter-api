---
name: acceptance-check
description: QA / tester pass run at the END of any backend feature, edit or bugfix — after the code is written and before commit, PR or reporting done. Exercises the running API over HTTP (curl or a script with cookie jar and CSRF header) against the Notion requirements and inspects responses, database rows, mail in Mailpit, stored files and logs. Use when asked to test, QA, accept or verify an endpoint or flow. Read-only — reports verdicts and defects, never fixes.
---

# Workflow: Acceptance check (QA pass)

You are the tester now, not the author. The author's job was to make the code satisfy the AC; yours is to find out whether it does — by **observing the running API and its side effects**, not by re-reading the diff or the e2e specs.

**Read-only. Never modify source files in this pass.** A defect found here goes into the report and then to `bugfix` as a separate run. Fixing while testing destroys the record of what was observed. Test data you create (rows, mail, objects) is fine; scripts go to the scratchpad.

Before starting, read `AGENTS.md` (Self Review Before Finishing) and the knowledge files for the area (`05-api-design`, `08-errors`, `09-auth`, `11-mail`, `12-storage`, `13-i18n`, `14-logging`, `19-security` as relevant).

`requirements-check` says what the AC is; the Skeptic step of `feature` / `bugfix` / `refactor` reads the code; `doc-conformance` compares code with a supplied spec; **this pass observes behaviour against the AC**. The e2e suite is the author's test — a green `npm run test:e2e` is not a QA verdict.

## The one rule

**A check is PASSED only when it was observed.** Evidence is the HTTP status and body, a DB query result, a Mailpit message, a stored object listing, or a log excerpt — pasted or cited. Anything else is `BLOCKED`, not `PASS`. Reading the code that implements a clause is not a test result.

Run Step 0, then 1–3 in order.

---

## Step 0 — Test basis

Use `requirements-check` to pull the AC. Pull it **again** even if the implementation run already did: record the page `version` from `docs/requirements/VERSIONS.tsv` and compare — a page edited mid-task is the first finding.

Also read every time: **`docs/decisions.md`** (a `rejected` decision built anyway is critical; `proposed` rows are tested as written and listed for the mentor) and the **RBAC seed** (`prisma/seed.ts`: every role/permission that must be denied).

Scope: `git status`, `git diff --stat origin/main`. AC clauses no code in the diff touches are `NOT IN SCOPE OF THIS CHANGE`, not silent passes. Snapshot `openapi/openapi.yaml` for the endpoints in scope — Step 2 compares it against what is observed.

Return `### Test basis`: page file + version, clauses in scope, decision rows and statuses, roles/permissions, changed files, endpoints in scope.

---

## Step 1 — Test plan

Turn every clause into concrete checks before sending a request. Each check: id, AC ref, precondition (account from `docs/creds.md` + state), request, expected status + `code`/body, expected side effects, **how it will be observed**.

Cover for every endpoint in scope:

- **Happy path** — status, full body shape, and the DB row it produced.
- **Validation 400** — each constrained field: missing, wrong type, too long, out of range; `context.fields[].path` names the field.
- **Unauthenticated 401** — no cookie, expired/garbage access token; refresh behaviour if in scope.
- **CSRF** — unsafe method without `X-CSRF-Token` or with a wrong one → rejected.
- **Other user's resource (BOLA)** — user B uses user A's ids on every path/body/query id → 403 or 404 per contract, and nothing changed in the DB.
- **Role denied** — every role the matrix excludes → 403.
- **Each documented error code** — reach it deliberately; assert `code`, status, `context`.
- **Boundaries** — exact max length passes, max+1 fails; `limit` default, max 100, `limit=101`, following `nextCursor` to the last page (`nextCursor: null`), a tampered cursor → 400, empty list, one item, sort whitelist rejects unknown columns.
- **Idempotency / retries** — repeat the same request; with `Idempotency-Key` where supported; no duplicate row, no second mail.
- **Concurrency** where relevant — two parallel requests (`&` + `wait`, or `Promise.all`) on the same resource: unique constraints hold, counters are right, loser gets 409 not 500.
- **Locales** — every locale via `X-Locale` (plus missing and unsupported header → default): error `detail` and every mail subject/body translated; no raw keys.
- **Rate limits** — hit auth/OTP/mail endpoints past the limit → 429 `RATE_LIMITED` with `retryAfter`.
- **Side effects** — mail (recipient, subject, links, locale), stored objects (key, private, MIME), outbox rows processed, nothing sent when the operation failed.
- **Logs** — no password, token, OTP, full email or file content in the request's log lines.
- **Irreversible actions** — identify them (payment, hard delete, account closure, webhooks) and decide before sending; use a throwaway account.

Return `### Test plan` as a table. Name checks that need an account or state you do not have — a Step 2 problem, not a reason to drop them.

---

## Step 2 — Execution

### Environment

```bash
docker compose up -d        # Postgres, Mailpit (:8025), S3 / SeaweedFS (:8333)
npm run db:migrate && npm run start:dev    # API on http://localhost:3001
```

`npm run lint` and `npm run typecheck` first — cheap, and proof of compiling only.

### HTTP mechanics

`csrf_token` comes from `GET /api/auth/csrf` (`09-auth`); send it back as `X-CSRF-Token` on every unsafe method, login included.

- Use a cookie jar per account: `curl -s -c a.jar -b a.jar …`. One jar = one user; never share jars between roles.
- CSRF double-submit: read `csrf_token` from the jar and send it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE (`09-auth`).
- Always print status and body: `curl -s -w '\n%{http_code}\n' …`, pipe the body to `jq`.
- Locale: `-H 'X-Locale: <lang>'` on every request of a locale check.
- Multi-step or parallel scenarios: a small Node script (`fetch` + manual `Cookie` header) in the scratchpad; paste its output.
- Expiry/cooldowns: shift the timestamp row in the dev DB instead of waiting; record it.

### Observing side effects

- **DB** — `docker compose exec postgres psql -U <user> -d <db> -c "select …"` or Prisma Studio; query by the returned id, and check rows that must **not** exist.
- **Mail** — Mailpit API: `curl -s http://localhost:8025/api/v1/messages | jq` (list), `curl -s http://localhost:8025/api/v1/message/<ID> | jq` (subject, To, HTML/Text). Clear with `DELETE /v1/messages` before a check so counts mean something. Mail is sent via the outbox — allow the dispatcher to run, then check.
- **Files** — `docker compose run --rm s3-init aws --endpoint-url http://s3:8333 s3 ls s3://app-dev --recursive`, or the local storage dir: server-generated key, object private (anonymous GET on the bucket denied), download only through the API endpoint, expired file → 410.
- **Logs** — dev server output for the request id; grep for the test email, password, token, OTP.

### Test accounts

`docs/creds.md` (gitignored) registers test users with their state (role, owned resources, verified or not). Refer to accounts by address and state; **never quote a password** or paste the file anywhere. Missing state → create the account via the API and add a line for it. OTP flows are readable through Mailpit.

### Recording

Each check: verdict plus evidence, immediately. Verdicts: `PASS`, `FAIL`, `BLOCKED`, `NOT IN SCOPE`. `BLOCKED` needs the reason and what would unblock it. A `BLOCKED` row never becomes `PASS` because time ran out.

**The OpenAPI document must match what was observed.** A status, error code or field seen in a response but absent from `openapi/openapi.yaml` — or documented but never producible — is a defect (`contract`), even when the behaviour itself satisfies the AC.

A 500 anywhere is a defect, even on a request meant to fail. A stack trace, SQL or ORM message in a body is `critical`.

---

## Step 3 — Report

Return `### QA report`:

| Check | AC ref | Verdict | Evidence |
| --- | --- | --- | --- |

Then:

- **Defects** — severity, request to reproduce (no secrets), expected vs actual, suspected file. Severity: `critical` = AC clause not met, data loss/corruption, security (BOLA, auth bypass, PII leak), 500 on a main path · `major` = wrong behaviour on a secondary path, wrong code/status, missing locale, undocumented contract · `minor` = wording of `detail`, non-blocking doc gaps.
- **Contract defects** — observed vs `openapi/openapi.yaml`, per endpoint.
- **AC conflicts** — Notion page vs another page vs `docs/decisions.md`, both sides cited with page file and version (never paste confidential text into anything that leaves the machine).
- **Blocked** — with what is needed.
- **Verdict** — `ACCEPTED` or `REJECTED`. `ACCEPTED` requires zero `critical`, every in-scope clause `PASS`, and no unexplained `BLOCKED` (waivable only by the owner, explicitly).

The verdict gates delivery: on `REJECTED` nothing is committed, pushed or opened as a PR. `ACCEPTED` makes the branch pushable — pushing is still the owner's call. Then stop; hand defects to `bugfix`, one run per root cause, and re-run this pass after.

---

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "The e2e suite is green" | The author wrote it against their own reading. You test against the AC. |
| "401 and 403 are obviously handled by the global guard" | A new `@Public()`, a missing ownership check, a wrong id source — only a request proves it. |
| "The mail is queued, so it's sent" | Open it in Mailpit: recipient, locale, link, and that exactly one arrived. |
| "The second locale is probably fine" | A missing key ships the raw code as `detail`. Send `X-Locale`. |
| "Concurrency is unlikely" | Double-clicks and retries are not. Two parallel requests cost seconds. |
| "I'll fix it right now" | Then the report describes code that no longer exists. Report, then `bugfix`. |
| "Everything I could check passed, so: ACCEPTED" | Coverage is part of the verdict. Say what you could not reach. |

## Red flags — stop

- A `PASS` row with an empty Evidence cell
- "should", "appears to", "presumably" in a verdict
- No BOLA check on an endpoint that takes an id
- A password, token or OTP pasted into the report
- `ACCEPTED` with unexplained `BLOCKED` rows or unrun in-scope clauses
- Editing a source file during this pass
