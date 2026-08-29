/**
 * Dashboard document model + store contract types for Kontier RI studio.
 * Single source of truth for the tile/document shapes in docs/TOOLS.md.
 */

export type Origin = "human" | "agent";

export type TileType = "kpi" | "chart" | "table" | "markdown";
export type ChartType = "line" | "bar" | "area" | "pie";
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

/** 12-column grid (docs/TOOLS.md move_tile). */
export const GRID_COLUMNS = 12;

export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** kpi: `{dataset, sql | {measure, agg}, format, compare?}` */
export interface KpiSpec {
  dataset: string;
  sql?: string;
  measure?: string;
  agg?: Agg;
  format: KpiFormat;
  compare?: "prev_period";
}

export interface ChartMeasure {
  col: string;
  agg: Agg;
}

export interface ChartQuerySQL {
  sql: string;
}

export interface ChartQueryDims {
  dims: string[];
  measures: ChartMeasure[];
  orderBy?: string;
  limit?: number;
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
  color?: string;
}

export interface TableSpec {
  dataset: string;
  sql: string;
  /** <= 25 */
  pageSize?: number;
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

/** The whole dashboard document — one JSON-serializable object. */
export interface DashboardDoc {
  title: string;
  theme: ThemeSettings;
  filters: GlobalFilters;
  tiles: Tile[];
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

  // selection / focus (not undoable — pure UI state)
  selectedTileId: string | null;
  brushedRange: BrushedRange | null;
  hoveredTileId: string | null;

  // commands (undoable, attributed)
  addTile(input: AddTileInput, meta: ActionMeta): ActionResult;
  updateTile(tileId: string, patch: TilePatch, meta: ActionMeta): ActionResult;
  moveTile(tileId: string, layout: TileLayout, meta: ActionMeta): ActionResult;
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

  undo(): ActionResult;
  redo(): ActionResult;

  // selection actions
  selectTile(tileId: string | null): void;
  setBrushedRange(range: BrushedRange | null): void;
  setHoveredTile(tileId: string | null): void;
  /** UI acknowledges a glow so it can re-trigger on the next agent edit. */
  clearAgentPulse(tileId: string): void;

  /** Replace the whole document + reset history (load/import/tests). */
  resetDashboard(doc?: DashboardDoc): void;
}
