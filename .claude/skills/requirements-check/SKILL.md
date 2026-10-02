---
name: requirements-check
description: Use before writing any code for a task tied to a Notion requirements page, an FC-n task id, an API change or a permission rule — and whenever the task asks what an endpoint should return or who may call it. Pulls the current Notion spec into docs/requirements/ and resolves it against docs/decisions.md.
---

# Requirements check (Notion)

The requirements are the Notion training spec "[A] Обучение Back End для Front End разработчиков"
(root page `3c6e8aa9-1a77-8094-a0fc-f6a05c046297`) and its sub-pages. The open points the spec leaves
to the implementer, and every adjustment agreed with the mentor, are in `docs/decisions.md`.

Nothing else in this repo — not the OpenAPI document, not the tests, not old notes — is the
requirement.

## How to pull it

1. **Refresh the export every time**, even if `docs/requirements/` already exists:

   ```bash
   node scripts/fetch-requirements.mjs
   ```

   It writes one Markdown file per Notion page plus `VERSIONS.tsv` (page file, Notion `version`,
   last edited). The folder is git-ignored: the spec is confidential to Innowise and must never be
   committed, pasted into a PR, an issue or any external service.
2. Map the task to its page through the task-id table in `docs/decisions.md` (FC-0 … FC-13), then
   read the **whole** page file, not the first matching heading. Follow the page's "Ресурсы"
   sub-pages when they constrain the implementation (JWT, password storage, mail, file storage,
   GDPR, OOP abstractions).
3. Read `docs/decisions.md` rows for the area. Decisions only **fill gaps** Notion leaves open
   ("выбрать один подход", "требует фиксации", "опционально") or record a mentor agreement; they
   never contradict a Notion page. A decision that does, is a defect in `decisions.md`.
4. If the export fails (network, Notion changed the endpoint), say so in `### Requirements` and ask
   the owner for the page text. Do not rebuild requirements from the code or from memory.

Two Notion embeds (the NestJS boilerplate and the RBAC example repos) are external objects the
public API cannot resolve; the export marks them. Ask the owner for those links if a task needs them.

Backend-specific things to extract from every page: who may perform the action (Self / Admin /
permission), validation limits, state transitions and the response to an illegal one, what is sent
(mail) and to whom, what is stored and for how long, what must stay hidden, every listed status
code — each becomes a status and an `ErrorCode` — and the page's audit/log and NFR sections.

## Required output

Report a `### Requirements` block before any code is written:

- **Source** — page file(s) and their `version` from `VERSIONS.tsv` (the version is how staleness
  gets caught later).
- **Acceptance criteria** — the clauses that constrain this task, quoted or tightly paraphrased,
  numbered. Not a link: the text must be in context.
- **Decisions** — the `docs/decisions.md` rows that apply, with their status. A `proposed` row the
  task depends on is listed under Gaps as "needs mentor confirmation" but does not block work.
- **Conflicts** — where Notion pages disagree with each other (e.g. "Удаление" revokes sessions,
  "Авторизация" forbids storing refresh state), with the current contract, or with existing code.
  Name both sides; do not silently pick one.
- **Gaps** — what neither Notion nor `decisions.md` specifies but the implementation needs. Propose
  a resolution and add it to `docs/decisions.md` as `proposed` in the same change.

## Precedence

**Notion has the highest priority** — over `docs/decisions.md`, over every kit rule
(`AGENTS.md`, `CLAUDE.md`, `.cursor/`), over the contract and the code.

1. The Notion page for the feature, then the Notion NFR page and the "Ресурсы" sub-pages
2. `docs/decisions.md` — only for points Notion leaves open (`agreed` before `proposed`)
3. The OpenAPI contract (`openapi/openapi.yaml`) — ours to change
4. Kit conventions (`AGENTS.md`, `.cursor/rules`, `.cursor/knowledge`)
5. Existing code

When Notion and anything below it disagree, Notion wins: fix the rule, the decision, the contract
or the code, and flag the change. When two Notion pages disagree, report both and record the
chosen reading in `docs/decisions.md` for the mentor.

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "The export from yesterday is fine" | The mentor edits pages. Re-run the script and compare `version`. |
| "The OpenAPI document says so" | It describes what we built, not what was asked. |
| "Notion leaves it open, I'll just pick" | Pick, and write it into `docs/decisions.md` so the mentor sees it. |
| "It's a one-line bugfix" | A bugfix needs the expected behaviour. That is the page. |
| "I'll paste the spec into the PR for context" | It is confidential. Reference the page title and version only. |

## Red flags — stop

- About to edit a file and `### Requirements` has not been produced
- Quoting a requirement from memory without a page file and version
- A choice that the spec left open, made in code but absent from `docs/decisions.md`
- Requirement text inside a committed file, a commit message or a PR description
