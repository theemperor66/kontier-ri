import { create } from "zustand";
import * as z from "zod";
import { assertSelectOnly, ReadOnlySQLError } from "@kontier-ri/datasource";
import type {
  HoveredField,
  ActionConflict,
  ActionMeta,
  ActionResult,
  ActivityEntry,
  AddTileInput,
  Annotation,
  ApplyChangeSetOptions,
  BrushedRange,
  CalculatedField,
  ChangeAction,
  ChangeSet,
  CrossFilter,
  DashboardDoc,
  DashboardDocInput,
  DashboardStore,
  DateRange,
  DecisionRequest,
  GlobalFilter,
  HistoryEntry,
  HumanEdit,
  Insight,
  Page,
  PlanStepStatus,
  PresenceState,
  PresentPlanInput,
  ProposeChangeSetInput,
  ProposeInsightInput,
  RequestDecisionInput,
  ReviseChangeSetInput,
  ThemeSettings,
  Tile,
  TileFilter,
  TileLayout,
  TilePatch,
  TileType,
  ViewDef,
  WorkSessionPhase,
} from "./types";
import { GRID_COLUMNS } from "./types";
import { migrateDoc, withActivePageMirror } from "./migrate";
import {
  completeWorkInput,
  proposeChangeSetInput,
  requestDecisionInput,
  reviseChangeSetInput,
  suggestedActionSchema,
  tileSpecPatchSchemas,
} from "./schemas";

/** Conflict window: agent may not silently overwrite newer human edits. */
export const HUMAN_EDIT_WINDOW_MS = 10 * 60_000;
/** Activity feed / undo history cap. */
export const MAX_ACTIVITY = 100;
export const MAX_HISTORY = 100;
/** Pseudo tileId for dashboard-scoped human edits (title/theme/filters). */
export const DASHBOARD_SCOPE = "__dashboard__";
/** Views created through the doc registry are namespaced with this prefix. */
export const VIEW_PREFIX = "view_";
/** Insight tray cap: oldest insights drop off past this. */
export const MAX_INSIGHTS = 30;
/** Change-set review queue cap: oldest sets drop off past this. */
export const MAX_CHANGE_SETS = 10;
/** Max staged actions inside one change set (mirrors the zod schema). */
export const MAX_CHANGE_ACTIONS = 8;

export function createInitialPresence(): PresenceState {
  return {
    session: null,
    plan: null,
    insights: [],
    decisions: [],
    changeSets: [],
  };
}

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
    theme: { mode: "light" },
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

  /**
   * Activity-only log for ephemeral presence events: appears in the feed,
   * pushes NO undo entry (presence is not part of the document).
   */
  function logPresence(
    label: string,
    by: ActivityEntry["by"] = "agent",
  ): void {
    set((s) => ({
      activityLog: [
        {
          id: genId("cmd"),
          by,
          label,
          at: Date.now(),
          undone: false,
        },
        ...s.activityLog,
      ].slice(0, MAX_ACTIVITY),
    }));
  }

  /** Pick the honest phase when a paused/review-blocked session resumes. */
  function resumedPhase(presence: PresenceState): WorkSessionPhase {
    if (
      presence.decisions.some((decision) => decision.status === "pending") ||
      presence.insights.some((insight) => insight.state === "proposed") ||
      presence.changeSets.some((set) => set.status === "proposed")
    ) {
      return "review";
    }
    const plan = presence.plan;
    if (!plan) return "ready";
    if (plan.steps.every((step) => step.status === "done")) return "review";
    if (
      plan.steps.some(
        (step) =>
          step.status === "active" ||
          step.status === "done" ||
          step.status === "failed",
      )
    ) {
      return "working";
    }
    return "planning";
  }

  // -- change sets ---------------------------------------------------------

  /** Tile a staged action targets (null for add_tile / set_filter). */
  function changeActionTileId(action: ChangeAction): string | null {
    return action.kind === "add_tile" || action.kind === "set_filter"
      ? null
      : action.payload.tileId;
  }

  /**
   * Propose-time guard: every referenced tile must exist NOW and every
   * update_tile patch must fit that tile's type. A set that cannot be
   * reviewed honestly is never staged.
   */
  function checkChangeActions(actions: ChangeAction[]): string | null {
    for (const [index, action] of actions.entries()) {
      const tileId = changeActionTileId(action);
      if (tileId === null) continue;
      const tile = getTile(tileId);
      if (!tile) {
        return `Action ${index} (${action.kind}) references unknown tile "${tileId}". Use get_dashboard_state to list tiles.`;
      }
      if (action.kind === "set_tile_filters" && tile.type === "markdown") {
        return `Action ${index} (set_tile_filters) targets a markdown tile, which cannot have filters.`;
      }
      if (action.kind === "update_tile" && action.payload.patch.spec) {
        const parsed = tileSpecPatchSchemas[tile.type].safeParse(
          action.payload.patch.spec,
        );
        if (!parsed.success) {
          return `Action ${index} (update_tile) does not fit a ${tile.type} tile spec: ${z.prettifyError(parsed.error)}`;
        }
      }
    }
    return null;
  }

  /** Run ONE staged action through the normal (undoable) command layer. */
  function runChangeAction(action: ChangeAction, meta: ActionMeta): ActionResult {
    const store = get();
    switch (action.kind) {
      case "add_tile": {
        const payload = action.payload;
        const input: AddTileInput =
          payload.type === "markdown"
            ? {
                ...payload,
                // Same raw-HTML strip the add_tile tool applies.
                spec: {
                  ...payload.spec,
                  content: payload.spec.content.replace(/<[^>]*>/g, ""),
                },
              }
            : payload;
        return store.addTile(input, meta);
      }
      case "update_tile": {
        const { tileId, patch } = action.payload;
        const tile = getTile(tileId);
        const spec = patch.spec;
        const sanitized =
          tile?.type === "markdown" && typeof spec?.["content"] === "string"
            ? {
                ...patch,
                spec: {
                  ...spec,
                  content: (spec["content"] as string).replace(/<[^>]*>/g, ""),
                },
              }
            : patch;
        return store.updateTile(tileId, sanitized, meta);
      }
      case "remove_tile":
        return store.removeTile(action.payload.tileId, meta);
      case "add_annotation":
        return store.addAnnotation(
          action.payload.tileId,
          action.payload.text,
          action.payload.anchor,
          meta,
        );
      case "set_filter":
        return store.setFilter(action.payload, meta);
      case "set_tile_filters":
        return store.setTileFilters(
          action.payload.tileId,
          action.payload.filters,
          meta,
        );
    }
  }

  /** Presence patch that also re-derives the session phase after a review. */
  function settleChangeSets(changeSets: ChangeSet[]): { presence: PresenceState } {
    const presence = get().presence;
    const next: PresenceState = { ...presence, changeSets };
    if (next.session && next.session.phase === "review") {
      next.session = {
        ...next.session,
        phase: resumedPhase(next),
        updatedAt: Date.now(),
      };
    }
    return { presence: next };
  }

  return {
    doc: createInitialDoc(),
    undoStack: [],
    redoStack: [],
    activityLog: [],
    recentHumanEdits: [],
    agentPulse: {},
    presence: createInitialPresence(),
    selectedTileId: null,
    brushedRange: null,
    hoveredTileId: null,
    hoveredField: null,

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

    /**
     * Pack the active page's tiles upward into free space (design: "Tidy").
     * One command, so the whole layout change is a single undo step.
     */
    tidyLayout(meta: ActionMeta): ActionResult {
      const doc = get().doc;
      const page = doc.pages.find((p) => p.id === doc.activePageId);
      if (!page || page.tiles.length === 0) {
        return { ok: false, error: "This page has no visuals to tidy." };
      }
      const placed: Tile[] = [];
      const ordered = [...page.tiles].sort(
        (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
      );
      let moved = 0;
      for (const tile of ordered) {
        let y = tile.layout.y;
        while (
          y > 0 &&
          !placed.some((other) =>
            overlaps({ ...tile.layout, y: y - 1 }, other.layout),
          )
        ) {
          y -= 1;
        }
        if (y !== tile.layout.y) moved += 1;
        placed.push({ ...tile, layout: { ...tile.layout, y } });
      }
      if (moved === 0) {
        return { ok: false, error: "The layout is already tidy." };
      }
      const byId = new Map(placed.map((tile) => [tile.id, tile]));
      const next = {
        ...doc,
        pages: doc.pages.map((p) =>
          p.id === page.id
            ? { ...p, tiles: p.tiles.map((tile) => byId.get(tile.id) ?? tile) }
            : p,
        ),
      };
      return commit(meta, next, {
        humanProps: placed.map((tile) => ({
          tileId: tile.id,
          property: "layout",
        })),
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

    // -- collaboration presence (ephemeral, activity-logged, not undoable) ---

    startWorkSession(objective: string): ActionResult {
      const trimmed = typeof objective === "string" ? objective.trim() : "";
      if (trimmed.length === 0) {
        return { ok: false, error: "A work-session objective is required." };
      }
      if (trimmed.length > 600) {
        return {
          ok: false,
          error: "The work-session objective must be 600 characters or fewer.",
        };
      }

      const current = get().presence.session;
      const now = Date.now();
      if (current && current.phase !== "complete") {
        set((s) => ({
          presence: {
            ...s.presence,
            session: { ...current, objective: trimmed, updatedAt: now },
          },
        }));
        logPresence(`Updated work brief: “${trimmed}”`, "human");
        return { ok: true, sessionId: current.id };
      }

      const session = {
        id: genId("session"),
        objective: trimmed,
        phase: "ready" as const,
        createdAt: now,
        updatedAt: now,
        outcomes: [],
      };
      set((s) => ({
        presence: {
          // A completed session's plan/reviews belong to that old session.
          ...(current
            ? { plan: null, insights: [], decisions: [], changeSets: [] }
            : s.presence),
          session,
        },
      }));
      logPresence(`Started work session: “${trimmed}”`, "human");
      return { ok: true, sessionId: session.id };
    },

    pauseWorkSession(): ActionResult {
      const session = get().presence.session;
      if (!session) {
        return { ok: false, error: "No work session is active." };
      }
      if (session.phase === "complete") {
        return { ok: false, error: "The work session is already complete." };
      }
      if (session.phase === "paused") {
        return { ok: false, error: "The work session is already paused." };
      }
      set((s) => ({
        presence: {
          ...s.presence,
          session: { ...session, phase: "paused", updatedAt: Date.now() },
        },
      }));
      logPresence("Paused the work session", "human");
      return { ok: true, sessionId: session.id };
    },

    resumeWorkSession(): ActionResult {
      const presence = get().presence;
      const session = presence.session;
      if (!session) {
        return { ok: false, error: "No work session is active." };
      }
      if (session.phase !== "paused") {
        return { ok: false, error: "The work session is not paused." };
      }
      const phase = resumedPhase(presence);
      set((s) => ({
        presence: {
          ...s.presence,
          session: { ...session, phase, updatedAt: Date.now() },
        },
      }));
      logPresence("Resumed the work session", "human");
      return { ok: true, sessionId: session.id };
    },

    requestDecision(input: RequestDecisionInput): ActionResult {
      const parsed = requestDecisionInput.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: `Invalid decision request: ${z.prettifyError(parsed.error)}`,
        };
      }
      const currentSession = get().presence.session;
      if (currentSession?.phase === "complete") {
        return {
          ok: false,
          error: "The work session is complete. Start a new brief first.",
        };
      }
      const now = Date.now();
      const decision: DecisionRequest = {
        id: genId("decision"),
        question: parsed.data.question,
        context: parsed.data.context,
        options: parsed.data.options.map((option) => ({ ...option })),
        ...(parsed.data.recommendedOptionId
          ? { recommendedOptionId: parsed.data.recommendedOptionId }
          : {}),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        presence: {
          ...s.presence,
          decisions: [...s.presence.decisions, decision],
          session:
            s.presence.session &&
            s.presence.session.phase !== "paused" &&
            s.presence.session.phase !== "complete"
              ? {
                  ...s.presence.session,
                  phase: "review",
                  updatedAt: now,
                }
              : s.presence.session,
        },
      }));
      logPresence(`Decision requested: “${decision.question}”`);
      return { ok: true, decisionId: decision.id };
    },

    answerDecision(
      id: string,
      optionId: string,
      note?: string,
    ): ActionResult {
      const presence = get().presence;
      const decision = presence.decisions.find((item) => item.id === id);
      if (!decision) {
        return { ok: false, error: `No decision with id "${id}".` };
      }
      if (decision.status !== "pending") {
        return {
          ok: false,
          error: `Decision "${decision.question}" was already ${decision.status}.`,
        };
      }
      if (!decision.options.some((option) => option.id === optionId)) {
        return {
          ok: false,
          error: `Option "${optionId}" does not belong to decision "${id}".`,
        };
      }
      if (note !== undefined && typeof note !== "string") {
        return { ok: false, error: "Decision note must be a string." };
      }
      const normalizedNote = note?.trim();
      if (normalizedNote && normalizedNote.length > 600) {
        return {
          ok: false,
          error: "Decision note must be 600 characters or fewer.",
        };
      }

      const now = Date.now();
      const decisions = presence.decisions.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "answered" as const,
              answer: {
                optionId,
                ...(normalizedNote ? { note: normalizedNote } : {}),
              },
              updatedAt: now,
            }
          : item,
      );
      const nextPresence: PresenceState = { ...presence, decisions };
      if (
        nextPresence.session?.phase === "review" &&
        !decisions.some((item) => item.status === "pending")
      ) {
        nextPresence.session = {
          ...nextPresence.session,
          phase: resumedPhase(nextPresence),
          updatedAt: now,
        };
      }
      set({ presence: nextPresence });
      const option = decision.options.find((item) => item.id === optionId)!;
      logPresence(
        `Answered decision “${decision.question}”: ${option.label}`,
        "human",
      );
      return { ok: true, decisionId: id };
    },

    dismissDecision(id: string): ActionResult {
      const presence = get().presence;
      const decision = presence.decisions.find((item) => item.id === id);
      if (!decision) {
        return { ok: false, error: `No decision with id "${id}".` };
      }
      if (decision.status !== "pending") {
        return {
          ok: false,
          error: `Decision "${decision.question}" was already ${decision.status}.`,
        };
      }
      const now = Date.now();
      const decisions = presence.decisions.map((item) =>
        item.id === id
          ? { ...item, status: "dismissed" as const, updatedAt: now }
          : item,
      );
      const nextPresence: PresenceState = { ...presence, decisions };
      if (
        nextPresence.session?.phase === "review" &&
        !decisions.some((item) => item.status === "pending")
      ) {
        nextPresence.session = {
          ...nextPresence.session,
          phase: resumedPhase(nextPresence),
          updatedAt: now,
        };
      }
      set({ presence: nextPresence });
      logPresence(`Dismissed decision: “${decision.question}”`, "human");
      return { ok: true, decisionId: id };
    },

    completeWork(summary: string, outcomes: string[]): ActionResult {
      const parsed = completeWorkInput.safeParse({ summary, outcomes });
      if (!parsed.success) {
        return {
          ok: false,
          error: `Invalid work summary: ${z.prettifyError(parsed.error)}`,
        };
      }
      const session = get().presence.session;
      if (!session) {
        return {
          ok: false,
          error: "No work session is active. A human must start a brief first.",
        };
      }
      if (session.phase === "complete") {
        return { ok: false, error: "The work session is already complete." };
      }
      const now = Date.now();
      set((s) => ({
        presence: {
          ...s.presence,
          session: {
            ...session,
            phase: "complete",
            summary: parsed.data.summary,
            outcomes: [...parsed.data.outcomes],
            completedAt: now,
            updatedAt: now,
          },
        },
      }));
      logPresence(`Completed work: “${parsed.data.summary}”`);
      return { ok: true, sessionId: session.id };
    },

    presentPlan(input: PresentPlanInput): ActionResult {
      if (input.steps.length === 0) {
        return { ok: false, error: "A plan needs at least one step." };
      }
      const now = Date.now();
      const plan = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        steps: input.steps.map((st) => ({
          label: st.label,
          status: st.status ?? ("pending" as const),
        })),
        updatedAt: now,
      };
      set((s) => ({
        presence: {
          ...s.presence,
          plan,
          session:
            s.presence.session &&
            s.presence.session.phase !== "paused" &&
            s.presence.session.phase !== "complete"
              ? {
                  ...s.presence.session,
                  phase: s.presence.decisions.some(
                    (decision) => decision.status === "pending",
                  )
                    ? "review"
                    : plan.steps.every((step) => step.status === "done")
                      ? "review"
                      : plan.steps.some((step) => step.status !== "pending")
                        ? "working"
                        : s.presence.session.phase === "ready"
                          ? "planning"
                          : s.presence.session.phase,
                  updatedAt: now,
                }
              : s.presence.session,
        },
      }));
      logPresence(
        input.title !== undefined
          ? `Agent shared a plan: “${input.title}”`
          : "Agent shared a plan",
      );
      return { ok: true };
    },

    updatePlanStep(index: number, status: PlanStepStatus): ActionResult {
      const plan = get().presence.plan;
      if (!plan) {
        return {
          ok: false,
          error: "No plan is shared. Call present_plan first.",
        };
      }
      if (!Number.isInteger(index) || index < 0 || index >= plan.steps.length) {
        return {
          ok: false,
          error: `Step index ${index} is out of range (0..${plan.steps.length - 1}).`,
        };
      }
      const now = Date.now();
      const steps = plan.steps.map((st, i) =>
        i === index ? { ...st, status } : st,
      );
      set((s) => {
        const session = s.presence.session;
        let phase = session?.phase;
        if (session && phase !== "paused" && phase !== "complete") {
          if (s.presence.decisions.some((item) => item.status === "pending")) {
            phase = "review";
          } else if (steps.every((step) => step.status === "done")) {
            phase = "review";
          } else if (steps.some((step) => step.status !== "pending")) {
            phase = "working";
          } else if (phase === "ready") {
            phase = "planning";
          }
        }
        return {
          presence: {
            ...s.presence,
            plan: { ...plan, steps, updatedAt: now },
            session:
              session && phase
                ? { ...session, phase, updatedAt: now }
                : session,
          },
        };
      });
      logPresence(`Plan step “${plan.steps[index]!.label}” marked ${status}`);
      return { ok: true };
    },

    clearPlan(): ActionResult {
      if (!get().presence.plan) {
        return { ok: false, error: "No plan is shared." };
      }
      set((s) => ({ presence: { ...s.presence, plan: null } }));
      logPresence("Agent cleared its plan");
      return { ok: true };
    },

    proposeInsight(input: ProposeInsightInput): ActionResult {
      if (input.tileId && !getTile(input.tileId)) {
        return notFound(input.tileId);
      }
      if (input.suggestedAction) {
        const parsed = suggestedActionSchema.safeParse(input.suggestedAction);
        if (!parsed.success) {
          return {
            ok: false,
            error: `Invalid suggestedAction: ${z.prettifyError(parsed.error)}`,
          };
        }
        if (
          parsed.data.kind === "add_annotation" &&
          !getTile(parsed.data.payload.tileId)
        ) {
          return notFound(parsed.data.payload.tileId);
        }
      }
      const now = Date.now();
      const insight: Insight = {
        id: genId("ins"),
        title: input.title,
        body: input.body,
        severity: input.severity ?? "info",
        ...(input.tileId ? { tileId: input.tileId } : {}),
        ...(input.suggestedAction
          ? { suggestedAction: input.suggestedAction }
          : {}),
        state: "proposed",
        at: now,
      };
      set((s) => ({
        presence: {
          ...s.presence,
          insights: [...s.presence.insights, insight].slice(-MAX_INSIGHTS),
          session:
            s.presence.session &&
            s.presence.session.phase !== "paused" &&
            s.presence.session.phase !== "complete"
              ? { ...s.presence.session, phase: "review", updatedAt: now }
              : s.presence.session,
        },
      }));
      logPresence(`Insight proposed: “${input.title}”`);
      return { ok: true, insightId: insight.id };
    },

    acceptInsight(id: string): ActionResult {
      const insight = get().presence.insights.find((i) => i.id === id);
      if (!insight) return { ok: false, error: `No insight with id "${id}".` };
      if (insight.state !== "proposed") {
        return {
          ok: false,
          error: `Insight "${insight.title}" was already ${insight.state}.`,
        };
      }
      let result: ActionResult = { ok: true };
      const action = insight.suggestedAction;
      if (action) {
        // Execute through the EXISTING command layer: attributed to the
        // agent (glow + AI chip) and fully undoable like any agent edit.
        const meta: ActionMeta = {
          origin: "agent",
          label: `Insight accepted: “${insight.title}”`,
        };
        if (action.kind === "add_annotation") {
          result = get().addAnnotation(
            action.payload.tileId,
            action.payload.text,
            action.payload.anchor,
            meta,
          );
        } else if (action.kind === "add_tile") {
          const payload = action.payload;
          const input =
            payload.type === "markdown"
              ? {
                  ...payload,
                  spec: {
                    ...payload.spec,
                    // Same raw-HTML strip as the add_tile tool applies.
                    content: payload.spec.content.replace(/<[^>]*>/g, ""),
                  },
                }
              : payload;
          result = get().addTile(input, meta);
        } else {
          result = get().setFilter(action.payload, meta);
        }
        if (!result.ok) return result; // stays proposed; user can retry
      }
      set((s) => {
        const now = Date.now();
        const insights = s.presence.insights.map((i) =>
          i.id === id ? { ...i, state: "accepted" as const } : i,
        );
        const nextPresence = { ...s.presence, insights };
        const session = s.presence.session;
        return {
          presence: {
            ...nextPresence,
            session:
              session && session.phase === "review"
                ? {
                    ...session,
                    phase: resumedPhase(nextPresence),
                    updatedAt: now,
                  }
                : session,
          },
        };
      });
      if (!action) logPresence(`Insight accepted: “${insight.title}”`);
      return { ...result, insightId: id };
    },

    dismissInsight(id: string): ActionResult {
      const insight = get().presence.insights.find((i) => i.id === id);
      if (!insight) return { ok: false, error: `No insight with id "${id}".` };
      if (insight.state !== "proposed") {
        return {
          ok: false,
          error: `Insight "${insight.title}" was already ${insight.state}.`,
        };
      }
      set((s) => {
        const now = Date.now();
        const insights = s.presence.insights.map((i) =>
          i.id === id ? { ...i, state: "dismissed" as const } : i,
        );
        const nextPresence = { ...s.presence, insights };
        const session = s.presence.session;
        return {
          presence: {
            ...nextPresence,
            session:
              session && session.phase === "review"
                ? {
                    ...session,
                    phase: resumedPhase(nextPresence),
                    updatedAt: now,
                  }
                : session,
          },
        };
      });
      logPresence(`Insight dismissed: “${insight.title}”`);
      return { ok: true, insightId: id };
    },

    // -- change sets: reviewable multi-action proposals -----------------------

    proposeChangeSet(input: ProposeChangeSetInput): ActionResult {
      const parsed = proposeChangeSetInput.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          error: `Invalid change set: ${z.prettifyError(parsed.error)}`,
        };
      }
      const session = get().presence.session;
      if (session?.phase === "complete") {
        return {
          ok: false,
          error: "The work session is complete. Start a new brief first.",
        };
      }
      const actions = parsed.data.actions as ChangeAction[];
      const invalid = checkChangeActions(actions);
      if (invalid) return { ok: false, error: invalid };

      const now = Date.now();
      const changeSet: ChangeSet = {
        id: genId("cs"),
        title: parsed.data.title,
        rationale: parsed.data.rationale,
        actions: actions.map((action) => ({ ...action })),
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        presence: {
          ...s.presence,
          changeSets: [...s.presence.changeSets, changeSet].slice(
            -MAX_CHANGE_SETS,
          ),
          session:
            s.presence.session &&
            s.presence.session.phase !== "paused" &&
            s.presence.session.phase !== "complete"
              ? { ...s.presence.session, phase: "review", updatedAt: now }
              : s.presence.session,
        },
      }));
      logPresence(
        `Change set proposed: “${changeSet.title}” (${changeSet.actions.length} changes)`,
      );
      return { ok: true, changeSetId: changeSet.id };
    },

    /**
     * Human approval path. Every selected action runs through the normal
     * command layer (attributed, conflict-forced because the human just
     * approved it) and the resulting entries are then COLLAPSED into one
     * undo entry + one activity entry: Cmd+Z reverts the whole set.
     */
    applyChangeSet(id: string, options?: ApplyChangeSetOptions): ActionResult {
      const before = get();
      const changeSet = before.presence.changeSets.find((c) => c.id === id);
      if (!changeSet) {
        return { ok: false, error: `No change set with id "${id}".` };
      }
      if (changeSet.status !== "proposed") {
        return {
          ok: false,
          error: `Change set “${changeSet.title}” was already ${changeSet.status}.`,
        };
      }
      const skipIndexes = options?.skipIndexes ?? [];
      for (const index of skipIndexes) {
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= changeSet.actions.length
        ) {
          return {
            ok: false,
            error: `skipIndexes entry ${index} is out of range (0..${changeSet.actions.length - 1}).`,
          };
        }
      }
      const skipped = new Set(skipIndexes);
      const indexes = changeSet.actions
        .map((_, index) => index)
        .filter((index) => !skipped.has(index));
      if (indexes.length === 0) {
        return {
          ok: false,
          error:
            "Every action was skipped: nothing to apply. Reject the change set instead.",
        };
      }

      // Exact pre-apply snapshot: a failing action rewinds doc AND history.
      const snapshot = {
        doc: before.doc,
        undoStack: before.undoStack,
        redoStack: before.redoStack,
        activityLog: before.activityLog,
        recentHumanEdits: before.recentHumanEdits,
        agentPulse: before.agentPulse,
        selectedTileId: before.selectedTileId,
        hoveredTileId: before.hoveredTileId,
        brushedRange: before.brushedRange,
      };
      const label = `Applied change set: “${changeSet.title}” (${indexes.length} change${indexes.length === 1 ? "" : "s"})`;
      // force: the human approved this set in the review card.
      const meta: ActionMeta = { origin: "agent", label, force: true };

      for (const index of indexes) {
        const action = changeSet.actions[index]!;
        const result = runChangeAction(action, meta);
        if (!result.ok) {
          set(snapshot);
          const detail = result.conflict ? result.hint : result.error;
          return {
            ok: false,
            error: `Change set “${changeSet.title}” failed at action ${index} (${action.kind}): ${detail} Nothing was applied.`,
          };
        }
      }

      const now = Date.now();
      const entryId = genId("cmd");
      const status =
        indexes.length === changeSet.actions.length
          ? ("applied" as const)
          : ("partially_applied" as const);
      set((s) => {
        const changeSets = s.presence.changeSets.map((item) =>
          item.id === id
            ? {
                ...item,
                status,
                appliedActionIndexes: [...indexes],
                updatedAt: now,
              }
            : item,
        );
        const presence: PresenceState = { ...s.presence, changeSets };
        if (presence.session && presence.session.phase === "review") {
          presence.session = {
            ...presence.session,
            phase: resumedPhase(presence),
            updatedAt: now,
          };
        }
        return {
          // Collapse: one undo entry back to the pre-apply document, one
          // activity line — the review, not its individual commands.
          undoStack: [
            ...snapshot.undoStack,
            { id: entryId, by: "agent" as const, label, at: now, doc: snapshot.doc },
          ].slice(-MAX_HISTORY),
          redoStack: [],
          activityLog: [
            { id: entryId, by: "agent" as const, label, at: now, undone: false },
            ...snapshot.activityLog,
          ].slice(0, MAX_ACTIVITY),
          presence,
        };
      });
      return { ok: true, changeSetId: id };
    },

    rejectChangeSet(id: string): ActionResult {
      const changeSet = get().presence.changeSets.find((c) => c.id === id);
      if (!changeSet) {
        return { ok: false, error: `No change set with id "${id}".` };
      }
      if (changeSet.status !== "proposed") {
        return {
          ok: false,
          error: `Change set “${changeSet.title}” was already ${changeSet.status}.`,
        };
      }
      const now = Date.now();
      set(
        settleChangeSets(
          get().presence.changeSets.map((item) =>
            item.id === id
              ? { ...item, status: "rejected" as const, updatedAt: now }
              : item,
          ),
        ),
      );
      logPresence(`Change set rejected: “${changeSet.title}”`, "human");
      return { ok: true, changeSetId: id };
    },

    reviseChangeSet(id: string, input: ReviseChangeSetInput): ActionResult {
      const changeSet = get().presence.changeSets.find((c) => c.id === id);
      if (!changeSet) {
        return { ok: false, error: `No change set with id "${id}".` };
      }
      if (changeSet.status !== "proposed") {
        return {
          ok: false,
          error: `Change set “${changeSet.title}” was already ${changeSet.status}; propose a new one.`,
        };
      }
      const parsed = reviseChangeSetInput.safeParse({
        changeSetId: id,
        ...input,
      });
      if (!parsed.success) {
        return {
          ok: false,
          error: `Invalid revision: ${z.prettifyError(parsed.error)}`,
        };
      }
      const actions = parsed.data.actions as ChangeAction[] | undefined;
      if (actions) {
        const invalid = checkChangeActions(actions);
        if (invalid) return { ok: false, error: invalid };
      }
      const now = Date.now();
      set((s) => ({
        presence: {
          ...s.presence,
          changeSets: s.presence.changeSets.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...(parsed.data.title !== undefined
                    ? { title: parsed.data.title }
                    : {}),
                  ...(parsed.data.rationale !== undefined
                    ? { rationale: parsed.data.rationale }
                    : {}),
                  ...(actions
                    ? { actions: actions.map((action) => ({ ...action })) }
                    : {}),
                  updatedAt: now,
                }
              : item,
          ),
        },
      }));
      logPresence(
        `Change set revised: “${parsed.data.title ?? changeSet.title}”`,
      );
      return { ok: true, changeSetId: id };
    },

    withdrawChangeSet(id: string): ActionResult {
      const changeSet = get().presence.changeSets.find((c) => c.id === id);
      if (!changeSet) {
        return { ok: false, error: `No change set with id "${id}".` };
      }
      if (changeSet.status !== "proposed") {
        return {
          ok: false,
          error: `Change set “${changeSet.title}” was already ${changeSet.status}; it cannot be withdrawn.`,
        };
      }
      set(
        settleChangeSets(
          get().presence.changeSets.filter((item) => item.id !== id),
        ),
      );
      logPresence(`Change set withdrawn: “${changeSet.title}”`);
      return { ok: true, changeSetId: id };
    },

    withdrawDecision(id: string): ActionResult {
      const presence = get().presence;
      const decision = presence.decisions.find((item) => item.id === id);
      if (!decision) {
        return { ok: false, error: `No decision with id "${id}".` };
      }
      if (decision.status !== "pending") {
        return {
          ok: false,
          error: `Decision “${decision.question}” was already ${decision.status}; it cannot be withdrawn.`,
        };
      }
      const now = Date.now();
      const next: PresenceState = {
        ...presence,
        decisions: presence.decisions.filter((item) => item.id !== id),
      };
      if (next.session && next.session.phase === "review") {
        next.session = {
          ...next.session,
          phase: resumedPhase(next),
          updatedAt: now,
        };
      }
      set({ presence: next });
      logPresence(`Decision withdrawn: “${decision.question}”`);
      return { ok: true, decisionId: id };
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

    setHoveredField(field: HoveredField | null): void {
      set({ hoveredField: field ? { ...field } : null });
    },

    clearAgentPulse(tileId: string): void {
      set((s) => {
        if (!(tileId in s.agentPulse)) return s;
        const next = { ...s.agentPulse };
        delete next[tileId];
        return { agentPulse: next };
      });
    },

    /**
     * Adopt collaboration state published by another participant.
     *
     * Deliberately not a merge. Two tabs holding different opinions about
     * which proposals are still pending is worse than one of them being a
     * few seconds behind — a merge could resurrect a change set the other
     * person just approved, and ask them to approve it twice.
     *
     * It touches presence only: the document, history and attribution have
     * their own path and must not be disturbed by a proposal arriving.
     */
    adoptPresence(next: PresenceState): void {
      set({ presence: next });
    },

    resetDashboard(doc?: DashboardDocInput): void {
      set({
        doc: doc ? migrateDoc(doc) : createInitialDoc(),
        undoStack: [],
        redoStack: [],
        activityLog: [],
        recentHumanEdits: [],
        agentPulse: {},
        // Presence is scoped to the working session on ONE doc: a doc
        // switch/load drops the plan card and any pending insights.
        presence: createInitialPresence(),
        selectedTileId: null,
        brushedRange: null,
        hoveredTileId: null,
        hoveredField: null,
      });
    },
  };
});
