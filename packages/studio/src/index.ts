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

// Placeholder canvas (kept until apps/web ships the real grid).
export { StudioCanvas } from "./StudioCanvas";
export type { StudioCanvasProps } from "./StudioCanvas";
