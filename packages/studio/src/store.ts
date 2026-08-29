import { create } from "zustand";
import { assertSelectOnly, ReadOnlySQLError } from "@kontier-ri/datasource";
import type {
  ActionConflict,
  ActionMeta,
  ActionResult,
  ActivityEntry,
  AddTileInput,
  Annotation,
  BrushedRange,
  CalculatedField,
  CrossFilter,
  DashboardDoc,
  DashboardDocInput,
  DashboardStore,
  DateRange,
  GlobalFilter,
  HistoryEntry,
  HumanEdit,
  Page,
  ThemeSettings,
  Tile,
  TileFilter,
  TileLayout,
  TilePatch,
  TileType,
  ViewDef,
} from "./types";
import { GRID_COLUMNS } from "./types";
import { migrateDoc, withActivePageMirror } from "./migrate";

/** Conflict window: agent may not silently overwrite newer human edits. */
export const HUMAN_EDIT_WINDOW_MS = 10 * 60_000;
/** Activity feed / undo history cap. */
export const MAX_ACTIVITY = 100;
export const MAX_HISTORY = 100;
/** Pseudo tileId for dashboard-scoped human edits (title/theme/filters). */
export const DASHBOARD_SCOPE = "__dashboard__";
/** Views created through the doc registry are namespaced with this prefix. */
export const VIEW_PREFIX = "view_";

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
  return migrateDoc({
    title: "Untitled dashboard",
    theme: { mode: "dark" },
    filters: { filters: [], dateRange: null },
    tiles: [],
  });
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

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Normalize a view name into the `view_` namespace (validates identifier). */
export function normalizeViewName(name: string): string {
  const withPrefix = name.startsWith(VIEW_PREFIX) ? name : `${VIEW_PREFIX}${name}`;
  if (!IDENT_RE.test(withPrefix)) {
    throw new Error(
      `Invalid view name ${JSON.stringify(name)}: use letters, digits and underscores.`,
    );
  }
  return withPrefix;
}

const AGGREGATE_FN_RE =
  /\b(sum|avg|min|max|count|median|mode|stddev|stddev_pop|stddev_samp|var_pop|var_samp|variance|quantile|quantile_cont|quantile_disc|approx_count_distinct|approx_quantile|string_agg|list|histogram|first|last|arg_min|arg_max|corr|covar_pop|covar_samp|bool_and|bool_or|bit_and|bit_or|product|entropy|kurtosis|skewness)\s*\(/i;

/** Auto-detect whether an expression is aggregate-level or row-level. */
export function detectCalculatedFieldKind(
  expression: string,
): CalculatedField["kind"] {
  return AGGREGATE_FN_RE.test(expression) ? "aggregate" : "row";
}

const FORBIDDEN_IN_EXPR_RE =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|install|load|pragma|call|vacuum|checkpoint|begin|commit|rollback|grant|revoke|truncate|merge)\b/i;

/** Reject statements / side effects inside a calculated-field expression. */
export function validateExpression(expression: string): string | null {
  const trimmed = expression.trim();
  if (trimmed.length === 0) return "Expression must not be empty.";
  if (trimmed.includes(";")) return "Expression must not contain ';'.";
  const m = FORBIDDEN_IN_EXPR_RE.exec(trimmed);
  if (m) return `Forbidden keyword in expression: ${m[1]!.toUpperCase()}`;
  return null;
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
  /** Page the command touched (result payload). */
  pageId?: string;
  /** Properties to record as recent human edits (human origin only). */
  humanProps?: { tileId: string; property: string }[];
};

export const useDashboardStore = create<DashboardStore>()((set, get) => {
  /** Shared command path: snapshot -> mutate -> attribute -> log. */
  function commit(
    meta: ActionMeta,
    nextDocRaw: DashboardDoc,
    options: CommitOptions = {},
  ): ActionResult {
    const nextDoc = withActivePageMirror(nextDocRaw);
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
    return {
      ok: true,
      ...(options.tileId ? { tileId: options.tileId } : {}),
      ...(options.pageId ? { pageId: options.pageId } : {}),
    };
  }

  /** Clear selection/hover/brush that points at tiles not on the active page. */
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

  /** Find a tile on ANY page (commands work across pages). */
  function getTile(tileId: string): Tile | undefined {
    for (const page of get().doc.pages) {
      const tile = page.tiles.find((t) => t.id === tileId);
      if (tile) return tile;
    }
    return undefined;
  }

  /** New doc with `fn` applied to the page tiles list containing tileId. */
  function mapTilePage(
    doc: DashboardDoc,
    tileId: string,
    fn: (tiles: Tile[]) => Tile[],
  ): DashboardDoc {
    return {
      ...doc,
      pages: doc.pages.map((p) =>
        p.tiles.some((t) => t.id === tileId) ? { ...p, tiles: fn(p.tiles) } : p,
      ),
    };
  }

  function getPage(pageId: string): Page | undefined {
    return get().doc.pages.find((p) => p.id === pageId);
  }

  const notFound = (tileId: string): ActionResult => ({
    ok: false,
    error: `No tile with id "${tileId}". Use get_dashboard_state to list tiles.`,
  });

  const pageNotFound = (pageId: string): ActionResult => ({
    ok: false,
    error: `No page with id "${pageId}". Use get_dashboard_state to list pages.`,
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
      // Add to the ACTIVE page.
      const doc = {
        ...s.doc,
        pages: s.doc.pages.map((p) =>
          p.id === s.doc.activePageId ? { ...p, tiles: [...p.tiles, tile] } : p,
        ),
      };
      return commit(meta, doc, { tileId: tile.id });
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
      const doc = mapTilePage(get().doc, tileId, (tiles) =>
        tiles.map((t) => (t.id === tileId ? next : t)),
      );
      return commit(meta, doc, {
        tileId,
        humanProps: properties.map((property) => ({ tileId, property })),
      });
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
      const doc = mapTilePage(get().doc, tileId, (tiles) =>
        tiles.map((t) =>
          t.id === tileId ? { ...t, layout: { ...layout } } : t,
        ),
      );
      return commit(meta, doc, {
        tileId,
        humanProps: [{ tileId, property: "layout" }],
      });
    },

    removeTile(tileId: string, meta: ActionMeta): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      const doc = mapTilePage(get().doc, tileId, (tiles) =>
        tiles.filter((t) => t.id !== tileId),
      );
      return commit(meta, doc, { tileId });
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
      const doc = mapTilePage(get().doc, tileId, (tiles) =>
        tiles.map((t) =>
          t.id === tileId
            ? { ...t, annotations: [...t.annotations, annotation] }
            : t,
        ),
      );
      return commit(meta, doc, { tileId });
    },

    // -- pages ---------------------------------------------------------------

    addPage(name: string, meta: ActionMeta): ActionResult {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: "Page name must not be empty." };
      }
      const doc = get().doc;
      const page: Page = { id: genId("page"), name: trimmed, tiles: [] };
      // New page becomes active.
      return commit(
        meta,
        { ...doc, pages: [...doc.pages, page], activePageId: page.id },
        { pageId: page.id },
      );
    },

    renamePage(pageId: string, name: string, meta: ActionMeta): ActionResult {
      const page = getPage(pageId);
      if (!page) return pageNotFound(pageId);
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: "Page name must not be empty." };
      }
      const conflict = findConflict(meta, DASHBOARD_SCOPE, [`page:${pageId}`]);
      if (conflict) return conflict;
      const doc = get().doc;
      return commit(
        meta,
        {
          ...doc,
          pages: doc.pages.map((p) =>
            p.id === pageId ? { ...p, name: trimmed } : p,
          ),
        },
        {
          pageId,
          humanProps: [{ tileId: DASHBOARD_SCOPE, property: `page:${pageId}` }],
        },
      );
    },

    removePage(pageId: string, meta: ActionMeta): ActionResult {
      const page = getPage(pageId);
      if (!page) return pageNotFound(pageId);
      const doc = get().doc;
      if (doc.pages.length <= 1) {
        return { ok: false, error: "Cannot remove the last page." };
      }
      const pages = doc.pages.filter((p) => p.id !== pageId);
      const activePageId =
        doc.activePageId === pageId ? pages[0]!.id : doc.activePageId;
      return commit(meta, { ...doc, pages, activePageId }, { pageId });
    },

    switchPage(pageId: string, meta: ActionMeta): ActionResult {
      const page = getPage(pageId);
      if (!page) return pageNotFound(pageId);
      const doc = get().doc;
      if (doc.activePageId === pageId) {
        return { ok: false, error: `Page "${page.name}" is already active.` };
      }
      return commit(meta, { ...doc, activePageId: pageId }, { pageId });
    },

    // -- cross-filter --------------------------------------------------------

    setCrossFilter(filter: CrossFilter, meta: ActionMeta): ActionResult {
      const doc = get().doc;
      return commit(meta, { ...doc, crossFilter: { ...filter } });
    },

    clearCrossFilter(meta: ActionMeta): ActionResult {
      const doc = get().doc;
      if (!doc.crossFilter) {
        return { ok: false, error: "No cross-filter is active." };
      }
      return commit(meta, { ...doc, crossFilter: null });
    },

    setTileIgnoreCrossFilter(
      tileId: string,
      ignore: boolean,
      meta: ActionMeta,
    ): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      const doc = mapTilePage(get().doc, tileId, (tiles) =>
        tiles.map((t) =>
          t.id === tileId ? { ...t, ignoreCrossFilter: ignore } : t,
        ),
      );
      return commit(meta, doc, { tileId });
    },

    setTileFilters(
      tileId: string,
      filters: TileFilter[],
      meta: ActionMeta,
    ): ActionResult {
      const tile = getTile(tileId);
      if (!tile) return notFound(tileId);
      if (tile.type === "markdown") {
        return { ok: false, error: "Markdown tiles cannot have filters." };
      }
      const conflict = findConflict(meta, tileId, ["spec.filters"]);
      if (conflict) return conflict;
      const doc = mapTilePage(get().doc, tileId, (tiles) =>
        tiles.map((t) =>
          t.id === tileId
            ? {
                ...t,
                spec: {
                  ...t.spec,
                  filters: filters.map((f) => ({ ...f })),
                } as Tile["spec"],
              }
            : t,
        ),
      );
      return commit(meta, doc, {
        tileId,
        humanProps: [{ tileId, property: "spec.filters" }],
      });
    },

    // -- calculated fields / views -------------------------------------------

    addCalculatedField(
      field: Omit<CalculatedField, "kind"> & { kind?: CalculatedField["kind"] },
      meta: ActionMeta,
    ): ActionResult {
      if (!IDENT_RE.test(field.name)) {
        return {
          ok: false,
          error: `Invalid field name ${JSON.stringify(field.name)}: use letters, digits and underscores (no leading digit).`,
        };
      }
      const doc = get().doc;
      if (doc.calculatedFields.some((f) => f.name === field.name)) {
        return {
          ok: false,
          error: `A calculated field named "${field.name}" already exists. Remove it first or pick another name.`,
        };
      }
      const invalid = validateExpression(field.expression);
      if (invalid) return { ok: false, error: invalid };
      const entry: CalculatedField = {
        name: field.name,
        dataset: field.dataset,
        expression: field.expression.trim(),
        kind: field.kind ?? detectCalculatedFieldKind(field.expression),
        ...(field.description ? { description: field.description } : {}),
      };
      return commit(meta, {
        ...doc,
        calculatedFields: [...doc.calculatedFields, entry],
      });
    },

    removeCalculatedField(name: string, meta: ActionMeta): ActionResult {
      const doc = get().doc;
      if (!doc.calculatedFields.some((f) => f.name === name)) {
        return { ok: false, error: `No calculated field named "${name}".` };
      }
      return commit(meta, {
        ...doc,
        calculatedFields: doc.calculatedFields.filter((f) => f.name !== name),
      });
    },

    addView(view: ViewDef, meta: ActionMeta): ActionResult {
      let name: string;
      try {
        name = normalizeViewName(view.name);
        assertSelectOnly(view.sql);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const doc = get().doc;
      if (doc.views.some((v) => v.name === name)) {
        return {
          ok: false,
          error: `A view named "${name}" already exists. Remove it first.`,
        };
      }
      const entry: ViewDef = {
        name,
        sql: view.sql.trim().replace(/;+\s*$/, ""),
        ...(view.description ? { description: view.description } : {}),
      };
      return commit(meta, { ...doc, views: [...doc.views, entry] });
    },

    removeView(name: string, meta: ActionMeta): ActionResult {
      const doc = get().doc;
      const normalized = name.startsWith(VIEW_PREFIX)
        ? name
        : `${VIEW_PREFIX}${name}`;
      if (!doc.views.some((v) => v.name === normalized)) {
        return { ok: false, error: `No view named "${normalized}".` };
      }
      return commit(meta, {
        ...doc,
        views: doc.views.filter((v) => v.name !== normalized),
      });
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

    resetDashboard(doc?: DashboardDocInput): void {
      set({
        doc: doc ? migrateDoc(doc) : createInitialDoc(),
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
