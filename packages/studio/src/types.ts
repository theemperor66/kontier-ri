/**
 * Dashboard document model + store contract types for Kontier RI studio.
 * Single source of truth for the tile/document shapes in docs/TOOLS.md.
 *
 * v2 doc shape (PLAN-V2 section A): pages[], crossFilter, calculatedFields,
 * views. v1 docs (flat tiles[]) are migrated on load — see migrate.ts.
 */

export type Origin = "human" | "agent";

export type TileType = "kpi" | "chart" | "table" | "markdown";
export type ChartType =
  | "line"
  | "bar"
  | "area"
  | "pie"
  | "scatter"
  | "combo"
  | "donut"
  | "hbar"
  | "stacked100"
  | "funnel"
  | "heatmap"
  | "radar";
export type Agg =
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "count"
  | "count_distinct"
  | "median";
export type KpiFormat = "currency" | "number" | "percent";
export type FilterOp = "eq" | "in" | "between" | "contains";

/** Number/axis formatting for chart axes, table cells and KPI values. */
export type ValueFormat = "currency" | "number" | "percent" | "compact";

/** 12-column grid (docs/TOOLS.md move_tile). */
export const GRID_COLUMNS = 12;

/** Current document version (see migrateDoc). v1 docs have no version. */
export const DOC_VERSION = 2;

export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Tile-level filters / analytics / formatting (PLAN-V2)
// ---------------------------------------------------------------------------

/** Tile-scoped filter — same op grammar as GlobalFilter. */
export interface TileFilter {
  column: string;
  op: FilterOp;
  value: unknown;
}

/** Reference line at value (y for vertical charts, x for hbar). */
export interface ReferenceLine {
  value: number;
  label?: string;
  color?: string;
}

export interface TileAnalytics {
  /** Linear-regression trendline over the first series (dashed). */
  trendline?: boolean;
  referenceLine?: ReferenceLine;
}

/** Conditional formatting rule: when `<cell> <op> value`, apply color. */
export interface FormatRule {
  op: "lt" | "lte" | "gt" | "gte" | "eq";
  value: number;
  color: string;
}

/** Object form of a value format (currency override etc.). */
export interface ValueFormatOptions {
  style: ValueFormat;
  /** ISO 4217, default "EUR". */
  currency?: string;
}

export interface TileFormat {
  /** Number format for the primary value axis / numeric cells. */
  value?: ValueFormat | ValueFormatOptions;
  /** Number format for the secondary (right) axis of combo charts. */
  y2?: ValueFormat | ValueFormatOptions;
  /** Conditional formatting rules (first matching rule wins). */
  rules?: FormatRule[];
}

// ---------------------------------------------------------------------------
// Tile specs
// ---------------------------------------------------------------------------

/** kpi: `{dataset, sql | {measure, agg}, format, compare?}` */
export interface KpiSpec {
  dataset: string;
  sql?: string;
  measure?: string;
  agg?: Agg;
  /** Legacy string format still accepted; object form adds currency. */
  format: KpiFormat | ValueFormatOptions;
  compare?: "prev_period";
  /** Tile-scoped filters (ANDed with global filters). */
  filters?: TileFilter[];
  /** Conditional formatting for the KPI value. */
  rules?: FormatRule[];
}

export interface ChartMeasure {
  col: string;
  agg: Agg;
}

export interface ChartQuerySQL {
  sql: string;
}

/** Combo chart per-series rendering config. */
export interface SeriesConfig {
  key: string;
  type?: "bar" | "line";
  axis?: "left" | "right";
}

export interface ChartQueryDims {
  dims: string[];
  measures: ChartMeasure[];
  orderBy?: string;
  limit?: number;
  /**
   * With `limit`: keep the top-`limit` groups (by the first measure, desc)
   * and collapse the remaining groups into an "Other" row. Single-dim only.
   */
  othersBucket?: boolean;
}

export type ChartQuery = ChartQuerySQL | ChartQueryDims;

export interface ChartSpec {
  dataset: string;
  query: ChartQuery;
  chartType: ChartType;
  stacked?: boolean;
  /** Column/dim used for the x axis. */
  xKey: string;
  /** Measure aliases / columns plotted as series. */
  seriesKeys?: string[];
  /**
   * Heatmap second dim (row axis); scatter y column when query is raw SQL.
   * Heatmap structured queries use dims: [xKey, yKey] + 1 measure.
   */
  yKey?: string;
  /**
   * Per-series config for combo charts. Default when omitted:
   * first series bar-left, remaining series line-left.
   */
  series?: SeriesConfig[];
  /** Show the legend (default false). */
  legend?: boolean;
  color?: string;
  /** Tile-scoped filters (ANDed with global filters). */
  filters?: TileFilter[];
  analytics?: TileAnalytics;
  format?: TileFormat;
}

export interface TableSpec {
  dataset: string;
  sql: string;
  /** <= 25 */
  pageSize?: number;
  /** Tile-scoped filters (ANDed with global filters). */
  filters?: TileFilter[];
  format?: TileFormat;
}

export interface MarkdownSpec {
  /** Markdown source; raw HTML is stripped before storage AND at render. */
  content: string;
}

export interface TileSpecByType {
  kpi: KpiSpec;
  chart: ChartSpec;
  table: TableSpec;
  markdown: MarkdownSpec;
}

export type TileSpec = KpiSpec | ChartSpec | TableSpec | MarkdownSpec;

export interface Annotation {
  id: string;
  text: string;
  anchor?: { x?: string | number; seriesKey?: string };
  by: Origin;
  /** epoch ms */
  at: number;
}

export interface Tile {
  id: string;
  type: TileType;
  title: string;
  layout: TileLayout;
  spec: TileSpec;
  annotations: Annotation[];
  /** Per-tile cross-filter opt-out (tile menu toggle). */
  ignoreCrossFilter?: boolean;
}

// ---------------------------------------------------------------------------
// Pages / cross-filter / calculated fields / views (v2)
// ---------------------------------------------------------------------------

export interface Page {
  id: string;
  name: string;
  tiles: Tile[];
}

/**
 * Click-to-filter state: clicking a bar/slice/point/cell emits
 * {column, value}; every other tile applies it (unless opted out).
 */
export interface CrossFilter {
  column: string;
  value: string | number | boolean;
  /** Tile the click originated from (exempt from the filter). */
  sourceTileId?: string;
}

/**
 * Named SQL expression scoped to one dataset, usable in structured tile
 * queries (dims / measure cols / kpi measure). `kind` is auto-detected at
 * creation: "aggregate" expressions (contain sum/avg/count/...) are used
 * verbatim as measures; "row" expressions are wrapped by the measure agg.
 */
export interface CalculatedField {
  /** Identifier ([a-zA-Z_][a-zA-Z0-9_]*), unique across the doc. */
  name: string;
  dataset: string;
  /** SQL expression fragment, e.g. `sum(amount)/count(DISTINCT customer_id)`. */
  expression: string;
  kind: "row" | "aggregate";
  description?: string;
}

/** SQL view persisted in the doc and mirrored into DuckDB as `view_*`. */
export interface ViewDef {
  /** Always namespaced: starts with `view_`. */
  name: string;
  /** SELECT-only body (read-only guard applies). */
  sql: string;
  description?: string;
}

export interface GlobalFilter {
  column: string;
  op: FilterOp;
  value: unknown;
}

/** ISO dates (YYYY-MM-DD), the global time brush. */
export interface DateRange {
  from: string;
  to: string;
}

export interface GlobalFilters {
  filters: GlobalFilter[];
  dateRange: DateRange | null;
}

export interface ThemeSettings {
  /** Named palette or explicit color list. */
  palette?: string | string[];
  mode: "dark" | "light";
}

/**
 * The whole dashboard document — one JSON-serializable object.
 *
 * Invariant (maintained by the store): `tiles` mirrors the ACTIVE page's
 * tiles (same array reference). Legacy consumers keep reading `doc.tiles`;
 * page-aware consumers use `doc.pages` + `doc.activePageId`.
 */
export interface DashboardDoc {
  version: number;
  title: string;
  theme: ThemeSettings;
  filters: GlobalFilters;
  pages: Page[];
  activePageId: string;
  /** Mirror of the active page's tiles (back-compat seam for v1 consumers). */
  tiles: Tile[];
  crossFilter: CrossFilter | null;
  calculatedFields: CalculatedField[];
  views: ViewDef[];
}

/**
 * Any historical doc shape accepted by resetDashboard/migrateDoc:
 * v1 docs have only {title, theme, filters, tiles}.
 */
export interface DashboardDocInput {
  version?: number;
  title: string;
  theme: ThemeSettings;
  filters: GlobalFilters;
  tiles?: Tile[];
  pages?: Page[];
  activePageId?: string;
  crossFilter?: CrossFilter | null;
  calculatedFields?: CalculatedField[];
  views?: ViewDef[];
}

// ---------------------------------------------------------------------------
// Command layer / store contract
// ---------------------------------------------------------------------------

/** Every mutating store action carries attribution. */
export interface ActionMeta {
  origin: Origin;
  /** Human-readable label for the activity feed, e.g. `Added chart "MRR"`. */
  label: string;
  /**
   * Agent-only escape hatch: overwrite a property the human edited in the
   * last 10 minutes. Without it such mutations return a conflict result.
   */
  force?: boolean;
}

export interface ActionOk {
  ok: true;
  tileId?: string;
  pageId?: string;
  insightId?: string;
  sessionId?: string;
  decisionId?: string;
  changeSetId?: string;
}

export interface ActionConflict {
  ok: false;
  conflict: true;
  tileId?: string;
  /** The properties that the human recently edited. */
  properties: string[];
  hint: string;
}

export interface ActionFailure {
  ok: false;
  conflict?: false;
  error: string;
}

export type ActionResult = ActionOk | ActionConflict | ActionFailure;

/** Discriminated add-tile input (spec type must match tile type). */
export type AddTileInput = {
  [K in TileType]: {
    type: K;
    title: string;
    spec: TileSpecByType[K];
    layout?: TileLayout;
  };
}[TileType];

/** Shallow patch for update_tile; spec keys are merged into the tile spec. */
export interface TilePatch {
  title?: string;
  spec?: Record<string, unknown>;
}

export interface BrushedRange {
  tileId: string;
  from: string;
  to: string;
}

/**
 * A property the human touched recently. Dashboard-scoped edits (title,
 * theme, dateRange, filter:<column>) use tileId === DASHBOARD_SCOPE.
 */
export interface HumanEdit {
  tileId: string;
  property: string;
  /** epoch ms */
  at: number;
}

export interface ActivityEntry {
  id: string;
  by: Origin;
  label: string;
  /** epoch ms */
  at: number;
  undone: boolean;
}

// ---------------------------------------------------------------------------
// Collaboration presence — ephemeral human-agent co-working state.
// NOT part of DashboardDoc: never in undo history, never persisted, cleared
// on doc switch (resetDashboard). Changes ARE activity-logged.
// ---------------------------------------------------------------------------

export type PlanStepStatus = "pending" | "active" | "done" | "failed";

export interface PlanStep {
  label: string;
  status: PlanStepStatus;
}

/** The agent's shared working plan (rendered as the floating plan card). */
export interface AgentPlan {
  title?: string;
  steps: PlanStep[];
  /** epoch ms of the last present_plan / update_plan_step call. */
  updatedAt: number;
}

export type InsightSeverity = "info" | "warn" | "critical";
export type InsightState = "proposed" | "accepted" | "dismissed";

/**
 * Action executed through the EXISTING command layer (origin "agent",
 * undoable) when the user accepts an insight. Validated strictly against
 * schemas.suggestedActionSchema at propose time.
 */
export type SuggestedAction =
  | {
      kind: "add_annotation";
      payload: { tileId: string; text: string; anchor?: Annotation["anchor"] };
    }
  | { kind: "add_tile"; payload: AddTileInput }
  | { kind: "set_filter"; payload: GlobalFilter };

export interface Insight {
  id: string;
  title: string;
  body: string;
  severity: InsightSeverity;
  /** Tile the insight is about (must exist at propose time). */
  tileId?: string;
  suggestedAction?: SuggestedAction;
  state: InsightState;
  /** epoch ms */
  at: number;
}

export type WorkSessionPhase =
  | "ready"
  | "planning"
  | "working"
  | "review"
  | "complete"
  | "paused";

/** One ephemeral human-agent work session for the current dashboard. */
export interface WorkSession {
  id: string;
  objective: string;
  phase: WorkSessionPhase;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
  /** epoch ms; present only after completeWork. */
  completedAt?: number;
  summary?: string;
  outcomes: string[];
}

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
}

export interface DecisionAnswer {
  optionId: string;
  note?: string;
}

export type DecisionStatus = "pending" | "answered" | "dismissed";

/** A material ambiguity the agent has asked the human to resolve. */
export interface DecisionRequest {
  id: string;
  question: string;
  context: string;
  options: DecisionOption[];
  recommendedOptionId?: string;
  status: DecisionStatus;
  answer?: DecisionAnswer;
  /** epoch ms */
  createdAt: number;
  /** epoch ms; also records the answer/dismiss timestamp. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Change sets — reviewable MULTI-action proposals (Phase B).
// A single insight proposes one action; a change set groups 1..8 related
// edits behind ONE human review. Applying runs every selected action
// through the normal command layer, then collapses them into ONE undo step.
// ---------------------------------------------------------------------------

/**
 * One staged edit inside a change set. Payloads mirror the corresponding
 * tools (add_tile, update_tile, remove_tile, add_annotation,
 * set_global_filter, set_tile_filters) and are validated strictly at
 * propose time — nothing runs until the human approves.
 */
export type ChangeAction = {
  /** Short reason for THIS single edit (shown next to the diff row). */
  note?: string;
} & (
  | { kind: "add_tile"; payload: AddTileInput }
  | { kind: "update_tile"; payload: { tileId: string; patch: TilePatch } }
  | { kind: "remove_tile"; payload: { tileId: string } }
  | {
      kind: "add_annotation";
      payload: { tileId: string; text: string; anchor?: Annotation["anchor"] };
    }
  | { kind: "set_filter"; payload: GlobalFilter }
  | {
      kind: "set_tile_filters";
      payload: { tileId: string; filters: TileFilter[] };
    }
);

export type ChangeActionKind = ChangeAction["kind"];

export type ChangeSetStatus =
  | "proposed"
  | "applied"
  | "partially_applied"
  | "rejected";

/** A reviewable bundle of 1..8 staged actions. */
export interface ChangeSet {
  id: string;
  title: string;
  rationale: string;
  actions: ChangeAction[];
  status: ChangeSetStatus;
  /** epoch ms */
  createdAt: number;
  /** epoch ms */
  updatedAt: number;
  /** Indexes actually applied (present after apply). */
  appliedActionIndexes?: number[];
}

export interface ProposeChangeSetInput {
  title: string;
  rationale: string;
  actions: ChangeAction[];
}

/** Human review can drop individual rows before applying the rest. */
export interface ApplyChangeSetOptions {
  skipIndexes?: number[];
}

/** Partial replacement of a PROPOSED change set (revise_change_set). */
export interface ReviseChangeSetInput {
  title?: string;
  rationale?: string;
  actions?: ChangeAction[];
}

/** A dataset column the human is pointing at (data rail hover / drag). */
export interface HoveredField {
  dataset: string;
  column: string;
  /** DuckDB type name when the rail knows it. */
  type?: string;
}

export interface PresenceState {
  session: WorkSession | null;
  plan: AgentPlan | null;
  insights: Insight[];
  decisions: DecisionRequest[];
  /** Pending/decided multi-action proposals, capped (oldest dropped). */
  changeSets: ChangeSet[];
}

export interface RequestDecisionInput {
  question: string;
  context: string;
  options: DecisionOption[];
  recommendedOptionId?: string;
}

export interface CompleteWorkInput {
  summary: string;
  outcomes: string[];
}

export interface PresentPlanInput {
  title?: string;
  /** Steps default to status "pending". */
  steps: { label: string; status?: PlanStepStatus }[];
}

export interface ProposeInsightInput {
  title: string;
  body: string;
  /** Default "info". */
  severity?: InsightSeverity;
  tileId?: string;
  suggestedAction?: SuggestedAction;
}

/** Undo/redo snapshot: the document as it was BEFORE/AFTER the command. */
export interface HistoryEntry {
  id: string;
  by: Origin;
  label: string;
  at: number;
  doc: DashboardDoc;
}

export interface DashboardStore {
  doc: DashboardDoc;

  // history + attribution
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  /** Newest first, capped at 100 entries. */
  activityLog: ActivityEntry[];
  /** Human edits inside the 10-minute conflict window (pruned lazily). */
  recentHumanEdits: HumanEdit[];
  /** tileId -> epoch ms of the last agent mutation (drives glow animation). */
  agentPulse: Record<string, number>;

  /**
   * Collaboration presence (session, decisions, plan, insight tray) —
   * ephemeral: not undoable, not persisted, cleared by resetDashboard.
   * Every presence event is activity-logged.
   */
  presence: PresenceState;

  // selection / focus (not undoable — pure UI state)
  selectedTileId: string | null;
  brushedRange: BrushedRange | null;
  hoveredTileId: string | null;
  /**
   * Field the human is pointing at in the data rail. Hovering a column is a
   * real signal about intent, so the agent can read it as focus context.
   */
  hoveredField: HoveredField | null;

  // commands (undoable, attributed)
  addTile(input: AddTileInput, meta: ActionMeta): ActionResult;
  updateTile(tileId: string, patch: TilePatch, meta: ActionMeta): ActionResult;
  moveTile(tileId: string, layout: TileLayout, meta: ActionMeta): ActionResult;
  /** Pack the active page's tiles upward in one undoable command. */
  tidyLayout(meta: ActionMeta): ActionResult;
  removeTile(tileId: string, meta: ActionMeta): ActionResult;
  setFilter(filter: GlobalFilter, meta: ActionMeta): ActionResult;
  clearFilters(meta: ActionMeta): ActionResult;
  setDateRange(range: DateRange | null, meta: ActionMeta): ActionResult;
  setTheme(patch: Partial<ThemeSettings>, meta: ActionMeta): ActionResult;
  setTitle(title: string, meta: ActionMeta): ActionResult;
  addAnnotation(
    tileId: string,
    text: string,
    anchor: Annotation["anchor"],
    meta: ActionMeta,
  ): ActionResult;

  // pages (undoable; addPage/switchPage also change the active page)
  addPage(name: string, meta: ActionMeta): ActionResult;
  renamePage(pageId: string, name: string, meta: ActionMeta): ActionResult;
  removePage(pageId: string, meta: ActionMeta): ActionResult;
  switchPage(pageId: string, meta: ActionMeta): ActionResult;

  // cross-filter (undoable; get_user_focus reports it)
  setCrossFilter(filter: CrossFilter, meta: ActionMeta): ActionResult;
  clearCrossFilter(meta: ActionMeta): ActionResult;
  /** Toggle a tile's cross-filter opt-out. */
  setTileIgnoreCrossFilter(
    tileId: string,
    ignore: boolean,
    meta: ActionMeta,
  ): ActionResult;

  /** Replace a tile's spec.filters (empty array clears). Not for markdown. */
  setTileFilters(
    tileId: string,
    filters: TileFilter[],
    meta: ActionMeta,
  ): ActionResult;

  // calculated fields / views registries (undoable)
  addCalculatedField(
    field: Omit<CalculatedField, "kind"> & { kind?: CalculatedField["kind"] },
    meta: ActionMeta,
  ): ActionResult;
  removeCalculatedField(name: string, meta: ActionMeta): ActionResult;
  addView(view: ViewDef, meta: ActionMeta): ActionResult;
  removeView(name: string, meta: ActionMeta): ActionResult;

  // presence commands (activity-logged but NOT undoable — ephemeral state)
  /** Start a new brief, or update the objective of the current session. */
  startWorkSession(objective: string): ActionResult;
  pauseWorkSession(): ActionResult;
  resumeWorkSession(): ActionResult;
  requestDecision(input: RequestDecisionInput): ActionResult;
  answerDecision(id: string, optionId: string, note?: string): ActionResult;
  dismissDecision(id: string): ActionResult;
  completeWork(summary: string, outcomes: string[]): ActionResult;
  presentPlan(input: PresentPlanInput): ActionResult;
  updatePlanStep(index: number, status: PlanStepStatus): ActionResult;
  clearPlan(): ActionResult;
  proposeInsight(input: ProposeInsightInput): ActionResult;
  /**
   * Stage 1..8 related edits as ONE reviewable proposal. Validated
   * strictly; every referenced tile must exist at propose time. Nothing
   * touches the document until applyChangeSet.
   */
  proposeChangeSet(input: ProposeChangeSetInput): ActionResult;
  /**
   * Apply the change set's actions (minus `skipIndexes`) through the normal
   * command layer (origin "agent", force: the human approved), then collapse
   * them into ONE undo entry and ONE activity entry. A failing action
   * restores the pre-apply document AND history exactly.
   */
  applyChangeSet(id: string, options?: ApplyChangeSetOptions): ActionResult;
  rejectChangeSet(id: string): ActionResult;
  /** Agent-side edit of its own still-proposed change set. */
  reviseChangeSet(id: string, input: ReviseChangeSetInput): ActionResult;
  /** Agent retracts its own still-proposed change set. */
  withdrawChangeSet(id: string): ActionResult;
  /** Agent retracts its own still-pending decision request. */
  withdrawDecision(id: string): ActionResult;
  /**
   * Accept executes the insight's suggestedAction through the normal
   * command layer (origin "agent", undoable); the state flip itself is not.
   */
  acceptInsight(id: string): ActionResult;
  dismissInsight(id: string): ActionResult;

  undo(): ActionResult;
  redo(): ActionResult;

  // selection actions
  selectTile(tileId: string | null): void;
  setBrushedRange(range: BrushedRange | null): void;
  setHoveredTile(tileId: string | null): void;
  /** Data-rail hover; cleared with null. Pure UI state, never undoable. */
  setHoveredField(field: HoveredField | null): void;
  /** UI acknowledges a glow so it can re-trigger on the next agent edit. */
  clearAgentPulse(tileId: string): void;

  /**
   * Replace the whole document + reset history (load/import/tests).
   * Runs migrateDoc: v1 docs (flat tiles[]) become one "Overview" page.
   */
  /** Replace collaboration state with a peer's published copy. */
  adoptPresence(next: PresenceState): void;
  resetDashboard(doc?: DashboardDocInput): void;
}
