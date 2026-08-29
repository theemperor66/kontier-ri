# PLAN v2 — From demo to Tableau/Power BI rival

Mission: Kontier RI must feel like a real BI product, not a hackathon demo.
Every feature ships agent-operable (a WebMCP tool) AND human-operable (UI).
Feature freeze: Tue Sep 2, 18:00 CEST (then video + submission refresh).

## P0 feature matrix (build now)

### A. Analytics engine (packages/studio + datasource)
- Calculated fields: named SQL expressions per dataset (e.g. arpu = sum(amount)/count(distinct customer_id)); usable in tile specs; tool `create_calculated_field`, `list_calculated_fields`, `remove_calculated_field`.
- SQL views: `create_view(name, sql)` -> appears as dataset (DuckDB CREATE VIEW; read-only guard; persisted in doc). Tools: create_view/remove_view.
- Cross-filtering: clicking a bar/slice/point/cell emits {column, value} -> store crossFilter; all other tiles apply it (visual chip + per-tile opt-out). Tools: `set_cross_filter`, `clear_cross_filter`; get_user_focus reports it.
- Tile-level filters: spec.filters[] (same op grammar as global). update_tile handles.
- Pages: doc.pages[] (id, name, tiles[]) replacing single tile list — migration: v1 docs load as one page. Tools: add_page/rename_page/remove_page/switch_page; get_dashboard_state pages-aware.
- Sort/topN in structured queries: orderBy + limit + othersBucket ('group remaining into Other').
- Export data: `export_tile_data(tileId)` tool + UI button -> CSV download client-side.

### B. Visualization (apps/web/components/canvas)
- New chart types (recharts): scatter, combo (bars+line, dual axis), donut, horizontal bar, stacked-100%, funnel, heatmap (CSS grid custom), radar. Target: 12+ total incl. existing line/bar/area/pie.
- Axis/number formatting: currency/percent/compact per axis + per KPI (formatValue util shared).
- Trendline (linear regression, dashed) + reference line (y=value) via spec.analytics.
- Conditional formatting: KPI + table cells + bar colors by threshold rules spec.format.rules [{op, value, color}].
- Tile polish: legend toggle, empty/error states per tile, loading shimmer.

### C. Product shell (apps/web/components/chrome + app/)
- Dashboard manager: multiple named dashboards in localStorage + tabs bar + create/duplicate/delete/rename; JSON import/export buttons.
- Templates gallery: 3 templates (Revenue overview, Churn & retention, Payments ops) instantiated from demo data; empty-state entry.
- Command palette (cmd+K, cmdk lib): every human action + 'copy prompt for agent' entries.
- Export: dashboard/tile PNG (html-to-image), tile CSV.
- Presentation mode (hide chrome, F key).
- Cross-filter + page UX: chips row, page tabs, opt-out toggle in tile menu.

## New tools inventory (target ~35 total; all zod .strict(), docs/TOOLS.md updated)
Existing 22 + create_calculated_field, list_calculated_fields, remove_calculated_field,
create_view, remove_view, set_cross_filter, clear_cross_filter, add_page,
rename_page, remove_page, switch_page, export_tile_data, set_tile_filters,
(+ extend update_tile/add_tile specs for new chart types & analytics & format rules).

## Worker split (shared checkout — rebase discipline, disjoint paths)
- studio-v2 (A): packages/studio types/schemas/store/tools + datasource views + tests. COMMITS THE TYPES/STORE CONTRACT FIRST (within ~40 min), then tools.
- viz-v2 (B): apps/web/components/canvas/** renderers (depends on A types; starts with formatValue util + chart components on mock specs).
- shell-v2 (C): apps/web/components/chrome/**, app/**, lib/** (dashboard manager, palette, templates, export UI, presentation; starts with manager/palette skeleton on current store, adapts to A pages contract).
Integration+QA pass by orchestrator after A+B+C. e2e extended: cross-filter flow, page switch, new chart render, palette open.

## Non-negotiables
- No regression: 109 unit + 3 e2e stay green; migration keeps old share-URLs/localStorage loading.
- ChatGPT-browser constraints respected (top-level registration; compact results).
- docs/TOOLS.md + README feature list updated; demo dashboard upgraded to show off
  cross-filter + new charts; hero/og regenerated; SUBMISSION.md capability list refreshed.
