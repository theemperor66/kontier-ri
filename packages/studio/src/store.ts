import { create } from "zustand";
import type {
  ActionConflict,
  ActionMeta,
  ActionResult,
  ActivityEntry,
  AddTileInput,
  Annotation,
  BrushedRange,
  DashboardDoc,
  DashboardStore,
  DateRange,
  GlobalFilter,
  HistoryEntry,
  HumanEdit,
  ThemeSettings,
  Tile,
  TileLayout,
  TilePatch,
  TileType,
} from "./types";
import { GRID_COLUMNS } from "./types";

/** Conflict window: agent may not silently overwrite newer human edits. */
export const HUMAN_EDIT_WINDOW_MS = 10 * 60_000;
/** Activity feed / undo history cap. */
export const MAX_ACTIVITY = 100;
export const MAX_HISTORY = 100;
/** Pseudo tileId for dashboard-scoped human edits (title/theme/filters). */
export const DASHBOARD_SCOPE = "__dashboard__";

export const DEFAULT_TILE_SIZE: Record<TileType, { w: number; h: number }> = {
  kpi: { w: 3, h: 2 },
  chart: { w: 6, h: 4 },
  table: { w: 6, h: 4 },
  markdown: { w: 4, h: 3 },
};

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialDoc(): DashboardDoc {
  return {
    title: "Untitled dashboard",
    theme: { mode: "dark" },
    filters: { filters: [], dateRange: null },
    tiles: [],
  };
}

export function pruneHumanEdits(edits: HumanEdit[], now: number): HumanEdit[] {
  return edits.filter((e) => now - e.at < HUMAN_EDIT_WINDOW_MS);
}

function overlaps(a: TileLayout, b: TileLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** First-fit placement on the 12-column grid. */
export function autoLayout(
  tiles: Tile[],
  size: { w: number; h: number },
): TileLayout {
  const w = Math.min(size.w, GRID_COLUMNS);
  const maxY = tiles.reduce((m, t) => Math.max(m, t.layout.y + t.layout.h), 0);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= GRID_COLUMNS; x++) {
      const candidate = { x, y, w, h: size.h };
      if (!tiles.some((t) => overlaps(t.layout, candidate))) return candidate;
    }
  }
  return { x: 0, y: maxY, w, h: size.h };
}

function conflictHint(properties: string[]): string {
  return (
    `The user edited ${properties.join(", ")} less than 10 minutes ago. ` +
    "Ask the user before overwriting, or pass force: true if they already approved."
  );
}

type CommitOptions = {
  /** Tile the command touched (agent glow + result payload). */
  tileId?: string;
  /** Properties to record as recent human edits (human origin only). */
  humanProps?: { tileId: string; property: string }[];
};

export const useDashboardStore = create<DashboardStore>()((set, get) => {
  /** Shared command path: snapshot -> mutate -> attribute -> log. */
  function commit(
    meta: ActionMeta,
    nextDoc: DashboardDoc,
    options: CommitOptions = {},
  ): ActionResult {
    const now = Date.now();
    const id = genId("cmd");
    set((s) => {
      const pruned = pruneHumanEdits(s.recentHumanEdits, now);
      const recentHumanEdits =
        meta.origin === "human" && options.humanProps?.length
          ? [
              ...pruned.filter(
                (e) =>
                  !options.humanProps!.some(
                    (p) => p.tileId === e.tileId && p.property === e.property,
                  ),
              ),
              ...options.humanProps.map((p) => ({ ...p, at: now })),
            ]
          : pruned;
      const agentPulse =
        meta.origin === "agent" && options.tileId
          ? { ...s.agentPulse, [options.tileId]: now }
          : s.agentPulse;
      const entry: HistoryEntry = {
        id,
        by: meta.origin,
        label: meta.label,
        at: now,
        doc: s.doc,
      };
      const activity: ActivityEntry = {
        id,
        by: meta.origin,
        label: meta.label,
        at: now,
        undone: false,
      };
      return {
        doc: nextDoc,
        undoStack: [...s.undoStack, entry].slice(-MAX_HISTORY),
        redoStack: [],
        activityLog: [activity, ...s.activityLog].slice(0, MAX_ACTIVITY),
        recentHumanEdits,
        agentPulse,
        ...selectionCleanup(s, nextDoc),
      };
    });
    return options.tileId ? { ok: true, tileId: options.tileId } : { ok: true };
  }

  /** Clear selection/hover/brush that points at tiles no longer in the doc. */
  function selectionCleanup(
    s: Pick<DashboardStore, "selectedTileId" | "hoveredTileId" | "brushedRange">,
    doc: DashboardDoc,
  ) {
    const has = (id: string | null | undefined) =>
      !!id && doc.tiles.some((t) => t.id === id);
    return {
      selectedTileId: has(s.selectedTileId) ? s.selectedTileId : null,
      hoveredTileId: has(s.hoveredTileId) ? s.hoveredTileId : null,
      brushedRange: has(s.brushedRange?.tileId) ? s.brushedRange : null,
    };
  }

  /**
   * Conflict rule (docs/TOOLS.md): agent mutation of a property the human
   * edited < 10 min ago returns a conflict result unless force: true.
   */
  function findConflict(
    meta: ActionMeta,
    scopeTileId: string,
    properties: string[],
  ): ActionConflict | null {
    if (meta.origin !== "agent" || meta.force || properties.length === 0) {
      return null;
    }
    const now = Date.now();
    const hits = properties.filter((p) =>
      get().recentHumanEdits.some(
        (e) =>
          e.tileId === scopeTileId &&
          e.property === p &&
          now - e.at < HUMAN_EDIT_WINDOW_MS,
      ),
    );
    if (hits.length === 0) return null;
    return {
      ok: false,
      conflict: true,
      ...(scopeTileId === DASHBOARD_SCOPE ? {} : { tileId: scopeTileId }),
      properties: hits,
      hint: conflictHint(hits),
    };
  }

  function getTile(tileId: string): Tile | undefined {
    return get().doc.tiles.find((t) => t.id === tileId);
  }

  const notFound = (tileId: string): ActionResult => ({
    ok: false,
    error: `No tile with id "${tileId}". Use get_dashboard_state to list tiles.`,
  });

  return {
    doc: createInitialDoc(),
    undoStack: [],
    redoStack: [],
    activityLog: [],
    recentHumanEdits: [],
    agentPulse: {},
    selectedTileId: null,
    brushedRange: null,
    hoveredTileId: null,

    addTile(input: AddTileInput, meta: ActionMeta): ActionResult {
      const s = get();
      const layout =
        input.layout ?? autoLayout(s.doc.tiles, DEFAULT_TILE_SIZE[input.type]);
      const tile: Tile = {
        id: genId("tile"),
        type: input.type,
        title: input.title,
        layout: { ...layout },
        spec: { ...input.spec },
        annotations: [],
      };
      return commit(
        meta,
        { ...s.doc, tiles: [...s.doc.tiles, tile] },
        { tileId: tile.id },
      );
    },

    updateTile(tileId: string, patch: TilePatch, meta: ActionMeta): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      const properties: string[] = [];
      if (patch.title !== undefined) properties.push("title");
      for (const key of Object.keys(patch.spec ?? {})) {
        properties.push(`spec.${key}`);
      }
      if (properties.length === 0) {
        return { ok: false, error: "Empty patch: nothing to update." };
      }
      const conflict = findConflict(meta, tileId, properties);
      if (conflict) return conflict;
      const next: Tile = {
        ...tile,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        spec: { ...tile.spec, ...(patch.spec ?? {}) } as Tile["spec"],
      };
      const doc = get().doc;
      return commit(
        meta,
        { ...doc, tiles: doc.tiles.map((t) => (t.id === tileId ? next : t)) },
        {
          tileId,
          humanProps: properties.map((property) => ({ tileId, property })),
        },
      );
    },

    moveTile(tileId: string, layout: TileLayout, meta: ActionMeta): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      if (layout.x < 0 || layout.w < 1 || layout.x + layout.w > GRID_COLUMNS) {
        return {
          ok: false,
          error: `Layout out of bounds: x + w must be <= ${GRID_COLUMNS}.`,
        };
      }
      const conflict = findConflict(meta, tileId, ["layout"]);
      if (conflict) return conflict;
      const doc = get().doc;
      return commit(
        meta,
        {
          ...doc,
          tiles: doc.tiles.map((t) =>
            t.id === tileId ? { ...t, layout: { ...layout } } : t,
          ),
        },
        { tileId, humanProps: [{ tileId, property: "layout" }] },
      );
    },

    removeTile(tileId: string, meta: ActionMeta): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      const doc = get().doc;
      return commit(
        meta,
        { ...doc, tiles: doc.tiles.filter((t) => t.id !== tileId) },
        { tileId },
      );
    },

    setFilter(filter: GlobalFilter, meta: ActionMeta): ActionResult {
      const property = `filter:${filter.column}`;
      const conflict = findConflict(meta, DASHBOARD_SCOPE, [property]);
      if (conflict) return conflict;
      const doc = get().doc;
      const filters = [
        ...doc.filters.filters.filter((f) => f.column !== filter.column),
        { ...filter },
      ];
      return commit(
        meta,
        { ...doc, filters: { ...doc.filters, filters } },
        { humanProps: [{ tileId: DASHBOARD_SCOPE, property }] },
      );
    },

    clearFilters(meta: ActionMeta): ActionResult {
      const doc = get().doc;
      if (doc.filters.filters.length === 0) {
        return { ok: false, error: "No global filters are set." };
      }
      return commit(meta, { ...doc, filters: { ...doc.filters, filters: [] } });
    },

    setDateRange(range: DateRange | null, meta: ActionMeta): ActionResult {
      const conflict = findConflict(meta, DASHBOARD_SCOPE, ["dateRange"]);
      if (conflict) return conflict;
      const doc = get().doc;
      return commit(
        meta,
        {
          ...doc,
          filters: { ...doc.filters, dateRange: range ? { ...range } : null },
        },
        { humanProps: [{ tileId: DASHBOARD_SCOPE, property: "dateRange" }] },
      );
    },

    setTheme(patch: Partial<ThemeSettings>, meta: ActionMeta): ActionResult {
      const conflict = findConflict(meta, DASHBOARD_SCOPE, ["theme"]);
      if (conflict) return conflict;
      const doc = get().doc;
      return commit(
        meta,
        { ...doc, theme: { ...doc.theme, ...patch } },
        { humanProps: [{ tileId: DASHBOARD_SCOPE, property: "theme" }] },
      );
    },

    setTitle(title: string, meta: ActionMeta): ActionResult {
      const conflict = findConflict(meta, DASHBOARD_SCOPE, ["title"]);
      if (conflict) return conflict;
      const doc = get().doc;
      return commit(
        meta,
        { ...doc, title },
        { humanProps: [{ tileId: DASHBOARD_SCOPE, property: "title" }] },
      );
    },

    addAnnotation(
      tileId: string,
      text: string,
      anchor: Annotation["anchor"],
      meta: ActionMeta,
    ): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      const annotation: Annotation = {
        id: genId("ann"),
        text,
        ...(anchor ? { anchor } : {}),
        by: meta.origin,
        at: Date.now(),
      };
      const doc = get().doc;
      return commit(
        meta,
        {
          ...doc,
          tiles: doc.tiles.map((t) =>
            t.id === tileId
              ? { ...t, annotations: [...t.annotations, annotation] }
              : t,
          ),
        },
        { tileId },
      );
    },

    undo(): ActionResult {
      const s = get();
      const entry = s.undoStack[s.undoStack.length - 1];
      if (!entry) return { ok: false, error: "Nothing to undo." };
      set((st) => ({
        doc: entry.doc,
        undoStack: st.undoStack.slice(0, -1),
        redoStack: [...st.redoStack, { ...entry, doc: st.doc }],
        activityLog: st.activityLog.map((a) =>
          a.id === entry.id ? { ...a, undone: true } : a,
        ),
        ...selectionCleanup(st, entry.doc),
      }));
      return { ok: true };
    },

    redo(): ActionResult {
      const s = get();
      const entry = s.redoStack[s.redoStack.length - 1];
      if (!entry) return { ok: false, error: "Nothing to redo." };
      set((st) => ({
        doc: entry.doc,
        redoStack: st.redoStack.slice(0, -1),
        undoStack: [...st.undoStack, { ...entry, doc: st.doc }],
        activityLog: st.activityLog.map((a) =>
          a.id === entry.id ? { ...a, undone: false } : a,
        ),
        ...selectionCleanup(st, entry.doc),
      }));
      return { ok: true };
    },

    selectTile(tileId: string | null): void {
      set({ selectedTileId: tileId });
    },

    setBrushedRange(range: BrushedRange | null): void {
      set({ brushedRange: range ? { ...range } : null });
    },

    setHoveredTile(tileId: string | null): void {
      set({ hoveredTileId: tileId });
    },

    clearAgentPulse(tileId: string): void {
      set((s) => {
        if (!(tileId in s.agentPulse)) return s;
        const next = { ...s.agentPulse };
        delete next[tileId];
        return { agentPulse: next };
      });
    },

    resetDashboard(doc?: DashboardDoc): void {
      set({
        doc: doc ?? createInitialDoc(),
        undoStack: [],
        redoStack: [],
        activityLog: [],
        recentHumanEdits: [],
        agentPulse: {},
        selectedTileId: null,
        brushedRange: null,
        hoveredTileId: null,
      });
    },
  };
});
