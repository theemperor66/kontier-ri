// Dashboard document model + store (the contract apps/web builds against).
export * from "./types";
export {
  useDashboardStore,
  createInitialDoc,
  autoLayout,
  genId,
  pruneHumanEdits,
  HUMAN_EDIT_WINDOW_MS,
  MAX_ACTIVITY,
  MAX_HISTORY,
  DASHBOARD_SCOPE,
  DEFAULT_TILE_SIZE,
} from "./store";

// Zod schemas (tool inputs + tile specs; all .strict()).
export * as schemas from "./schemas";

// Tile SQL / summary helpers (shared with tile renderers in apps/web).
export {
  aggExpr,
  buildChartSQL,
  buildTileQuerySQL,
  measureAlias,
  plottableAggExpr,
  summarizeSpec,
} from "./tile-sql";

// WebMCP: hook + tool catalog + mounting components.
export { getModelContext, useWebMCPTool } from "./webmcp/useWebMCPTool";
export type { ModelContextLike, WebMCPToolConfig } from "./webmcp/useWebMCPTool";
export {
  buildSelectedTileTools,
  buildStaticTools,
  compactValue,
  sanitizeMarkdown,
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
