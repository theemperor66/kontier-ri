# Kontier RI — Revenue Intelligence Studio

Open-source, agent-native revenue analytics studio. Humans and AI agents build
dashboards **together** on the same live canvas via **WebMCP**
(`window/document.modelContext` tool registration). Built for the WebMCP
Challenge (deadline 2026-09-03 13:00 PDT), designed to be merged into Kontier
(billing SaaS) later.

## Pitch
- The agent is a colleague inside your BI tool, with hands: it queries, drafts
  tiles, drills down. The human drags, restyles, steers. Neither is a spectator.
- Bidirectional context: human brushes a spike on a chart, asks "why?" — the
  agent reads the selection via a tool and answers with a drill-down tile.
- Local-first: DuckDB-WASM runs SQL fully in the browser. Raw data never leaves
  the page; the agent only sees aggregates it explicitly queries.

## Hard constraints (from challenge rules)
- Public GitHub repo, Apache-2.0, license visible in About section.
- Repo must contain everything needed to run the project. NO Kontier code.
- Live URL testable in ChatGPT in-app browser and Chrome 149+ with
  chrome://flags/#enable-webmcp-testing.
- <3 min YouTube demo video. First commit after 2026-08-25 (clean new-project provenance).

## Tech stack (1:1 with Kontier frontend for later integration)
- Next.js 16.1, React 19.2, TypeScript 5.9 (strict)
- Tailwind CSS 4, shadcn/ui, next-themes (dark default), @phosphor-icons/react
- recharts 3.8 for charts, zod 4 for schemas (zod v4 emits JSON Schema natively
  -> single source of truth for WebMCP inputSchema + runtime validation)
- zustand for the dashboard document store (undo/redo + attribution)
- DuckDB-WASM behind a DataSource adapter interface
- pnpm workspace monorepo

## Repo layout
```
kontier-ri/
├── apps/web/                # Next.js demo app = live URL for judges
├── packages/studio/         # canvas, tiles, WebMCP tools, undo/attribution
├── packages/datasource/     # DataSource interface + duckdb-wasm impl
├── spike/                   # WebMCP API spike artifacts (throwaway)
└── docs/                    # this plan, webmcp-api-notes.md, architecture
```

## DataSource interface (the Kontier integration seam)
```ts
interface DataSource {
  listDatasets(): Promise<DatasetMeta[]>;
  getSchema(dataset: string): Promise<ColumnMeta[]>;
  runQuery(sql: string): Promise<QueryResult>;    // read-only, row-capped
  profileColumn(dataset: string, column: string): Promise<ColumnProfile>;
  importFile?(file: File): Promise<DatasetMeta>;  // CSV/Parquet upload
}
```
Demo impl: DuckDB-WASM. Kontier impl later (private): Go analytics API adapter.

## Dashboard document model
Single JSON doc in zustand: `{ tiles: Tile[], filters: GlobalFilters, theme }`.
Tile = { id, type: 'kpi'|'chart'|'table'|'markdown', layout {x,y,w,h}, spec }.
chart spec: { dataset, sql or {dims, measures, aggs}, chartType: line|bar|area|pie, encoding, color }.
Every mutation goes through a command layer: { by: 'human'|'agent', label, undo() }.
-> activity feed, per-change undo, glow animation on agent-driven changes.
Persistence: localStorage + shareable URL (compressed state) + JSON export.

## WebMCP tools (~24, all zod-defined, registered via a useWebMCPTool hook)
Data: list_datasets, get_dataset_schema, profile_column, sample_rows,
      run_sql (read-only guard: reject non-SELECT, cap rows)
Build: add_tile, update_tile, move_tile, remove_tile (needs UI confirm),
       set_global_filter, set_date_range, set_theme, add_annotation
Context: get_dashboard_state, get_user_focus (selected tile, brushed range,
         hovered element), describe_tile, get_activity_log
Dynamic: when a tile is selected, register edit_selected_tile /
         restyle_selected_tile; unregister on deselect. (Spec leverage —
         tools mounted/unmounted by React component lifecycle.)
UX rules: agent edits animate with glow + attribution chip; agent must not
overwrite a property the human changed in the last N minutes unless user asks.

## Demo datasets (seeded, believable SaaS billing data)
1. `saas_billing`: ~24 months of invoices/subscriptions/customers/plans with
   MRR growth, a churn spike in one month (the "brush and ask why" moment —
   root cause: one plan's price increase), plan mix shift, FX/currency column.
2. `payments`: charges with gateway, failure codes, retries (dunning story).
Generated deterministically by a seed script into Parquet/CSV in apps/web/public/demo/.

## Milestones
- M1 (Sat): spike verified in Chrome flag + ChatGPT browser; scaffold builds;
  DuckDB loads demo CSV; agent can add_tile end-to-end.
- M2 (Sun): full toolset, dynamic tools, brush/get_user_focus, undo+attribution.
- M3 (Mon): polish, seeded datasets, deploy to Vercel, README + architecture.
- M4 (Tue): video + Devpost submission. Wed buffer.
