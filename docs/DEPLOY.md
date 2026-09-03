# Deploying Kontier RI to Dokploy (https://ri.kontier.eu)

This is the **server** deploy of Kontier RI: a Node container running the
Next.js production server (`next start`), fronted by Dokploy's Traefik.

It is not the same artefact as the GitHub Pages build. The static export
(`NEXT_OUTPUT=export`) has no Node process, so `/api/workspace/*` does not
exist there and every dashboard stays in the browser. The container is the
*only* deploy mode where the shared-workspace API is reachable — that is the
whole reason it exists.

| | Static export (Pages) | Container (this doc) |
|---|---|---|
| Build | `NEXT_OUTPUT=export pnpm --filter web build` | `pnpm --filter web build` (defaults) |
| Serves | prebuilt HTML/JS | `next start`, Node 24 |
| Workspace API | absent (404) | `/api/workspace/*` |
| Storage | browser only | browser + `/data/workspace/<id>.json` |

---

## 0. Status — built and verified locally on 2026-09-03

`docker build -t kontier-ri:local .` **succeeds** on `main` @ `2aa815a`, and the
container was exercised end to end (see §9 for the transcript):

| Check | Result |
|---|---|
| `docker build` | ✓ (`node:24-alpine`, image 1.22 GB, `.next` 19 MB, `public/` 77 MB) |
| container health | ✓ `healthy` (the image `HEALTHCHECK` GETs `/`) |
| `GET /` | ✓ 200, runs as uid 1000 (`node`), not root |
| `GET /api/workspace/dashboards` anonymous | ✓ 401 |
| with a valid tenant token | ✓ `{"dashboards":[]}` |
| `PUT` a dashboard with a second token | ✓ 201, and the first token still sees an empty list (workspace isolation) |
| data on the volume | ✓ `/data/workspace/<workspaceId>.json`, owned by `node`, survives `docker restart` |
| `GET /duckdb/duckdb-eh.wasm` | ✓ 200 (the wasm bundles are baked in by the `prebuild` step, no jsDelivr at runtime) |

### One historical trap, worth keeping in view

Between 21:30 and 22:00 the build was broken repo-wide (not by this deploy):
`app/api/**/route.ts` exported

```ts
export const dynamic = process.env.NEXT_OUTPUT === "export" ? "error" : "force-dynamic";
```

Next 16.1.6 parses route segment config **statically**, so *every* build failed
— the container build (Turbopack: `Turbopack build failed with 7 errors`), the
GitHub Pages export build, and even `next build --webpack` (which compiles and
typechecks, then stops with `Invalid segment configuration export detected`).
There is no build flag that works around it. Commit `2aa815a` fixed it by
pinning the literal and omitting `app/api` from the export build.

**Do not reintroduce a computed `dynamic` / `revalidate` / `runtime` export.**
It breaks the deploy image and Pages at the same time, and the error names the
route, not the cause.


---

## 1. Files in this repo

| File | Purpose |
|---|---|
| `Dockerfile` | multi-stage build of the pnpm monorepo → `next start` on `node:24-alpine` |
| `.dockerignore` | keeps `node_modules`, `.next`, `out`, `.git`, tests and the 73 MB duckdb-wasm copy out of the build context |
| `docker-compose.yml` | the Dokploy stack: one service, one named volume, healthcheck, restart policy |

Nothing secret is committed. Tokens are supplied only through the Dokploy
environment field.

---

## 2. DNS

Create **one** record at the `kontier.eu` DNS provider, pointing at the
Dokploy host's public IPv4 (the same IP the other `*.kontier.eu` /
`*.kontorion.eu` Dokploy apps use):

| Type | Name | Value | TTL | Proxy |
|---|---|---|---|---|
| `A` | `ri` | `<dokploy-host-ipv4>` | 300 | **off / DNS-only** |

Add the matching `AAAA` record only if the host has a public IPv6 address.

Keep the record un-proxied at least until the first certificate is issued:
Traefik answers the ACME HTTP-01 challenge on port 80, and a proxy in front of
it that terminates TLS itself will make Let's Encrypt fail with a confusing
`unauthorized` error.

Check before deploying (the answer must be the Dokploy host, and it must
already be public — Let's Encrypt resolves from the internet, not from your
laptop's cache):

```bash
dig +short ri.kontier.eu A
```

---

## 3. Create the Dokploy application

Dokploy → project **Kontorion** → **Create Service → Compose**.

| Field | Value |
|---|---|
| Name | `kontier-ri` |
| Source | Git / Gitea → the `kontier-ri` repository |
| Branch | `main` |
| Compose Path | `docker-compose.yml` |
| Compose Type | Docker Compose |
| Auto Deploy | on (trigger: push) |

### 3.1 Environment

Paste into the compose service's **Environment** field:

```
KONTIER_WORKSPACE_TOKENS=<token>:<workspaceId>:<label>,<token2>:<workspaceId2>:<label2>
NEXT_PUBLIC_SITE_ORIGIN=https://ri.kontier.eu
```

Generate each token on a trusted machine and store it in the password manager
— it is never recoverable from the server (only its sha256 digest is kept in
memory):

```bash
openssl rand -hex 32
```

Full variable contract:

| Variable | Required | Where it is read | Meaning |
|---|---|---|---|
| `KONTIER_WORKSPACE_TOKENS` | for tenant logins | `apps/web/lib/server/auth.ts` | Comma-separated `token:workspaceId:label` entries. **One token = exactly one workspace.** The label may contain `:` (everything after the second `:` is the label) and defaults to the workspace id. Malformed entries are dropped silently; a duplicated token keeps its first mapping. Tokens are held only as sha256 digests, compared in constant time, never logged. |
| `KONTIER_WORKSPACE_GUESTS` | no | `apps/web/lib/server/guests.ts` | Guest workspaces ("anyone with the link is in") are **enabled unless this is exactly `off`**. `POST /api/workspace/guest` is the only unauthenticated, disk-allocating route: ≤ 500 live guests, ≤ 30 creations/hour/process, 30-day TTL, one JSON file per guest workspace on the same volume. Set `KONTIER_WORKSPACE_GUESTS=off` if `ri.kontier.eu` should not accept anonymous workspace creation. |
| `KONTIER_DEMO_TENANT` | no | `apps/web/app/api/workspace/tenant/route.ts` | `token:workspaceId:label` behind the one-click demo sign-in. **The token must also appear in `KONTIER_WORKSPACE_TOKENS`**, otherwise the button hands out a credential the API then rejects with 401. Unset ⇒ the button reports 503 honestly. |
| `NEXT_PUBLIC_WORKSPACE_API` | no | `apps/web/lib/workspace-session.ts` | Build-time override of the API base URL. Leave unset for this deploy: the browser then calls same-origin `/api/workspace`. |
| `KONTIER_WORKSPACE_DIR` | no | `apps/web/lib/server/workspace-store.ts` | Data directory, one JSON file per workspace, atomic writes. The image sets `/data/workspace`, which is inside the volume. If you change it, keep it under `/data` or the data is lost on the next redeploy (the fallback is a CWD-relative `.data/workspace` inside the container filesystem). |
| `NEXT_PUBLIC_SITE_ORIGIN` | no | `apps/web/app/layout.tsx` | **Build-time** only; inlined into the bundle for canonical/OG URLs. Passed as a build arg in `docker-compose.yml`, default `https://ri.kontier.eu`. Changing it requires a rebuild, not a restart. |
| `PORT` | no | `next start` | Defaults to `3000`. If changed, update the domain's container port and the healthcheck. |
| `NEXT_OUTPUT`, `NEXT_BASE_PATH` | **must stay unset** | `apps/web/next.config.ts` | They switch the build to static export / subpath mode, which removes the API routes. The Dockerfile clears both explicitly. |

### 3.2 Domain

Compose service → **Domains → Add Domain**:

| Field | Value |
|---|---|
| Host | `ri.kontier.eu` |
| Service Name | `web` (the service key in `docker-compose.yml`) |
| Container Port | `3000` |
| Path | `/` |
| HTTPS | on |
| Certificate Provider | Let's Encrypt |

Dokploy generates the Traefik labels from this form. Do **not** hand-write
`traefik.*` labels in `docker-compose.yml` — they would be duplicated and the
router names would collide.

The compose file attaches the service to the external `dokploy-network`. That
is what makes the container reachable for Traefik; a compose service on its own
private network gets a 404 from the router even when the domain is configured.

### 3.3 Deploy

Press **Deploy**. The first build takes several minutes (full pnpm install +
`next build`); later pushes reuse the dependency layer unless a manifest or the
lockfile changed.

---

## 4. Verify

```bash
# 1. the container is healthy (on the Dokploy host)
docker ps --filter name=kontier-ri --format '{{.Names}}\t{{.Status}}'
#    -> "... (healthy)"; the image healthcheck GETs / every 30s

# 2. the app answers over HTTPS
curl -s -o /dev/null -w '%{http_code}\n' https://ri.kontier.eu/
# 200

# 3. the certificate is real
curl -sI https://ri.kontier.eu/ | head -1

# 4. the workspace API answers. 401 = the service is live and rejecting an
#    anonymous caller. 503 = "not configured", which now needs BOTH an empty
#    KONTIER_WORKSPACE_TOKENS *and* KONTIER_WORKSPACE_GUESTS=off — guest
#    workspaces are on by default, and that alone counts as configured.
curl -s -o /dev/null -w '%{http_code}\n' https://ri.kontier.eu/api/workspace/dashboards
# 401

# 5. a real token reaches its workspace
curl -s -H "Authorization: Bearer $KONTIER_TOKEN" \
     https://ri.kontier.eu/api/workspace/dashboards
# {"dashboards":[]}

# 6. the volume survives a redeploy: write, redeploy, read back
curl -s -X POST -H "Authorization: Bearer $KONTIER_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"name":"smoke","doc":{}}' \
     https://ri.kontier.eu/api/workspace/dashboards
```

There is **no** dedicated `/api/health` route: the workspace API answers
401/503 by design for an unauthenticated caller, so a health probe against it
cannot distinguish "server down" from "server refusing". `/` is the honest
liveness signal and is what both the image `HEALTHCHECK` and the compose
healthcheck use.

---

## 5. Data, backup, rollback

* Volume `workspace-data` is mounted at `/data`; the store writes
  `/data/workspace/<workspaceId>.json` (workspace ids are slugged, so a
  hostile token table cannot escape the directory).
* Every workspace's dashboards, version snapshots (max 200 per dashboard),
  command log (max 1000 entries) and investigation records are in that one
  file per workspace. Back it up with:

  ```bash
  docker run --rm -v <project>_workspace-data:/data -v "$PWD:/backup" alpine \
    tar czf /backup/kontier-ri-workspace-$(date +%F).tgz -C /data workspace
  ```

* Redeploys keep the volume. Deleting the compose stack in Dokploy **with**
  volumes deletes the workspaces — take the tarball first.
* Rollback = redeploy the previous commit in Dokploy; the data volume is
  untouched by an image change.

---

## 6. Not applied: `output: "standalone"`

The image intentionally does not need it. `next start` runs from a pruned
(`--prod`) pnpm install, which is why no change to `apps/web/next.config.ts`
was required. Standalone output would cut roughly 200–300 MB from the runtime
image (Next traces only the modules the server actually imports), at the cost
of one config change.

**This diff is NOT applied. Apply it yourself if you want the smaller image.**

```diff
--- a/apps/web/next.config.ts
+++ b/apps/web/next.config.ts
@@
 const nextConfig: NextConfig = {
   transpilePackages: ["@kontier-ri/datasource", "@kontier-ri/studio"],
   // The dev overlay badge floats over the bottom-left tile band, where the
   // canvas shows real state; screenshots and manual QA read the product
   // instead of the toolbar.
   devIndicators: false,
   outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
+  // Container deploy: emit .next/standalone (self-contained server.js + a
+  // traced node_modules subset). Env-gated like the export switch, so local
+  // dev, the e2e run and the GitHub Pages export are unaffected.
+  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
   ...(process.env.NEXT_OUTPUT === "export"
     ? { output: "export" as const, images: { unoptimized: true } }
     : {}),
```

Then, in the `Dockerfile`, set `ENV NEXT_OUTPUT="standalone"` in the `build`
stage and replace the whole runtime copy block with:

```dockerfile
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
WORKDIR /app/apps/web
CMD ["node", "server.js"]
```

(the `prod-deps` stage and the three `node_modules` copies then become dead
weight and can go). `outputFileTracingRoot` is already the monorepo root, so
the standalone bundle lands at `.next/standalone/apps/web/server.js` with the
traced `node_modules` beside it at the root — which is why the first `COPY`
targets `./` and not `./apps/web`.

---

## 7. Local checks (same image as production)

```bash
docker build -t kontier-ri:local .
docker run --rm -p 3000:3000 \
  -e KONTIER_WORKSPACE_TOKENS='devtoken:local:Local dev' \
  -v kontier-ri-workspace:/data \
  kontier-ri:local

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/                     # 200
curl -s -H 'Authorization: Bearer devtoken' \
     http://127.0.0.1:3000/api/workspace/dashboards                                 # {"dashboards":[]}
```

`docker compose up --build` also works locally, but only after removing the
`networks:` block (`dokploy-network` exists on the Dokploy host, not on a
laptop) and adding a `ports:` mapping.

---

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `503` + "workspace service is not configured" on every API route | `KONTIER_WORKSPACE_TOKENS` empty **and** `KONTIER_WORKSPACE_GUESTS=off`. The UI still works — dashboards stay in the browser. |
| Unexpected guest workspaces piling up in `/data/workspace` | Guest creation is public by design. Cap it with `KONTIER_WORKSPACE_GUESTS=off`, or leave it: 500 entries max, 30-day TTL. |
| Demo-tenant button returns 401 after sign-in | `KONTIER_DEMO_TENANT`'s token is not present in `KONTIER_WORKSPACE_TOKENS`. |
| `401` with a token you believe is right | The entry is malformed (needs at least `token:workspaceId`) and was dropped, or a duplicate earlier entry shadows it. Restart after fixing: the table is parsed from the env value at runtime and cached per raw value. |
| `EACCES` / `EROFS` writing the workspace file | `KONTIER_WORKSPACE_DIR` points outside `/data`, or the volume was created by an older image as root. Fix: `docker run --rm -v <project>_workspace-data:/data alpine chown -R 1000:1000 /data`. |
| Data gone after redeploy | The dir was not inside the volume — check `KONTIER_WORKSPACE_DIR` resolves under `/data`. |
| Traefik 404 on `ri.kontier.eu` | Domain added to the wrong service name (must be `web`), wrong container port (`3000`), or the service is not on `dokploy-network`. |
| Certificate not issued | DNS not public yet, an `A` record pointing elsewhere, or a proxy in front of Traefik intercepting the HTTP-01 challenge on port 80. |
| Build OOM on the Dokploy host | `next build` is memory hungry. Raise the builder's memory, or set `NODE_OPTIONS=--max-old-space-size=4096` as a build arg/env. |

---

## 9. Verification transcript (local, 2026-09-03)

Docker daemon: OrbStack 29.4.0, arm64. Built from `main` @ `2aa815a`, working
tree clean apart from the four deploy files.

```console
$ docker build -t kontier-ri:local .
...
#29 naming to docker.io/library/kontier-ri:local done
EXIT=0

$ docker run -d --name kri-real -p 3111:3000 \
    -e 'KONTIER_WORKSPACE_TOKENS=devtoken123:local:Local proof,tok2:acme:Acme team' \
    -v kri-real-data:/data kontier-ri:local

$ docker inspect --format '{{.State.Health.Status}}' kri-real
healthy

$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3111/
200
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3111/api/workspace/dashboards
401
$ curl -s -H 'Authorization: Bearer devtoken123' http://127.0.0.1:3111/api/workspace/dashboards
{"dashboards":[]}
$ curl -s -X PUT -H 'Authorization: Bearer tok2' -H 'content-type: application/json' \
       -d '{"name":"acme dash","doc":{}}' http://127.0.0.1:3111/api/workspace/dashboards/d1
{"dashboard":{"id":"d1","name":"acme dash","updatedAt":1788471710341,"tileCount":0}}   # 201
$ curl -s -H 'Authorization: Bearer devtoken123' http://127.0.0.1:3111/api/workspace/dashboards
{"dashboards":[]}                       # isolation: tok2's write is invisible to token 1

$ docker exec kri-real ls /data/workspace
acme.json
$ docker exec kri-real id -un
node
$ docker restart kri-real && curl -s -H 'Authorization: Bearer tok2' \
    http://127.0.0.1:3111/api/workspace/dashboards
{"dashboards":[{"id":"d1","name":"acme dash",...}]}    # survives a restart

$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3111/duckdb/duckdb-eh.wasm
200
```

Not verified here (no access from this machine): the Dokploy UI wire-up, the
`ri.kontier.eu` DNS record, Let's Encrypt issuance, and routing through
`dokploy-network`. Everything in §2–§4 is written from the house conventions
in `kontier-infra/docs/dokploy-wireup.md`, not from a live run.

### Image size

1.22 GB, dominated by the pruned-but-still-full pnpm tree:

| Layer | Size |
|---|---|
| `/app/node_modules` (prod install) | 690 MB — `next` 155 MB, `@next/swc-linux-arm64-musl` 106 MB, `@duckdb/duckdb-wasm` 138 MB, `@phosphor-icons/react` 57 MB |
| `apps/web/public` | 77 MB (73 MB of duckdb-wasm bundles served same-origin) |
| `apps/web/node_modules/typescript` | 24 MB (needed to load `next.config.ts` at boot) |
| `apps/web/.next` | 19 MB |

`output: "standalone"` (§6) is the real fix: Next traces only the modules the
server imports, which removes most of that 690 MB. Hand-pruning
`node_modules` in the Dockerfile was deliberately not done — guessing which
package the server bundle still requires at request time is exactly the kind
of change that fails in production and not in a smoke test.

