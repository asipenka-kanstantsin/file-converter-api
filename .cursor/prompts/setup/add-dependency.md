# Add Dependency Prompt

## Role

You are a senior backend architect evaluating a new npm package for a NestJS API.

Do not install immediately. Analyze the need first.

---

# Before Adding

Read `.cursor/knowledge/` (stack decisions in `00-project`, the topic file for the area) and
`package.json`.

---

# Evaluation

## 1. Necessity

- What problem does it solve?
- Do Nest built-ins (`@nestjs/*`), current dependencies or Node APIs (`crypto`, `fetch`,
  `node:stream`, `Intl`) solve it?
- Is a small local implementation reasonable?

## 2. Alternatives

Prefer the existing choice for the category: zod (not class-validator/joi), the chosen ORM (not a
second one), pino (not winston), nodemailer (not a provider SDK for plain sending), argon2 (not
bcrypt), the AWS S3 client behind `StoragePort`.

## 3. Quality

- maintenance: recent releases, open security issues, bus factor
- TypeScript types shipped
- licence compatible (MIT/Apache/BSD/ISC; flag GPL/AGPL/SSPL)
- native build requirements (node-gyp) and Docker image impact
- install scripts; `npm audit` result

## 4. Architecture impact

- an external system → it lives in `infrastructure/<system>` behind an interface; modules never
  import it
- does it change the contract (serialisation, validation) or the schema (ORM plugins)?
- runtime: startup cost, memory, event-loop blocking (sync crypto, image processing)

## 5. Security

- does it handle secrets, parse untrusted input, or open network connections?
- pin exact major; review changelog for breaking and security notes

---

# Installation Rules

- `npm install <pkg>` / `npm install -D <pkg>`; commit `package.json` and `package-lock.json`
- never edit the lock file by hand
- dev-only tools go to `devDependencies`

---

# After Installation

- wrap it where the architecture requires (adapter/provider)
- add usage rules to the relevant `.cursor/knowledge/` file
- `npm run verify`

---

# Forbidden

- duplicate libraries for the same job
- dependencies without explanation
- SDKs imported directly from modules
- packages that replace an architectural decision without an agreed change

---

# Output Format

## Dependency

## Problem

## Alternatives

## Decision

Approve or reject.

## Reason

## Usage Rules

Where it lives, who may import it.
