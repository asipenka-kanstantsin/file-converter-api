# Create Mail Template Prompt

## Role

You are a senior backend engineer adding a transactional mail.

Follow `11-mail.mdc`, `13-i18n.mdc`, `20-jobs.mdc`.

---

## Inputs

- the AC for the mail: trigger, recipient, subject, content, links, language
- the business write that triggers it

---

## Steps

1. **Register the template** with a zod variables schema:

   ```ts
   export const mailTemplates = {
     "team.invitation": z.object({
       companyName: z.string(),
       expiresInDays: z.number().int(),
       inviteUrl: z.string().url(),
     }),
   } as const;
   ```

   Name: `<domain>.<event>`, kebab-case event.

2. **Write the files** for every supported locale:

   ```
   infrastructure/mail/templates/team.invitation/<locale>/subject.hbs
   infrastructure/mail/templates/team.invitation/<locale>/html.hbs
   infrastructure/mail/templates/team.invitation/<locale>/text.hbs
   ```

   - use the shared layout; `{{var}}` escaped; `{{{var}}}` only for server-produced HTML
   - text part is a real text version, not a stripped HTML dump
   - links built from `config.app.publicUrl` + a route, never the request `Host`
   - no secrets in the URL beyond a single-use token; the token itself stored hashed

3. **Enqueue in the service, inside the business transaction**:

   ```ts
   await this.db.transaction(async (tx) => {
     const invite = await this.invites.create(tx, data);
     await this.mail.enqueue(tx, "team.invitation", recipient, {
       companyName,
       expiresInDays: 7,
       inviteUrl: buildInviteUrl(this.config.app.publicUrl, token),
     });
   });
   ```

   - recipient locale = stored user/invite locale, not the request's `X-Locale`
   - idempotency key `<template>:<entityId>:<purpose>`
   - endpoint whose only job is sending returns 202; rate-limited

4. **Tests**
   - render test: template × every locale with sample vars (catches missing vars and files)
   - service spec with `FakeMailTransport` or outbox assertion: template, locale, vars
   - e2e: run the dispatcher tick, read Mailpit API (`/v1/search?query=to:<addr>`), assert
     subject, language and link

---

## Checklist

- [ ] subject/html/text in every locale (parity test green)
- [ ] no hardcoded strings in TypeScript
- [ ] enqueued via outbox in the same transaction; never sent inline
- [ ] logs mask the recipient; no vars, codes or links logged
- [ ] suppression list respected

---

## Output

- template name and vars schema
- files per locale
- trigger (service method) and idempotency key
- Mailpit evidence from the e2e or manual run
