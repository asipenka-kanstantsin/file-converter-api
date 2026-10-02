# Git Workflow Prompt

## Role

You are a senior engineer preparing a backend repository for professional development in an
AI-first process.

Follow `.cursor/knowledge/16-git.mdc`.

---

# Task

Prepare Git configuration and workflow. Do not create unnecessary complexity.

---

# Repository Setup

Verify:

- Git repository exists; default branch `main`; remote configured
- `main` protected: PR required, required status check (`verify` CI job), linear history,
  Squash and Merge only, no force push

---

# .gitignore

```
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
var/
*.log
.DS_Store
```

Add the generated ORM client directory only if the project decided not to commit it.

---

# Environment Example

`.env.example` with every variable from the config schema, placeholders only
(`.cursor/prompts/setup/environment.md`).

---

# Branching

- one task — one branch from `main`
- `<type>/<TASK-ID>_<short_description>`; types `feat`, `fix`, `hotfix`, `refactor`, `chore`,
  `docs`, `test`
- direct commits to `main` are forbidden

```
feat/ABC-123_add_login
fix/ABC-789_refresh_token_rotation
chore/ABC-100_update_dependencies
```

---

# Sync with main

```bash
git fetch origin
git rebase origin/main
npm run db:migrate
```

Prefer `rebase` over `merge`. After a rebase that pulls in migrations, re-apply and re-test yours.

---

# Commits

- **one line only**, max **70 characters**, `<type>: <description>`
- no body, no `Co-authored-by`, `Authored-by`, or other trailers
- WIP commits allowed; Squash and Merge combines them

```
feat: add saved searches endpoints
fix: map users_email_key violation to USER_EMAIL_TAKEN
chore: add index on matches.assignment_id
```

---

# Migrations in Git

- migration and dependent code in the same PR
- never edit a migration applied on a shared environment; never merge a PR that did
- destructive steps in a later PR (expand → migrate → contract)

---

# Pull Request

- `npm run verify` green; CI green
- conflicts resolved; no debug code
- template filled, including Contract changes and Schema changes
- Squash and Merge; delete the branch after merge

---

# Generated Files

Do not commit: `dist/`, `coverage/`, local storage dirs, DB dumps, `.env`, AI logs, local editor
config.

---

# Output Format

## Git Status

## Files Created

## Configuration Changes

## Recommended Workflow
