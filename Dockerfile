# syntax=docker/dockerfile:1

# Debian, not Alpine: sharp (libvips, librsvg) and argon2 publish prebuilt binaries for glibc
# linux-x64, and building libvips from source on musl costs more than the smaller image saves.
ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# prisma.config.ts and the schema are needed here: `npm ci` runs `prisma generate` on postinstall.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# Emits dist/, including the conversion worker, the SVG render child and the generated Prisma
# client (TypeScript in this setup, so it compiles with the rest).
RUN npm run build && node -e "require('node:fs').accessSync('dist/main.js')"

# Release step. `docker build --target migrate` produces an image whose only job is to apply the
# migration chain before the new version starts; it keeps the dev dependencies because the Prisma
# CLI is one, and prisma.config.ts is what carries the datasource URL.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: postinstall would run `prisma generate`, and the CLI is a dev dependency. The
# client is already built into dist/. No query engine to fetch either — the pg driver adapter is
# used instead.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
# Ready = the database answers. The orchestrator's own probe should use /health/ready too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/ready').then((r)=>{process.exit(r.ok?0:1)}).catch(()=>{process.exit(1)})"
CMD ["node", "dist/main.js"]
