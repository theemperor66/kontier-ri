# Kontier RI — WebMCP Tool Catalog (v2)

Single source of truth for every tool the page registers. Implementation rules:

- All tools registered via `useWebMCPTool` (see `spike/react-hook.md`): zod v4
  schema -> `z.toJSONSchema()` for `inputSchema`, `safeParse` re-validation in
  `execute`, AbortController unregistration on unmount.
- Entry point `document.modelContext` (feature-detect `navigator.modelContext`
  fallback). Register only from the top-level page (ChatGPT constraint).
- Every mutating tool routes through the command layer (`by: 'agent'`), so it is
  undoable, attributed, glow-animated, and logged in the activity feed.
- Every mutating tool RESPECTS human edits: if the human changed a property in
  the last 10 min, tools must not overwrite it unless `force: true` is passed
  (tool returns a conflict notice telling the agent to ask the user).
- Tool results are compact JSON objects (stringified by the browser). Row caps
  everywhere; never return raw datasets.
- Naming: `[a-z0-9_]`, verb_noun, stable across releases.

## Group 1 — Data (read-only)

| Tool | Input | Returns |
|---|---|---|
| `list_datasets` | `{}` | `[{name, rowCount, description}]` |
| `get_dataset_schema` | `{dataset}` | `[{column, type, description?}]` |
| `profile_column` | `{dataset, column}` | count, nulls, distinct, min/max, top-8 values w/ freq, (numeric) mean/p50 |
| `sample_rows` | `{dataset, limit<=20}` | first N rows, stringified values truncated to 120 chars |
| `run_sql` | `{sql, limit<=500}` | `{columns, rows, rowCount, truncated}` — SELECT-only guard, row cap. DuckDB SQL dialect. Errors return `{error, hint}` |

## Group 2 — Dashboard build (mutating, command-layer)

| Tool | Input (zod sketch) | Notes |
|---|---|---|
| `add_tile` | `{type: 'kpi'|'chart'|'table'|'markdown', title, spec, layout?}` | spec is per-type (below). Auto-layout if omitted. Returns `{tileId}` |
| `update_tile` | `{tileId, patch}` | shallow-merge patch of title/spec; conflict rule applies per property |
| `move_tile` | `{tileId, x, y, w, h}` | grid units, 12-col grid |
| `remove_tile` | `{tileId}` | soft: tile animates out, 10s undo toast; returns `{removed: true, undoHint}` |
| `set_global_filter` | `{column, op: 'eq'|'in'|'between'|'contains', value}` | applied to all tiles whose dataset has the column |
| `clear_global_filters` | `{}` | |
| `set_date_range` | `{from, to}` (ISO dates) | the global time brush |
| `set_theme` | `{palette?: name|string[], mode?: 'dark'|'light'}` | |
| `set_dashboard_title` | `{title}` | |
| `add_annotation` | `{tileId, text, anchor?: {x?, seriesKey?}}` | callout pinned to a chart |

### Tile specs (v2)
- kpi: `{dataset, sql | {measure, agg}, format: 'currency'|'number'|'percent' | {style, currency?}, compare?: 'prev_period', filters?, rules?}`
- chart: `{dataset, query: {sql} | {dims: string[], measures: [{col, agg}], orderBy?, limit?, othersBucket?}, chartType: <12 types below>, stacked?, xKey, seriesKeys?, yKey?, series?: [{key, type?: 'bar'|'line', axis?: 'left'|'right'}], legend?, color?, filters?, analytics?, format?}`
- table: `{dataset, sql, pageSize<=25, filters?, format?}`
- markdown: `{content}` (sanitized render)

Shared v2 spec fragments:
- chartType: `line | bar | area | pie | scatter | combo | donut | hbar | stacked100 | funnel | heatmap | radar` (heatmap: dims `[xKey, yKey]` + 1 measure; combo: per-series config via `series`)
- `filters`: tile-scoped `[{column, op: eq|in|between|contains, value}]`, ANDed with the global filters (also settable via `set_tile_filters`)
- `analytics`: `{trendline?: boolean, referenceLine?: {value, label?, color?}}`
- `format`: `{value?: 'currency'|'number'|'percent'|'compact' | {style, currency?}, y2?: same, rules?: [{op: lt|lte|gt|gte|eq, value, color}]}` (first matching rule wins)
- `othersBucket` (needs `limit`, exactly 1 dim): keep the top-`limit` groups by the first measure and collapse the rest into an `'Other'` row
- measure `col` / dim names may reference calculated fields (expanded into SQL; aggregate-kind fields alias by field name)

## Group 3 — Context (read-only, the co-working glue)

| Tool | Returns |
|---|---|
| `get_dashboard_state` | full doc summary: title, theme, filters, crossFilter?, activePageId, pages `[{pageId, name, tileCount, active?}]`, calculatedFields?, views?, tiles of the ACTIVE page `[{tileId, type, title, specSummary, layout}]` — compact, no data |
| `get_user_focus` | `{activePage: {pageId, name}, crossFilter?, selectedTileId?, brushedRange?: {tileId, from, to}, hoveredTileId?, recentHumanEdits: [{tileId, property, at}]}` — THE tool that lets the human point at things with the mouse and the agent understand |
| `describe_tile` | `{tileId}` -> spec + current rendered data summary (first rows/points, cap 50) |
| `get_activity_log` | last 30 commands `[{by, label, at, undone?}]` |

## Group 5 — Pages / cross-filter / calculated fields / views (v2)

All mutating tools here go through the command layer: undoable, attributed,
activity-logged. Page/tile lookups work across ALL pages.

| Tool | Input | Notes |
|---|---|---|
| `add_page` | `{name}` | creates an empty page AND switches to it; returns `{pageId}` |
| `rename_page` | `{pageId, name}` | conflict rule applies (`force` to override) |
| `remove_page` | `{pageId}` | removes the page and its tiles; refuses the last page; undoable |
| `switch_page` | `{pageId}` | `get_dashboard_state.tiles` always shows the ACTIVE page |
| `set_cross_filter` | `{column, value, sourceTileId?}` | like clicking a bar/slice: all tiles except the source (and `ignoreCrossFilter` tiles) filter to column = value |
| `clear_cross_filter` | `{}` | removes the click-to-filter chip |
| `set_tile_filters` | `{tileId, filters[]}` | replaces the tile's own filters; `[]` clears; not for markdown |
| `create_calculated_field` | `{name, dataset, expression, description?}` | named SQL expression; probed against the dataset before saving; kind auto-detected (`aggregate` used verbatim as measure, `row` wrapped by the agg) |
| `list_calculated_fields` | `{}` | `[{name, dataset, expression, kind}]` |
| `remove_calculated_field` | `{name}` | undoable |
| `create_view` | `{name, sql, description?}` | SELECT-only body (read-only guard), name auto-namespaced `view_*`; appears in `list_datasets` (group `views`); persisted in the doc |
| `remove_view` | `{name}` | accepts prefixed or unprefixed name |
| `export_tile_data` | `{tileId, limit<=1000}` | tile's CURRENT data (all filters applied) as `{csv, rowCount, truncated}` |

## Group 4 — Dynamic (registered only while a tile is selected)

Mounted by the selection UI component; unregistered on deselect (verified viable
in Chrome; if ChatGPT browser chokes on re-registration -> fallback: keep them
always-registered and error 'no tile selected'):

- `edit_selected_tile` `{patch}` — like update_tile without needing the id
- `restyle_selected_tile` `{color?, chartType?, stacked?}`
- `explain_selected_tile` `{}` — returns spec + data summary + what filters affect it

## Safety / guard rails
- run_sql: strip comments, single statement, must parse as SELECT (reject
  ATTACH/COPY/PRAGMA/INSTALL etc.), enforce LIMIT, 5s query timeout.
- create_view bodies pass the stricter `assertSelectOnly` guard (must BE a
  query — DESCRIBE/SHOW rejected); calculated-field expressions reject `;`
  and mutating keywords, and are probed against the dataset before saving.
- markdown tile content sanitized (no raw HTML/script).
- remove_tile is undoable; no bulk-destructive tool exists at all.
- All schemas: `.strict()` — unknown keys rejected with a helpful error.

## Registration inventory (static, always on)
list_datasets, get_dataset_schema, profile_column, sample_rows, run_sql,
add_tile, update_tile, move_tile, remove_tile, set_global_filter,
clear_global_filters, set_date_range, set_theme, set_dashboard_title,
add_annotation, set_tile_filters, set_cross_filter, clear_cross_filter,
add_page, rename_page, remove_page, switch_page, create_calculated_field,
list_calculated_fields, remove_calculated_field, create_view, remove_view,
get_dashboard_state, get_user_focus, describe_tile, export_tile_data,
get_activity_log  (32 static + 3 dynamic = 35)

## Doc model notes (v2)
- The doc has `pages[]` (`{id, name, tiles}`) + `activePageId`; `doc.tiles`
  mirrors the ACTIVE page's tiles for v1 consumers. v1 docs (flat `tiles[]`)
  migrate on load into a single "Overview" page — old share URLs and
  localStorage docs keep working.
- `describe_tile` / `explain_selected_tile` / `export_tile_data` run the tile
  query through the single SQL authority (`buildTileQuery`): global filters +
  date range (schema-verified), tile filters, cross-filter and calculated
  fields are all applied, with a graceful unfiltered fallback.
- Views live in DuckDB (engine) AND `doc.views` (persistence); calculated
  fields live in `doc.calculatedFields`.
