# Kontier RI — WebMCP Tool Catalog

**40 static tools + 3 selection-scoped + 2 proposal-scoped + 1 decision-scoped
= up to 46 registered.** The static 40 are always on. The other bundles mount
and unmount with the state of the work (see "Phase-scoped tool bundles").

Single source of truth for every tool the page registers. Implementation rules:

- All tools registered via `useWebMCPTool` (see `spike/react-hook.md`): zod v4
  schema -> `z.toJSONSchema()` for `inputSchema`, `safeParse` re-validation in
  `execute`, AbortController unregistration on unmount.
- Entry point `document.modelContext` (feature-detect `navigator.modelContext`
  fallback). Register only from the top-level page (ChatGPT constraint). If the
  host injects `modelContext` after hydration, the hook re-checks once per
  second and registers on the first real attempt.
- Every READ tool carries `annotations: {readOnlyHint: true,
  untrustedContentHint: true}`. Read results can echo dataset names, cell
  values, dashboard copy and human-written notes, so a capable host keeps that
  content out of instruction authority while still using it as data.
- Registration health is reported per tool (`unavailable`, `registering`,
  `ready`, `failed`, `unregistered`). The UI shows "Agent ready" only when
  every expected tool reported `ready`, and "Agent setup issue" with the error
  text otherwise.
- Every mutating tool routes through the command layer (`by: 'agent'`), so it is
  undoable, attributed, glow-animated, and logged in the activity feed.
- Every mutating tool RESPECTS human edits: if the human changed a property in
  the last 10 min, tools must not overwrite it unless `force: true` is passed
  (tool returns a conflict notice telling the agent to ask the user).
- Tool results are compact JSON objects (stringified by the browser). Row caps
  everywhere; never return raw datasets.
- Naming: `[a-z0-9_]`, verb_noun, stable across releases.
- The toolbelt is adaptive: 40 static tools are always registered, and three
  small bundles mount only while their work state exists (tile selected,
  change set awaiting review, decision unanswered). See Group 8.

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

Start a session with `get_work_context` (Group 7). These tools stay useful for
narrower reads once the agent is oriented.

| Tool | Returns |
|---|---|
| `get_dashboard_state` | full doc summary: title, theme, filters, crossFilter?, activePageId, pages `[{pageId, name, tileCount, active?}]`, calculatedFields?, views?, tiles of the ACTIVE page `[{tileId, type, title, specSummary, layout}]` — compact, no data |
| `get_user_focus` | `{activePage: {pageId, name}, crossFilter?, selectedTileId?, brushedRange?: {tileId, from, to}, hoveredTileId?, hoveredField?: {dataset, column, type?}, recentHumanEdits: [{tileId, property, at}]}` — THE tool that lets the human point at things with the mouse and the agent understand. `hoveredField` is the column the human is hovering, focusing or dragging in the data rail (⌘B); it is pure UI state — never undoable, never activity-logged, cleared on a document switch |
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

The first phase-scoped bundle; the proposal and decision bundles work the same
way (see Group 8). Mounted by the selection UI component; unregistered on
deselect (verified viable in Chrome; if ChatGPT browser chokes on
re-registration -> fallback: keep them always-registered and error 'no tile
selected'):

- `edit_selected_tile` `{patch}` — like update_tile without needing the id
- `restyle_selected_tile` `{color?, chartType?, stacked?}`
- `explain_selected_tile` `{}` — returns spec + data summary + what filters affect it

## Group 6 — Agent presence (ephemeral co-working state)

The presence layer renders ONLY from real tool calls (honesty rule: no
timers, no fake autonomy). Plan + insights are ephemeral: never in the undo
history, never persisted, cleared on dashboard switch — but every event is
activity-logged (`Agent shared a plan`, `Insight proposed/accepted/dismissed`).
Accepting an insight executes its `suggestedAction` through the EXISTING
command layer (origin `agent`): undoable, attributed, glow-pulsed, and the
neutral "Agent" cursor moves to the touched tile. WebMCP does not expose the
caller's identity, so the UI never names a specific assistant.

Plan calls also drive the work-session phase: a fresh plan moves a `ready`
session to `planning`, the first non-pending step moves it to `working`, and an
all-done plan moves it to `review`.

| Tool | Input | Notes |
|---|---|---|
| `present_plan` | `{title?, steps: [{label, status?}]}` | upserts the floating plan card; steps default `pending`, max 12 |
| `update_plan_step` | `{index, status: pending\|active\|done\|failed}` | 0-based; ticks the card; card auto-fades 10s after ALL steps are done |
| `propose_insight` | `{title, body, severity?: info\|warn\|critical, tileId?, suggestedAction?}` | renders an insight chip with Accept/Dismiss; returns `{insightId, state: 'proposed'}` — NOTHING is applied until the user clicks Accept |
| `clear_plan` | `{}` | removes the plan card |

`suggestedAction` (strictly validated, discriminated on `kind`):
`{kind: 'add_annotation'\|'add_tile'\|'set_filter', payload}` — payloads
match the corresponding tools (`add_annotation`, `add_tile`,
`set_global_filter`).

## Group 7 — Collaboration (work session, structured decisions, close-out)

The protocol that turns the dashboard into a shared work surface. A human
starts a work session by writing a brief in the agent panel; the agent reads
it, plans, asks, proposes, and closes. Session, plan and decisions are
ephemeral working state (not persisted, not in the undo stack); every event is
activity-logged.

Expected sequence:

```
get_work_context  ->  present_plan / update_plan_step  ->  [request_decision]
                  ->  propose_insight / propose_change_set (human approves)
                  ->  complete_work
```

| Tool | Input (zod) | Notes |
|---|---|---|
| `get_work_context` | `{}` | Read-only orientation call. MUST be first. Returns the live session, plan, pending reviews, ALL decisions and ALL change sets (so the human's verdicts are observable), human focus, recent actions and the working agreement |
| `request_decision` | `{question (1–300 chars), context (1–1200 chars), options: [{id (1–64), label (1–120), description? (1–400)}] (2–5, unique ids), recommendedOptionId?}` | `recommendedOptionId` must name one of the options. Returns `{decisionId, status: 'pending'}`. Sets the session phase to `review`. Rejected when the session is already `complete` |
| `complete_work` | `{summary (1–1200 chars), outcomes: string[] (max 20, each 1–300 chars)}` | Sets the session phase to `complete`, stores the summary and outcomes. Rejected when no session exists or the session is already complete |
| `propose_change_set` | `{title (1–120 chars), rationale (1–600 chars), actions: [{kind, payload, note? (1–200 chars)}] (1–8)}` | Stages RELATED edits as ONE reviewable set. NOTHING runs on propose. Returns `{changeSetId, status: 'proposed', actions: N}`. Sets the session phase to `review`. Rejected when the session is already `complete` |

`get_work_context` returns (no raw data anywhere):

| Field | Content |
|---|---|
| `session` | `{id, objective, phase, createdAt, updatedAt, completedAt?, summary?, outcomes[]}`; phase is `ready \| planning \| working \| review \| complete \| paused`. `null` when no brief exists |
| `plan` | the shared plan `{title?, steps: [{label, status}], updatedAt}` or `null` |
| `pendingReviews` | proposals still awaiting approval: `[{insightId, title, body, severity, tileId?, suggestedAction: {kind}?, at}]` |
| `decisions` | EVERY decision with its status and answer: `[{id, question, context, options, recommendedOptionId?, status, answer?: {optionId, note?}, createdAt, updatedAt}]` |
| `changeSets` | EVERY staged change set with the human's verdict: `[{changeSetId, title, rationale, status, actions: [{kind, note?}], appliedActionIndexes?, createdAt}]`. `status` is `proposed \| applied \| partially_applied \| rejected`. Payloads are omitted: the agent already knows what it proposed |
| `focus` | `{activePage: {pageId, name} \| null, selectedTileId, hoveredTileId, hoveredField, crossFilter, brushedRange, recentHumanEdits: [{tileId, property, at}]}`. `hoveredField` is `{dataset, column, type?}` from the data rail (⌘B) — the column the human is hovering, focusing or dragging |
| `recentActions` | the last 10 command-log entries `[{by, label, at, undone?}]` |
| `workingAgreement` | the four rules below, verbatim from the tool result |

Working agreement returned to the agent:

- `agentEdits`: "Agent dashboard edits are attributed and undoable."
- `recentHumanEdits`: "Human edits from the last 10 minutes are protected from
  silent overwrite."
- `rawData`: "Raw data stays local in the browser."
- `uncertainOrHighImpactChanges`: "Use request_decision or propose_insight
  before applying uncertain or high-impact changes."

Decision answers: the human picks one option in the Approvals view or the agent
panel and may attach a note (max 600 chars). The store records
`{status: 'answered', answer: {optionId, note?}}` and logs the choice as a human
action. The agent sees it on its next `get_work_context` read; there is no push
channel. Answering the last pending decision recomputes the session phase from
the live plan and review queue: it stays `review` while proposals wait, and
otherwise returns to `working`, `planning` or `ready`.

### Staged change sets (`propose_change_set`)

One change set holds 1 to 8 staged actions (`MAX_CHANGE_ACTIONS = 8`). The
store keeps the last 10 change sets (`MAX_CHANGE_SETS = 10`, oldest dropped).

`kind` is one of `add_tile | update_tile | remove_tile | add_annotation |
set_filter | set_tile_filters`. Each `payload` matches the tool of the same
name (`set_filter` matches `set_global_filter`). Each action takes an optional
`note` (1–200 chars) shown next to its diff row.

Validation at propose time (nothing is executed):

- `.strict()` zod on every action; `set_tile_filters` accepts at most 10
  filters; `update_tile` rejects an empty patch.
- No duplicate rows, and no edit to a tile the same set removes earlier.
- Unknown `tileId` is rejected with a hint to call `get_dashboard_state`.
- `update_tile` specs are checked against the target tile's per-type schema.
- `set_tile_filters` on a markdown tile is rejected.

Review and apply (human side, no agent tool):

- The review card lists every action as a diff row. The human can skip
  individual rows and then approve the rest.
- Approving runs the kept actions through the NORMAL command layer
  (origin `agent`, `force: true` because the human just approved them), then
  collapses the result into ONE undo entry and ONE activity entry
  (`Applied change set: “…” (N changes)`). One Cmd+Z reverts the whole set.
- All rows kept -> status `applied`. Some rows skipped -> status
  `partially_applied`, with `appliedActionIndexes` recording what ran.
- Rejecting sets status `rejected`; skipping every row is refused ("reject the
  change set instead").
- If an action fails mid-apply, the store restores the exact pre-apply
  snapshot — document AND history (undo stack, redo stack, activity log,
  recent human edits, selection, brush) — the set stays `proposed`, and the
  tool result names the failing index and reason.
- The agent reads the verdict from `get_work_context.changeSets`. There is no
  push channel.

## Group 8 — Phase-scoped tool bundles (the adaptive toolbelt)

The toolbelt is not one flat catalog. Three bundles mount and unmount with the
state of the work, so the names the agent can see describe what it can do NOW.
Each bundle is a React component: mounting registers its tools, unmounting
unregisters them through the `AbortController` in `useWebMCPTool`. Descriptions
are rebuilt on every mount and name the live ids and titles, so the agent never
has to guess which set or question it is acting on.

| Bundle | Registered while | Tools | Component |
|---|---|---|---|
| Selection-scoped (3) | a tile is selected (`selectedTileId` resolves to a tile) | `edit_selected_tile`, `restyle_selected_tile`, `explain_selected_tile` | `SelectedTileTools` |
| Proposal-scoped (2) | at least one change set has status `proposed` | `revise_change_set`, `withdraw_change_set` | `ProposalScopedTools` |
| Decision-scoped (1) | at least one decision has status `pending` | `withdraw_decision` | `DecisionScopedTools` |

Sources: `packages/studio/src/webmcp/SelectedTileTools.tsx` and
`packages/studio/src/webmcp/PhaseScopedTools.tsx`; the builders are
`buildSelectedTileTools`, `buildProposalTools` and `buildDecisionTools` in
`packages/studio/src/webmcp/tools.ts`.

| Tool | Input (zod) | Ack shape |
|---|---|---|
| `revise_change_set` | `{changeSetId, title? (1–120), rationale? (1–600), actions? (1–8, same shape as propose_change_set)}` — at least one field required; `actions` REPLACES the staged list | `{ok: true, changeSetId, status: 'proposed', actions?: N}` (`actions` only when the list was replaced) |
| `withdraw_change_set` | `{changeSetId}` | `{ok: true, changeSetId, status: 'withdrawn'}` — the set leaves the review queue |
| `withdraw_decision` | `{decisionId}` | `{ok: true, decisionId, status: 'withdrawn'}` — the question leaves the review queue |

Rules:

- Both change-set tools fail once the set is `applied`, `partially_applied` or
  `rejected`; `withdraw_decision` fails once the human answered or dismissed
  the question. Failures return `{error}` with the reason.
- Revising is the correct answer to human feedback on a proposal. Do not
  propose a second set for the same work.
- Withdrawing removes the item; it is for questions and proposals the agent's
  own later work made unnecessary.
- Withdrawing or settling the last pending item recomputes the session phase
  from the live plan and review queue (`review` while work still waits,
  otherwise back to `working`, `planning` or `ready`).
- Emptying a queue unmounts its bundle, so the tools disappear from the
  agent's list on its next read.

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
get_activity_log, present_plan, update_plan_step, propose_insight,
clear_plan, get_work_context, request_decision, complete_work,
propose_change_set
**(40 static)**

Phase-scoped bundles, on top of the static 40:

| Bundle | Names | Count | Trigger |
|---|---|---|---|
| Selection | edit_selected_tile, restyle_selected_tile, explain_selected_tile | 3 | a tile is selected |
| Proposal | revise_change_set, withdraw_change_set | 2 | a change set is `proposed` |
| Decision | withdraw_decision | 1 | a decision is `pending` |

40 static, 43 with a selection, and **46 at the maximum** (selection + a
pending change set + a pending decision). The source of truth is
`STATIC_TOOL_NAMES`, `DYNAMIC_TOOL_NAMES`, `PROPOSAL_TOOL_NAMES` and
`DECISION_TOOL_NAMES` in `packages/studio/src/webmcp/tools.ts`; the status pill
compares live registration results against those lists.

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
