# =============================================================================
# Kontier RI — server deploy image (Node container behind Dokploy/Traefik)
#
# WHAT: multi-stage build of the pnpm monorepo that ships ONLY apps/web as a
# Next.js production server (`next start`). Mirrors the kontorion-site pattern
# (build stage -> slim runtime stage on node:*-alpine), adapted to pnpm
# workspaces.
#
# WHY the stages look like this:
#   base       — pnpm pinned to the root package.json `packageManager` value.
#   deps       — manifests only, so a source-only change reuses the install
#                layer (a full install is the slowest step by far).
#   build      — full source, `pnpm --filter web build`. NEXT_OUTPUT and
#                NEXT_BASE_PATH are cleared on purpose: apps/web/next.config.ts
#                switches to `output: "export"` / a basePath when they are set,
#                and the container deploy is the DEFAULT server build (the API
#                routes under app/api/workspace only exist in that mode).
#   prod-deps  — the same install pruned with `--prod`, so playwright, vitest,
#                typescript and tailwind never reach the runtime image.
#   runtime    — .next + public + prod node_modules, run as the unprivileged
#                `node` user.
#
# NOT standalone output: `output: "standalone"` would need a change in
# apps/web/next.config.ts, which this image deliberately does not require.
# The exact (unapplied) diff and what it would buy is in docs/DEPLOY.md.
#
# Build:  docker build -t kontier-ri:local .
# Run:    docker run --rm -p 3000:3000 -v kontier-ri-workspace:/data kontier-ri:local
# =============================================================================

# -----------------------------------------------------------------------------
# base — node + the exact pnpm the repo pins
# -----------------------------------------------------------------------------
FROM node:24-alpine AS base
# The root package.json pins packageManager=pnpm@11.20.0. pnpm 10+ self-manages
# that pin, so installing the same version here means zero download at build
# time; installing it with npm (instead of corepack) avoids corepack's signature
# checks failing on a pnpm release newer than the bundled corepack keyring.
RUN npm install -g pnpm@11.20.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# -----------------------------------------------------------------------------
# deps — full install (dev + prod) from manifests only
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/datasource/package.json packages/datasource/package.json
COPY packages/studio/package.json packages/studio/package.json
COPY packages/workspace/package.json packages/workspace/package.json
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# build — `pnpm --filter web build`
# -----------------------------------------------------------------------------
FROM deps AS build
COPY . .

# Server build: no static export, no base path (see file header).
ENV NEXT_OUTPUT=""
ENV NEXT_BASE_PATH=""

# NEXT_PUBLIC_* are inlined at BUILD time, so the public origin has to be known
# here; it only feeds metadata (canonical URL, OG image URL) in app/layout.tsx.
ARG NEXT_PUBLIC_SITE_ORIGIN=https://ri.kontier.eu
ENV NEXT_PUBLIC_SITE_ORIGIN=$NEXT_PUBLIC_SITE_ORIGIN

# `prebuild` (scripts/copy-duckdb.mjs) copies the duckdb-wasm bundles into
# apps/web/public/duckdb so the browser loads them same-origin instead of from
# jsDelivr — that is why public/ is taken from THIS stage, not from the context.
# .next/cache is a build cache only; dropping it here (same layer) keeps it out
# of the image instead of hiding it behind a later `rm`.
RUN pnpm --filter web build && rm -rf apps/web/.next/cache

# -----------------------------------------------------------------------------
# prod-deps — the same node_modules with devDependencies pruned
# -----------------------------------------------------------------------------
FROM deps AS prod-deps
# CI=true: pruning devDependencies makes pnpm purge and rebuild node_modules,
# and it refuses to do that without a TTY unless it believes it is in CI
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). It is scoped to this RUN so it
# cannot quietly change pnpm's behaviour in the build stage.
RUN CI=true pnpm install --frozen-lockfile --prod --ignore-scripts

# -----------------------------------------------------------------------------
# runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default data dir. lib/server/workspace-store.ts falls back to a CWD-relative
# ".data/workspace" — inside a container that would be a writable path that no
# volume covers, i.e. silent data loss on redeploy. Point it at the volume.
ENV KONTIER_WORKSPACE_DIR=/data/workspace
WORKDIR /app

# node:*-alpine already ships an unprivileged `node` user (uid/gid 1000).
# Creating /data here (owned by node) means a fresh named volume mounted at
# /data inherits that ownership, so the server can write without a root entrypoint.
RUN mkdir -p /data/workspace && chown -R node:node /data

# pnpm keeps a strict, symlinked node_modules: apps/web/node_modules/... and
# packages/*/node_modules point into /app/node_modules/.pnpm, so all three trees
# have to land at the same paths for the links to resolve.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=prod-deps --chown=node:node /app/packages ./packages
COPY --chown=node:node package.json pnpm-workspace.yaml ./
# Workspace package sources: `transpilePackages` bundles them into .next, so
# this is belt-and-braces for anything resolved at request time. ~360 KB.
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps/web/package.json apps/web/next.config.ts ./apps/web/
# `next start` re-reads next.config.ts at boot, and Next 16 transpiles a TS
# config with the PROJECT's typescript package. typescript is a devDependency,
# so the pruned tree does not have it: Next then tries to install it at runtime
# (with yarn, in a read-only-ish container, against a pnpm packageManager pin),
# fails, and exits with "Failed to transpile next.config.ts". Taking it from
# the unpruned `deps` stage keeps the version identical to the build.
COPY --from=deps --chown=node:node /app/apps/web/node_modules/typescript ./apps/web/node_modules/typescript
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
WORKDIR /app/apps/web
EXPOSE 3000

# There is no dedicated /api/health route (the workspace API answers 401/503 by
# design when no token is sent), so "/" is the honest liveness signal: it is
# server-rendered by the same Next process that serves the API.
# Shell form on purpose — ${PORT} must expand.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/" || exit 1

# Equivalent to `pnpm --filter web start`, without needing pnpm in the runtime.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
