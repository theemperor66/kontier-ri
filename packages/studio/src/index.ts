// Dashboard document model + store (the contract apps/web builds against).
export * from "./types";
export {
  useDashboardStore,
  createInitialDoc,
  createInitialPresence,
  autoLayout,
  genId,
  pruneHumanEdits,
  detectCalculatedFieldKind,
  normalizeViewName,
  validateExpression,
  HUMAN_EDIT_WINDOW_MS,
  MAX_ACTIVITY,
  MAX_HISTORY,
  MAX_INSIGHTS,
  DASHBOARD_SCOPE,
  DEFAULT_TILE_SIZE,
  VIEW_PREFIX,
} from "./store";

// Doc migration (v1 flat-tiles docs -> v2 pages docs). resetDashboard runs
// this automatically; exported for import/share-URL code paths.
export { migrateDoc, withActivePageMirror, V1_PAGE_ID } from "./migrate";

// Re-create doc-persisted views in the engine after a (re)load.
export { syncViewsToDataSource } from "./views-sync";
export type { ViewSyncResult } from "./views-sync";

// Zod schemas (tool inputs + tile specs; all .strict()).
export * as schemas from "./schemas";

// Tile SQL / summary helpers — THE single SQL authority (PLAN-V2):
// buildTileQuery(tile, ctx) applies global/tile filters, date range,
// cross-filter and calculated-field expansion. apps/web consumes these.
export {
  aggExpr,
  buildChartSQL,
  buildTileQuery,
  buildTileQuerySQL,
  buildWhereClauses,
  filterClause,
  measureAlias,
  measureExpr,
  pickDateColumn,
  plottableAggExpr,
  sqlLiteral,
  summarizeSpec,
  wrapWithClauses,
} from "./tile-sql";
export type {
  BuiltTileQuery,
  ColumnInfo,
  DatasetInfo,
  TileQueryContext,
} from "./tile-sql";

// WebMCP: hook + tool catalog + mounting components.
export { getModelContext, useWebMCPTool } from "./webmcp/useWebMCPTool";
export type { ModelContextLike, WebMCPToolConfig } from "./webmcp/useWebMCPTool";
export {
  buildSelectedTileTools,
  buildStaticTools,
  compactValue,
  csvCell,
  sanitizeMarkdown,
  toCSV,
  DYNAMIC_TOOL_NAMES,
  STATIC_TOOL_NAMES,
} from "./webmcp/tools";
export type {
  StudioStoreApi,
  ToolContext,
  ToolDefinition,
} from "./webmcp/tools";
export { WebMCPTools, RegisteredTool } from "./webmcp/WebMCPTools";
export type { WebMCPToolsProps } from "./webmcp/WebMCPTools";
export { SelectedTileTools } from "./webmcp/SelectedTileTools";

// Placeholder canvas (kept until apps/web ships the real grid).
export { StudioCanvas } from "./StudioCanvas";
export type { StudioCanvasProps } from "./StudioCanvas";
