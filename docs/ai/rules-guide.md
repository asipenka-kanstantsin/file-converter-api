# Rules Guide

## Purpose

Rules define AI behavior.

Location: `.cursor/rules/`

| File | Covers |
|---|---|
| `00-core.mdc` | agent identity, read-before-change, Superpowers for features |
| `01-architecture.mdc` | dependency direction, `Controller → Service → Repository → ORM`, module boundaries |
| `02-code-quality.mdc` | strict TS, zod DTOs, response DTOs, `AppException`, typed config, forbidden patterns |
| `03-security.mdc` | auth by default, ownership, CSRF, hashing, logging, rate limits, uploads |
| `04-database.mdc` | migrations, safe changes, transactions, indexes, naming, N+1 |

---

# Rules vs Knowledge

## Rules

- mandatory behavior
- constraints
- always applied

```
Controllers never touch the ORM.
Never edit an applied migration.
```

## Knowledge

- architecture information
- technology decisions
- implementation details and examples

```
How the error filter maps constraint names to codes.
How mail is enqueued through the outbox.
```

---

# Rule Priority

1. Existing code
2. .cursor/rules
3. .cursor/knowledge
4. AGENTS.md
5. docs
6. General best practices

Expected **behaviour** comes from the Notion AC, not from this list.

---

# Adding New Rules

Add a rule only when:

- behavior must always apply
- mistakes repeat
- architecture, contract or data needs protection

Avoid:

- copying knowledge into rules
- creating too many rules
- a rule that ESLint could enforce instead — prefer the lint rule
