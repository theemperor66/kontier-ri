# Kontier RI — Engineering & Realization Plan v1
_Companion to PM-PLAN.md. Authored 2026-08-31. All work additive; existing 35-tool contract is frozen API._

## E0. Engineering foundations (apply to every workstream)
- **Additive-only before Sep 3 freeze**: new tile types / tools / buttons only; `migrateDoc` chain extended, never rewritten. Doc gains `version: 3` only when a new field ships.
- **Gates**: clean-clone `pnpm -r build` + unit (182+) + e2e (9+, budget <90s) + live real-Chrome tool sweep + visual QA both themes.
- **Perf budget**: cold TTI <2.5s (Pages), agg query paint <500ms local data; chart renderers move to per-type `dynamic()` imports if apps/web first-load JS >250KB gz.
- **Security**: audit `annotations.untrustedContentHint` on every tool returning user data (prompt-injection surface); CSP tightening now that DuckDB is same-origin; numeric-only substitution in any templated SQL (what-if).
- **Conformance kit**: export a `describeDataSourceContract(makeSource)` vitest factory from `packages/datasource` — every connector (public or private) must pass it.

## E1. WS2a — 100M-row scale proof (0.5–1 day)
**Design.** Synthetic `billing_events` parquet, 100M rows, hive-partitioned by month (24 files, ~4M rows each), ZSTD, row-group ≈1M rows → predicate pushdown + footer-only cold reads. Generated locally with DuckDB CLI (`COPY (SELECT ...generate_series...) TO 'events' (FORMAT PARQUET, PARTITION_BY (month), ROW_GROUP_SIZE 1000000)`). Host on Cloudflare R2 (free egress) with CORS `GET,HEAD` + `Range` allowed; fallback single 10M-row file committed to a HF dataset if R2 blocked.
**Engine.** DuckDB-WASM httpfs: `CREATE VIEW scale_events AS SELECT * FROM read_parquet(['https://…/month=*/**.parquet'], hive_partitioning=1)`; registered as dataset (group `remote`). Range requests fetch only needed row groups.
**UX.** Empty-state + palette: “Load 100M-row demo”. Status chip during query: wall-time + MB fetched (delta of `performance.getEntriesByType('resource')`). Demo tiles: events/day line, revenue by country bar, failure-rate heatmap.
**Tools.** No new tools needed (`run_sql`/`add_tile` just work — that IS the story). `list_datasets` shows `100,000,000 rows`.
**Acceptance.** Cold `count(*)` <3s @ 50Mbps; grouped agg <5s; fetched-MB chip shows MB not GB; zero regressions.
**Risks.** CORS misconfig (test with curl early); WASM memory (streaming agg is fine; avoid `SELECT *`); cold footer fan-out (24 files ok; consolidate if >100).

## E2. WS2b — Agent presence layer (1 day)
**Store slice.** `presence: { plan?: {title?, steps: [{label, status: 'pending'|'active'|'done'|'failed'}], updatedAt}, insights: [{id, title, body, severity: 'info'|'warn'|'critical', tileId?, suggestedAction?, state: 'proposed'|'accepted'|'dismissed'}] }` — NOT in undo history (ephemeral), but activity-logged.
**Tools (4 new → 39).** `present_plan({title?, steps[]})` upsert; `update_plan_step({index, status})`; `propose_insight({title, body, severity?, tileId?, suggestedAction?})`; `clear_plan({})`. All `.strict()`, compact acks.
**UI.** `PlanCard` floating top-right: agent avatar “Kai”, step ticks animating; `InsightTray` chips under filter bar — Accept executes `suggestedAction` through EXISTING actions (origin `agent`, undoable) / Dismiss; synthetic agent cursor: absolutely-positioned cursor glyph animated (FLIP) to each tile the agent mutates (drive off agentPulse) — pure CSS transform, no layout thrash.
**Honesty rule.** Rendering driven ONLY by real tool calls. No fake autonomy.
**Tests.** Slice units (plan upsert, insight lifecycle), schema strictness, e2e: `present_plan` renders card, accept-insight creates annotation, cursor element appears on agent add_tile.
**Acceptance.** Demo loop: plan card fills → tiles land with cursor flying → insight chip accepted → annotation appears. All under 15s narratable.

## E3. WS2c — Stripe import wizard (1 day, gated on E1+E2 green by Tue 12:00)
**Design.** Client-only. Header-signature detection of Stripe exports (`charges`, `invoices`, `subscriptions`, `customers`). Mapping layer → canonical views (`rev_invoices`, `rev_subscriptions`, …) via SQL templates; **minor-units handling** (amounts are cents → `/100.0` per currency exponent map), refund/dispute filters, `status` normalization. Wizard UI: drop files → detected-type cards → “Build revenue dashboard” instantiates the Revenue template against mapped views.
**Tools.** None new; mapped views appear in `list_datasets` (group `stripe`). Agent prompt chip: “I exported my Stripe data — build my real dashboard.”
**Acceptance.** Real-shaped fixture CSVs (committed, anonymized) e2e: drop 2 files → dashboard with correct MRR math (cents!) renders; conformance to existing tool surface.

## E4. WS3 — Predictive pack (Sep 4–10)
- **Forecast**: `spec.analytics.forecast {periods<=24, method: 'linear'|'ets', ci: 0.8|0.95}`; Holt-Winters additive impl in TS (~80 LOC, no dep, unit-tested against known series); render CI band (Area) + dashed mean on ComposedChart. Tool `forecast_metric({dataset, measure|sql, periods})` returns numbers for narration.
- **Cohort tile** (`type: 'cohort'`): SQL template cohort-month × offset retention matrix; reuse heatmap renderer with % color scale + row labels. `add_tile` schema extension.
- **What-if tile** (`type: 'whatif'`): `{params: [{name, label, min, max, step, value}], formulaSql (numeric $param substitution only — reject strings), outputs: [{label, format}]}`; sliders render; agent tools `set_whatif_param`, `read_whatif`. Flagship demo: price-elasticity MRR simulator (uses our CPQ domain credibility).
- Doc `version: 3` + migration test. ~+40 unit tests, +3 e2e.

## E5. WS4 — Data gravity (Sep 4–14)
- **HttpParquetSource** (productized E1): “Connect data by URL” (parquet/CSV https). Public.
- **MotherDuckSource**: duckdb-wasm MD extension, token in-browser only. Public, experimental flag.
- **PostgresProxySource**: requires server hop (CF Worker + Hyperdrive or WS proxy) — breaks pure-client story; ship as OPTIONAL self-host recipe, never default. Public.
- **KontierSource** (PRIVATE repo `kontier-ri-adapter`): DataSource over Kontier analytics/rollup REST + session auth; workspace datasets mapped; RLS stays server-side. Must pass the conformance kit; contract pinned by public interface version.
- Connector picker UI in manager modal; each source labeled with its privacy model.

## E6. WS5 — Multiplayer spike (Sep 10–12, timeboxed 2 days, go/no-go)
Command-stream sync (NOT CRDT v1): server (PartyKit/Durable Object) as ordering authority over our existing command layer; doc = replayed commands; presence = cursor broadcast. Known-hard: multi-user undo (v1: per-user undo of own commands), conflict rule becomes per-user. Spike exit criteria: 2 browsers, 1 doc, live tiles + cursors, <150ms echo. No-go → ship “live view-only share” instead.

## E7. Delivery mechanics
- **Worker plan (Phase 0/1)**: `scale-proof` (E1) and `presence` (E2) in parallel — disjoint paths (E1: scripts/, R2, lib/datasource glue + empty-state button; E2: packages/studio presence slice/tools + apps/web presence components). Integration + audit by orchestrator. E3 solo worker if gate passes.
- **Rollback**: every wave lands as revertable commit series on main; Pages deploy history = instant rollback via `git revert` push.
- **Versioning**: tag `v1.0.0` at submission; CHANGELOG.md starts Phase 3; CLA required before first external PR (dual-licensing).
- **Post-submission observability**: opt-in, privacy-first error beacon only (no analytics on user data — it IS the pitch).

## E8. Estimates & sequence (net agent-days)
E1 0.5–1d → E2 1d (parallel) → E3 1d (gated) | freeze | E4 4d → E5 3d + 2d spike → pilots. User time pre-freeze: R1 10min + voice 1h + submit 30min.
