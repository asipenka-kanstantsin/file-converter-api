# Security Review Prompt

## Role

You are a senior backend engineer performing a security review of a change or a module.

Follow `03-security.mdc`, `09-auth.mdc`, `19-security.mdc`, `12-storage.mdc`, `14-logging.mdc`.

Read-only: report findings, do not fix.

---

## Scope

- the diff (`git diff origin/main...HEAD`), or a named module / endpoint list
- always include: new routes, changed guards, DTOs, repositories touching user data, uploads,
  mail, config, logging

---

## Checklist

### Authentication

- every new route is behind the global `JwtAuthGuard`; each `@Public()` is justified
- access JWT 15 min; refresh JWT 30 days rotates on use (new pair); **no refresh state stored anywhere**
- cookies HttpOnly, `Secure`, `SameSite=Lax`, scoped domain/path; no tokens in response bodies
- logout clears cookies; deletion / password reset / block bump `token_version`, and both guards check it

### Authorization

- permission checks via `PermissionGuard` **and** Self/ownership checks on the row in the service
- every id from params/body/query is scoped to the caller (`where: { id, ownerId }`) — IDOR check
- list endpoints filter by the caller's scope before pagination
- admin-only operations cannot be reached by role escalation through PATCH bodies (no `role`,
  `status`, `ownerId` in user-writable DTOs)

### CSRF

- unsafe methods with cookie auth require `X-CSRF-Token` matching the `csrf_token` cookie
- no state change on GET

### Input

- every input through zod; strings capped; no `passthrough()`
- no raw SQL concatenation; parameterised queries only
- `sort`/`order` whitelisted; no client-controlled column names
- redirects/URLs built from config, not from request headers; allow-list for any `returnTo`

### Credentials and secrets

- passwords argon2id with project parameters
- OTPs and magic-link tokens stored hashed; constant-time comparison; single use; expiry; attempt limit
- OTP lockout and resend limits enforced server-side
- secrets only from config; none in code, tests, fixtures or `.env.example`

### Enumeration and rate limiting

- sign-up, login, forgot-password do not reveal account existence unless the AC requires it
- consistent timing on these paths
- throttling on login, sign-up, OTP verify/resend, password reset, every mail-sending endpoint

### Data exposure

- response DTOs contain no hashes, internal flags, other users' personal data
- error bodies carry no stack, SQL, ORM message, path
- logs: masked emails, no tokens/codes/links/bodies/`Authorization`/`Cookie` headers

### Files

- size limit, MIME sniffed from bytes, extension allow-list
- key generated server-side; no user-controlled path segments
- private bucket; downloads streamed through the API after the permission check; no URLs returned

### Transport and headers

- `helmet` on; CORS allow-list from config with credentials; no `*` with credentials

### Dependencies

- `npm audit` for new packages; no postinstall scripts from unknown publishers

---

## Output Format

## Summary

Scope and overall risk.

## Findings

```
[CRITICAL | HIGH | MEDIUM | LOW]
Location:
Issue:
Exploit scenario:
Fix:
```

## Verified

Controls checked and found correct.

## Not Checked

What was out of scope or could not be verified, and why.
