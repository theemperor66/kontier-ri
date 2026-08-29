"use client";

/**
 * Dashboard document store.
 *
 * NOTE: This file is the single seam for the studio store. Once
 * `@kontier-ri/studio` ships its zustand store + types, this file becomes a
 * re-export of that package; every app component imports from here only.
 * The contract below mirrors docs/TOOLS.md + the agreed studio store sketch.
 */

import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types (mirror docs/TOOLS.md tile specs)
// ---------------------------------------------------------------------------

export type TileType = "kpi" | "chart" | "table" | "markdown";

export interface TileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KpiSpec {
  dataset: string;
  sql?: string;
  measure?: string;
  agg?: "sum" | "avg" | "count" | "min" | "max";
  format?: "currency" | "number" | "percent";
  compare?: "prev_period";
}

export interface ChartQuery {
  sql?: string;
  dims?: string[];
  measures?: { col: string; agg: string }[];
  orderBy?: string;
  limit?: number;
}

export interface ChartSpec {
  dataset: string;
  query: ChartQuery;
  chartType: "line" | "bar" | "area" | "pie";
  stacked?: boolean;
  xKey?: string;
  seriesKeys?: string[];
  color?: string;
}

export interface TableSpec {
  dataset: string;
  sql: string;
  pageSize?: number;
}

export interface MarkdownSpec {
  content: string;
}

export type TileSpec = KpiSpec | ChartSpec | TableSpec | MarkdownSpec;

export interface TileAnnotation {
  text: string;
  anchor?: { x?: string | number; seriesKey?: string };
}

export interface Tile {
  id: string;
  type: TileType;
  title: string;
  layout: TileLayout;
  spec: TileSpec;
  annotations?: TileAnnotation[];
}

export interface GlobalFilter {
  column: string;
  op: "eq" | "in" | "between" | "contains";
  value: unknown;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface DashboardDoc {
  title: string;
  theme: "dark" | "light";
  tiles: Tile[];
  filters: GlobalFilter[];
  dateRange: DateRange | null;
}

export type Origin = "human" | "agent";

export interface ActionMeta {
  origin: Origin;
  label: string;
}

export interface ActivityEntry {
  id: string;
  by: Origin;
  label: string;
  at: number;
  undone?: boolean;
}

export interface BrushedRange {
  tileId: string;
  from: string;
  to: string;
}

export interface SelectionState {
  selectedTileId: string | null;
  brushedRange: BrushedRange | null;
  hoveredTileId: string | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface HistoryEntry {
  activityId: string;
  before: DashboardDoc;
  after: DashboardDoc;
}

export interface DashboardStore {
  doc: DashboardDoc;
  selection: SelectionState;
  activity: ActivityEntry[];
  /** tileId -> timestamp of the last agent-driven change (drives glow). */
  agentPulse: Record<string, number>;

  addTile: (tile: Omit<Tile, "id"> & { id?: string }, meta: ActionMeta) => string;
  updateTile: (
    payload: { tileId: string; patch: Partial<Pick<Tile, "title" | "spec">> },
    meta: ActionMeta,
  ) => void;
  moveTile: (payload: { tileId: string } & TileLayout, meta: ActionMeta) => void;
  removeTile: (payload: { tileId: string }, meta: ActionMeta) => void;
  setFilter: (filter: GlobalFilter, meta: ActionMeta) => void;
  clearFilters: (meta: ActionMeta) => void;
  setDateRange: (range: DateRange | null, meta: ActionMeta) => void;
  setTheme: (theme: "dark" | "light", meta: ActionMeta) => void;
  setTitle: (title: string, meta: ActionMeta) => void;
  addAnnotation: (
    payload: { tileId: string; text: string; anchor?: TileAnnotation["anchor"] },
    meta: ActionMeta,
  ) => void;
  /** Replace the whole document in one undoable step (demo seed). */
  loadDoc: (doc: DashboardDoc, meta: ActionMeta) => void;

  undo: () => void;
  redo: () => void;
  /** Undo a specific activity entry (only valid for the latest live entry). */
  undoActivity: (activityId: string) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  selectTile: (tileId: string | null) => void;
  setHoveredTile: (tileId: string | null) => void;
  setBrushedRange: (range: BrushedRange | null) => void;

  /** internal */
  _past: HistoryEntry[];
  _future: HistoryEntry[];
}

const emptyDoc: DashboardDoc = {
  title: "Untitled dashboard",
  theme: "dark",
  tiles: [],
  filters: [],
  dateRange: null,
};

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

const HISTORY_LIMIT = 100;
const ACTIVITY_LIMIT = 200;

export const useDashboardStore = create<DashboardStore>((set, get) => {
  /** Apply an undoable document mutation with attribution + activity. */
  function commit(
    meta: ActionMeta,
    mutate: (doc: DashboardDoc) => DashboardDoc,
    pulseTileId?: string,
  ): void {
    const state = get();
    const before = state.doc;
    const after = mutate(before);
    if (after === before) return;
    const entry: ActivityEntry = {
      id: newId("act"),
      by: meta.origin,
      label: meta.label,
      at: Date.now(),
    };
    set({
      doc: after,
      activity: [entry, ...state.activity].slice(0, ACTIVITY_LIMIT),
      _past: [...state._past, { activityId: entry.id, before, after }].slice(
        -HISTORY_LIMIT,
      ),
      _future: [],
      agentPulse:
        meta.origin === "agent" && pulseTileId
          ? { ...state.agentPulse, [pulseTileId]: Date.now() }
          : state.agentPulse,
    });
  }

  return {
    doc: emptyDoc,
    selection: { selectedTileId: null, brushedRange: null, hoveredTileId: null },
    activity: [],
    agentPulse: {},
    _past: [],
    _future: [],

    addTile: (tile, meta) => {
      const id = tile.id ?? newId("tile");
      commit(
        meta,
        (doc) => ({ ...doc, tiles: [...doc.tiles, { ...tile, id }] }),
        id,
      );
      return id;
    },

    updateTile: ({ tileId, patch }, meta) =>
      commit(
        meta,
        (doc) => ({
          ...doc,
          tiles: doc.tiles.map((t) =>
            t.id === tileId
              ? {
                  ...t,
                  ...(patch.title != null ? { title: patch.title } : {}),
                  ...(patch.spec != null
                    ? { spec: { ...t.spec, ...patch.spec } as TileSpec }
                    : {}),
                }
              : t,
          ),
        }),
        tileId,
      ),

    moveTile: ({ tileId, x, y, w, h }, meta) =>
      commit(
        meta,
        (doc) => ({
          ...doc,
          tiles: doc.tiles.map((t) =>
            t.id === tileId ? { ...t, layout: { x, y, w, h } } : t,
          ),
        }),
        tileId,
      ),

    removeTile: ({ tileId }, meta) => {
      commit(meta, (doc) => ({
        ...doc,
        tiles: doc.tiles.filter((t) => t.id !== tileId),
      }));
      const sel = get().selection;
      if (sel.selectedTileId === tileId) {
        set({ selection: { ...sel, selectedTileId: null } });
      }
    },

    setFilter: (filter, meta) =>
      commit(meta, (doc) => ({
        ...doc,
        filters: [
          ...doc.filters.filter((f) => f.column !== filter.column),
          filter,
        ],
      })),

    clearFilters: (meta) =>
      commit(meta, (doc) => ({ ...doc, filters: [], dateRange: null })),

    setDateRange: (range, meta) =>
      commit(meta, (doc) => ({ ...doc, dateRange: range })),

    setTheme: (theme, meta) => commit(meta, (doc) => ({ ...doc, theme })),

    setTitle: (title, meta) => commit(meta, (doc) => ({ ...doc, title })),

    addAnnotation: ({ tileId, text, anchor }, meta) =>
      commit(
        meta,
        (doc) => ({
          ...doc,
          tiles: doc.tiles.map((t) =>
            t.id === tileId
              ? {
                  ...t,
                  annotations: [...(t.annotations ?? []), { text, anchor }],
                }
              : t,
          ),
        }),
        tileId,
      ),

    loadDoc: (doc, meta) => commit(meta, () => doc),

    undo: () => {
      const { _past, _future, doc, activity } = get();
      const last = _past[_past.length - 1];
      if (!last) return;
      set({
        doc: last.before,
        _past: _past.slice(0, -1),
        _future: [..._future, { ...last, after: doc }],
        activity: activity.map((a) =>
          a.id === last.activityId ? { ...a, undone: true } : a,
        ),
      });
    },

    redo: () => {
      const { _past, _future, activity } = get();
      const next = _future[_future.length - 1];
      if (!next) return;
      set({
        doc: next.after,
        _future: _future.slice(0, -1),
        _past: [..._past, next],
        activity: activity.map((a) =>
          a.id === next.activityId ? { ...a, undone: false } : a,
        ),
      });
    },

    undoActivity: (activityId) => {
      const { _past } = get();
      const last = _past[_past.length - 1];
      if (last?.activityId === activityId) get().undo();
    },

    canUndo: () => get()._past.length > 0,
    canRedo: () => get()._future.length > 0,

    selectTile: (tileId) =>
      set((s) => ({ selection: { ...s.selection, selectedTileId: tileId } })),
    setHoveredTile: (tileId) =>
      set((s) => ({ selection: { ...s.selection, hoveredTileId: tileId } })),
    setBrushedRange: (range) =>
      set((s) => ({ selection: { ...s.selection, brushedRange: range } })),
  };
});
