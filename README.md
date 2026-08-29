# Kontier RI — Revenue Intelligence Studio

**Build revenue dashboards *with* your AI agent — on the same canvas, at the
same time.** The page registers [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools, so a browser agent (ChatGPT in-app browser, Chrome 149+) gets real hands
inside the BI tool: it profiles your data, writes SQL, drafts tiles, drills
down. You drag, restyle, brush and steer. SQL runs locally via DuckDB-WASM —
**your raw data never leaves the browser.**

**Live demo:** <https://theemperor66.github.io/kontier-ri/>

![Kontier RI demo dashboard](docs/media/kri-demo2.png)

## What it is

BI tools are the canonical "deep UI" problem: dozens of menus, query builders,
chart editors. Agents guessing their way through that UI fail; a headless API
loses the human. WebMCP is the architecture where the agent operates the *same
live document* the human is looking at:

- **The agent has hands.** 19 static + 3 selection-scoped WebMCP tools:
  query datasets, add/edit/move tiles, set filters, annotate charts.
- **The human stays in control.** Every agent edit is attributed (tiles glow,
  activity feed), undoable (Cmd+Z works on agent commands), and guarded by a
  conflict rule: the agent may not overwrite anything you changed in the last
  10 minutes — it has to ask.
- **Your gestures are agent context.** Brush a revenue dip, ask "why?" — the
  agent reads your selection via `get_user_focus`, investigates with SQL, and
  answers with a drill-down tile + annotation next to the chart.

![Agent-built drill-down with attribution chips and annotation](docs/media/kri-glow.png)

### v2: a real BI workbench

![Growth drivers page — combo, donut, scatter with trendline, heatmap, calculated-field KPI](docs/media/kri-growth-drivers.png)
- **12 chart types** — line, bar, area, pie/donut, scatter, combo (dual axis), horizontal bar, stacked-100%, funnel, heatmap, radar — plus trendlines, reference lines and conditional-formatting rules
- **Cross-filtering** — click any bar/slice/point/cell and every tile filters; the agent sees it via `get_user_focus`
- **Calculated fields & SQL views** — define `arpu` once, use it everywhere; views appear as datasets
- **Pages, dashboards, templates** — multi-page docs, a local dashboard manager, 3 starter templates
- **⌘K command palette**, presentation mode, PNG/CSV export, share-URLs, autosave persistence
- **35 WebMCP tools** (32 static + 3 selection-scoped) — every one of these features is agent-operable

## 60-second quickstart

1. Open the live demo: **<https://theemperor66.github.io/kontier-ri/>**
   - **Chrome 149+:** enable `chrome://flags/#enable-webmcp-testing`, restart,
     then use an agent that speaks WebMCP (e.g. Chrome's built-in testing
     surface or an extension).
   - **ChatGPT in-app browser:** open the URL inside ChatGPT and chat — the
     page's tools appear to the agent automatically.
2. Click **Load demo dashboard** (24 months of synthetic SaaS billing data),
   or upload your own CSV/Parquet.
3. Ask the agent things like:
   - *"What datasets do you see? Profile them and build me a revenue dashboard."*
   - *"Why did churned subscriptions spike in March 2026? Drill down and annotate the chart."*
   - *"Add a KPI for failed payment volume this month."*
   - *"Switch the dashboard to a light theme and retitle it."*

No sign-up, no backend, no credentials — everything runs in the page.

## Tool catalog

35 tools, registered from the page via `document.modelContext`
(feature-detecting `navigator.modelContext`). Full contracts:
[docs/TOOLS.md](docs/TOOLS.md).

| Group | Tools | Notes |
|---|---|---|
| Data (read-only) | `list_datasets`, `get_dataset_schema`, `profile_column`, `sample_rows`, `run_sql` | SELECT-only guard, row caps; DuckDB SQL dialect |
| Dashboard build (mutating) | `add_tile`, `update_tile`, `move_tile`, `remove_tile`, `set_global_filter`, `clear_global_filters`, `set_date_range`, `set_theme`, `set_dashboard_title`, `add_annotation` | all routed through the command layer: attributed, undoable, conflict-checked |
| Context (read-only) | `get_dashboard_state`, `get_user_focus`, `describe_tile`, `get_activity_log` | `get_user_focus` exposes selection + brushed chart ranges |
| Selection-scoped (dynamic) | `edit_selected_tile`, `restyle_selected_tile`, `explain_selected_tile` | mounted/unmounted by React lifecycle while a tile is selected |

## Architecture

```
kontier-ri/
├── apps/web/            # Next.js 16 studio app (the live URL)
├── packages/studio/     # dashboard store, tiles, WebMCP tools + hook
├── packages/datasource/ # DataSource interface + DuckDB-WASM implementation
├── scripts/             # demo-data seeder (deterministic synthetic billing)
└── docs/                # plan, tool catalog, WebMCP API notes
```

- **DataSource seam.** Everything queries a small `DataSource` interface
  (`listDatasets`, `getSchema`, `runQuery`, `profileColumn`, `importFile`).
  The demo binds DuckDB-WASM; a SaaS can bind its analytics API instead
  without touching the studio.
- **One schema, twice used.** Every tool input is a zod v4 schema:
  `z.toJSONSchema()` produces the WebMCP `inputSchema`, `safeParse`
  re-validates the same shape at execute time. No drift possible.
- **Dynamic tools from component lifecycle.** `useWebMCPTool` registers on
  mount and unregisters via `AbortController` on unmount — so selecting a tile
  literally changes the agent's toolset.
- **Conflict rule.** The store tracks recent human edits per property; a
  mutating tool that would overwrite one returns a conflict notice (the agent
  must ask or pass `force: true`), keeping the human authoritative.
- **Self-hosted engine.** duckdb-wasm bundles are copied into `public/duckdb/`
  at build time and served same-origin (CDN only as fallback).

## How the WebMCP integration works

Every tool is registered from the page via the standard WebMCP entry point:

```ts
document.modelContext.registerTool(
  {
    name: "add_tile",
    description: "Add a KPI, chart, table or markdown tile to the dashboard",
    inputSchema: z.toJSONSchema(addTileInput), // zod v4 — one schema for validation + protocol
    annotations: { readOnlyHint: false },
    execute: async (input, options) => addTileFromAgent(input, options?.signal),
  },
  { signal: controller.signal }, // AbortController -> unregister on React unmount
);
```

In practice that call lives behind our `useWebMCPTool` React hook
(`packages/studio/src/webmcp/useWebMCPTool.ts`): tools mount with components,
re-validate input with the same zod schema that produced the JSON Schema, and
unregister via `AbortController` — which is how the three selection-scoped
tools appear only while a tile is selected (32 → 35 tools live).

## Privacy

All SQL executes in a DuckDB-WASM instance inside your tab. Uploaded files are
registered in-memory in the browser. There is no backend, no telemetry, and no
data upload; an agent only ever sees the row-capped aggregates it explicitly
queries through the tools.

## Why AGPL-3.0

The same license family as Grafana and Metabase's core: free to use, study,
modify and self-host; if you offer a modified version as a network service,
you share your changes under the same terms. That keeps an analytics studio —
software that typically runs as a service — honestly open.

### Trademark

The **"Kontier" name and logo are trademarks of the project owner** and are
used here with permission. The AGPL-3.0 license covers the code, not the
brand: forks and redistributions must not use the Kontier name or logo in a
way that suggests endorsement or origin.

## Built by a billing SaaS team

We build [Kontier](https://kontier.eu), a billing/subscription SaaS. Kontier RI
is our take on the analytics engine we want inside our own product: the
`DataSource` seam exists precisely so this studio can later bind to a
production billing API instead of in-browser CSVs. This is not a toy — it is
the roadmap.

## Development

```bash
pnpm install
pnpm dev                    # studio at http://localhost:3000
pnpm -r build               # build all packages + the app
pnpm -r test                # vitest (packages) — studio store/schemas/tools
pnpm --filter web test:e2e  # Playwright smoke tests (starts its own server)
pnpm seed                   # regenerate the demo CSVs deterministically
```

Deploys: pushing to `main` builds a static export (`NEXT_OUTPUT=export`,
basePath `/kontier-ri`) and publishes it to GitHub Pages via
`.github/workflows/deploy.yml`. A root-path deploy (e.g. Vercel) needs no env
at all.

See [docs/PLAN.md](docs/PLAN.md) for the full design and roadmap, and
[docs/webmcp-api-notes.md](docs/webmcp-api-notes.md) for WebMCP API findings.
