/**
 * Single seam for the studio store: apps/web components import the dashboard
 * document model + zustand store from here only. The implementation lives in
 * @kontier-ri/studio (packages/studio/src/store.ts).
 */

export {
  useDashboardStore,
  createInitialDoc,
  autoLayout,
  genId,
  DASHBOARD_SCOPE,
  DEFAULT_TILE_SIZE,
} from "@kontier-ri/studio";

export type {
  ActionMeta,
  ActionResult,
  ActivityEntry,
  AddTileInput,
  Agg,
  Annotation,
  BrushedRange,
  ChartMeasure,
  ChartQuery,
  ChartSpec,
  DashboardDoc,
  DashboardStore,
  DateRange,
  FilterOp,
  GlobalFilter,
  GlobalFilters,
  HistoryEntry,
  HumanEdit,
  KpiFormat,
  KpiSpec,
  MarkdownSpec,
  Origin,
  TableSpec,
  ThemeSettings,
  Tile,
  TileLayout,
  TilePatch,
  TileSpec,
  TileType,
} from "@kontier-ri/studio";
