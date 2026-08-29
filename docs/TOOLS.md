# Kontier RI — WebMCP Tool Catalog (v1)

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

### Tile specs
- kpi: `{dataset, sql | {measure, agg}, format: 'currency'|'number'|'percent', compare?: 'prev_period'}`
- chart: `{dataset, query: {sql} | {dims: string[], measures: [{col, agg}], orderBy?, limit?}, chartType: 'line'|'bar'|'area'|'pie', stacked?, xKey, seriesKeys?, color?}`
- table: `{dataset, sql, pageSize<=25}`
- markdown: `{content}` (sanitized render)

## Group 3 — Context (read-only, the co-working glue)

| Tool | Returns |
|---|---|
| `get_dashboard_state` | full doc summary: title, theme, filters, tiles `[{tileId, type, title, specSummary, layout}]` — compact, no data |
| `get_user_focus` | `{selectedTileId?, brushedRange?: {tileId, from, to}, hoveredTileId?, recentHumanEdits: [{tileId, property, at}]}` — THE tool that lets the human point at things with the mouse and the agent understand |
| `describe_tile` | `{tileId}` -> spec + current rendered data summary (first rows/points, cap 50) |
| `get_activity_log` | last 30 commands `[{by, label, at, undone?}]` |

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
- markdown tile content sanitized (no raw HTML/script).
- remove_tile is undoable; no bulk-destructive tool exists at all.
- All schemas: `.strict()` — unknown keys rejected with a helpful error.

## Registration inventory (static, always on)
list_datasets, get_dataset_schema, profile_column, sample_rows, run_sql,
add_tile, update_tile, move_tile, remove_tile, set_global_filter,
clear_global_filters, set_date_range, set_theme, set_dashboard_title,
add_annotation, get_dashboard_state, get_user_focus, describe_tile,
get_activity_log  (19 static + 3 dynamic = 22)
