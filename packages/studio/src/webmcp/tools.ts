import * as z from "zod";
import {
  applyRowCap,
  assertReadOnly,
  quoteIdent,
  ReadOnlySQLError,
  type DataSource,
} from "@kontier-ri/datasource";
import {
  addAnnotationInput,
  addTileInput,
  clearGlobalFiltersInput,
  describeTileInput,
  editSelectedTileInput,
  explainSelectedTileInput,
  getActivityLogInput,
  getDashboardStateInput,
  getDatasetSchemaInput,
  getUserFocusInput,
  listDatasetsInput,
  moveTileInput,
  profileColumnInput,
  removeTileInput,
  restyleSelectedTileInput,
  runSqlInput,
  sampleRowsInput,
  setDashboardTitleInput,
  setDateRangeInput,
  setGlobalFilterInput,
  setThemeInput,
  tileSpecPatchSchemas,
  tileSpecSchemas,
  updateTileInput,
} from "../schemas";
import { pruneHumanEdits, useDashboardStore } from "../store";
import { buildTileQuerySQL, summarizeSpec } from "../tile-sql";
import type {
  ActionResult,
  AddTileInput,
  DashboardStore,
  Tile,
  TilePatch,
} from "../types";

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

export interface StudioStoreApi {
  getState(): DashboardStore;
}

export interface ToolContext {
  dataSource: DataSource;
  /** Defaults to the module-level useDashboardStore. */
  store?: StudioStoreApi;
}

/** A ready-to-register WebMCP tool (execute is directly unit-testable). */
export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: S;
  execute: (input: z.output<S>, signal: AbortSignal) => Promise<unknown> | unknown;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
}

/** Identity helper: per-tool input inference + erased element type. */
function tool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition {
  return def as unknown as ToolDefinition;
}

const READ_ONLY = { readOnlyHint: true } as const;
const VALUE_MAX_CHARS = 120;
const DESCRIBE_ROW_CAP = 50;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function zodIssues(error: z.ZodError): string {
  return z.prettifyError(error);
}

/** Compact a cell value for agent-facing JSON (strings capped at 120 chars). */
export function compactValue(v: unknown, max = VALUE_MAX_CHARS): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
  if (typeof v === "string" && v.length > max) return `${v.slice(0, max - 1)}…`;
  return v;
}

/** Strip raw HTML from markdown tile content (render sanitizes again). */
export function sanitizeMarkdown(content: string): string {
  return content.replace(/<[^>]*>/g, "");
}

const RO_HINT =
  "Only a single read-only statement is allowed (SELECT/WITH/DESCRIBE/SUMMARIZE). " +
  "No DDL/DML/PRAGMA/ATTACH. DuckDB SQL dialect.";

function sqlError(err: unknown): { error: string; hint: string } {
  if (err instanceof ReadOnlySQLError) return { error: err.message, hint: RO_HINT };
  return {
    error: message(err),
    hint:
      "Check dataset/column names with list_datasets and get_dataset_schema. " +
      "DuckDB SQL dialect.",
  };
}

/**
 * Run a query through the datasource read-only guard with an explicit row
 * cap; the extra row past the cap only signals truncation.
 */
async function runCapped(
  ds: DataSource,
  sql: string,
  limit: number,
): Promise<{
  columns: { name: string; type: string }[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}> {
  const validated = assertReadOnly(sql);
  const res = await ds.runQuery(applyRowCap(validated, limit));
  const truncated = res.truncated || res.rows.length > limit;
  const rows = res.rows
    .slice(0, limit)
    .map((row) => row.map((v) => compactValue(v)));
  return {
    columns: res.columns.map((c) => ({ name: c.name, type: c.type })),
    rows,
    rowCount: rows.length,
    truncated,
  };
}

/** Map a store ActionResult onto the agent-facing tool result. */
function toToolResult(
  result: ActionResult,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (result.ok) {
    return {
      ok: true,
      ...(result.tileId ? { tileId: result.tileId } : {}),
      ...extra,
    };
  }
  if (result.conflict) {
    return {
      conflict: true,
      ...(result.tileId ? { tileId: result.tileId } : {}),
      properties: result.properties,
      hint: result.hint,
    };
  }
  return { error: result.error };
}

const NUMERIC_TYPE = /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGEINT|NUMERIC/i;

function iso(at: number): string {
  return new Date(at).toISOString();
}

function shortValue(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/**
 * Validate + sanitize an update patch against the tile's per-type spec
 * schema (strict partial: unknown keys rejected with a helpful error).
 */
function checkTilePatch(
  tile: Tile,
  patch: { title?: string; spec?: Record<string, unknown> },
):
  | { ok: true; patch: TilePatch }
  | { ok: false; error: string } {
  const out: TilePatch = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.spec !== undefined) {
    const parsed = tileSpecPatchSchemas[tile.type].safeParse(patch.spec);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Patch does not fit a ${tile.type} tile spec: ${zodIssues(parsed.error)}`,
      };
    }
    const spec = { ...parsed.data } as Record<string, unknown>;
    if (tile.type === "markdown" && typeof spec["content"] === "string") {
      spec["content"] = sanitizeMarkdown(spec["content"]);
    }
    out.spec = spec;
  }
  if (out.title === undefined && out.spec === undefined) {
    return { ok: false, error: "Empty patch: provide title and/or spec keys." };
  }
  return { ok: true, patch: out };
}

function describeTilePayload(tile: Tile) {
  return {
    tileId: tile.id,
    type: tile.type,
    title: tile.title,
    layout: tile.layout,
    spec: tile.spec,
    ...(tile.annotations.length > 0
      ? {
          annotations: tile.annotations.map((a) => ({
            text: a.text,
            by: a.by,
          })),
        }
      : {}),
  };
}

async function tileDataSummary(ds: DataSource, tile: Tile): Promise<unknown> {
  if (tile.type === "markdown") return null;
  const sql = buildTileQuerySQL(tile);
  if (!sql) return { error: "Tile spec has no query (missing sql or measure+agg)." };
  try {
    return await runCapped(ds, sql, DESCRIBE_ROW_CAP);
  } catch (err) {
    return sqlError(err);
  }
}

// ---------------------------------------------------------------------------
// Static tools (19)
// ---------------------------------------------------------------------------

export function buildStaticTools(ctx: ToolContext): ToolDefinition[] {
  const ds = ctx.dataSource;
  const store: StudioStoreApi = ctx.store ?? useDashboardStore;
  const state = () => store.getState();

  const findTile = (tileId: string): Tile | undefined =>
    state().doc.tiles.find((t) => t.id === tileId);

  const applyPatch = (
    tile: Tile,
    patch: { title?: string; spec?: Record<string, unknown> },
    force: boolean | undefined,
  ): Record<string, unknown> => {
    const checked = checkTilePatch(tile, patch);
    if (!checked.ok) return { error: checked.error };
    const props = [
      ...(checked.patch.title !== undefined ? ["title"] : []),
      ...Object.keys(checked.patch.spec ?? {}).map((k) => `spec.${k}`),
    ];
    const result = state().updateTile(tile.id, checked.patch, {
      origin: "agent",
      label: `Updated "${tile.title}" (${props.join(", ")})`,
      ...(force !== undefined ? { force } : {}),
    });
    return toToolResult(result, { updated: props });
  };

  const dataTools: ToolDefinition[] = [
    tool({
      name: "list_datasets",
      description:
        "List the datasets (tables) available for SQL queries and tiles: " +
        "name, row count, description.",
      inputSchema: listDatasetsInput,
      annotations: READ_ONLY,
      execute: async () => {
        const datasets = await ds.listDatasets();
        return datasets.map((d) => ({
          name: d.name,
          rowCount: d.rowCount,
          ...(d.group ? { description: `${d.group} dataset` } : {}),
        }));
      },
    }),
    tool({
      name: "get_dataset_schema",
      description:
        "Get the columns of one dataset: [{column, type}]. DuckDB type names.",
      inputSchema: getDatasetSchemaInput,
      annotations: READ_ONLY,
      execute: async ({ dataset }) => {
        try {
          const cols = await ds.getSchema(dataset);
          return cols.map((c) => ({ column: c.name, type: c.type }));
        } catch (err) {
          return {
            error: message(err),
            hint: "Unknown dataset? Call list_datasets first.",
          };
        }
      },
    }),
    tool({
      name: "profile_column",
      description:
        "Profile one column: count, nulls, distinct, min/max, top-8 values " +
        "with frequencies, and mean/p50 for numeric columns.",
      inputSchema: profileColumnInput,
      annotations: READ_ONLY,
      execute: async ({ dataset, column }) => {
        try {
          const p = await ds.profileColumn(dataset, column);
          const out: Record<string, unknown> = {
            dataset: p.dataset,
            column: p.column,
            type: p.type,
            count: p.count,
            nulls: p.nulls,
            distinct: p.distinct,
            min: compactValue(p.min),
            max: compactValue(p.max),
            topValues: p.topValues.slice(0, 8).map((t) => ({
              value: compactValue(t.value),
              count: t.count,
            })),
          };
          if (NUMERIC_TYPE.test(p.type)) {
            const q = quoteIdent(column);
            const stats = await ds.runQuery(
              `SELECT avg(${q})::DOUBLE AS mean, median(${q})::DOUBLE AS p50 FROM ${quoteIdent(dataset)}`,
            );
            const row = stats.rows[0];
            if (row) {
              out["mean"] = row[0];
              out["p50"] = row[1];
            }
          }
          return out;
        } catch (err) {
          return {
            error: message(err),
            hint: "Check names with list_datasets / get_dataset_schema.",
          };
        }
      },
    }),
    tool({
      name: "sample_rows",
      description:
        "Return the first N rows (default 10, max 20) of a dataset. Cell " +
        "values are truncated to 120 chars — use run_sql for analysis.",
      inputSchema: sampleRowsInput,
      annotations: READ_ONLY,
      execute: async ({ dataset, limit }) => {
        try {
          return await runCapped(
            ds,
            `SELECT * FROM ${quoteIdent(dataset)}`,
            limit,
          );
        } catch (err) {
          return sqlError(err);
        }
      },
    }),
    tool({
      name: "run_sql",
      description:
        "Run a single read-only SQL query (DuckDB dialect) against the " +
        "in-browser database. Returns {columns, rows, rowCount, truncated}; " +
        "rows are capped at `limit` (default 100, max 500). Aggregate before " +
        "you fetch — never page through raw data.",
      inputSchema: runSqlInput,
      annotations: READ_ONLY,
      execute: async ({ sql, limit }) => {
        try {
          return await runCapped(ds, sql, limit);
        } catch (err) {
          return sqlError(err);
        }
      },
    }),
  ];

  const buildTools: ToolDefinition[] = [
    tool({
      name: "add_tile",
      description:
        "Add a dashboard tile. spec by type — " +
        'kpi: {dataset, sql | measure+agg, format: "currency"|"number"|"percent", compare?: "prev_period"}; ' +
        'chart: {dataset, query: {sql} | {dims, measures: [{col, agg}], orderBy?, limit?}, chartType: "line"|"bar"|"area"|"pie", xKey, seriesKeys?, stacked?, color?}; ' +
        "table: {dataset, sql, pageSize<=25}; markdown: {content}. " +
        "Layout is optional (12-column grid, auto-placed). Returns {tileId}.",
      inputSchema: addTileInput,
      execute: (input) => {
        const parsed = tileSpecSchemas[input.type].safeParse(input.spec);
        if (!parsed.success) {
          return {
            error: `spec does not match tile type "${input.type}": ${zodIssues(parsed.error)}`,
          };
        }
        const spec = { ...parsed.data } as Record<string, unknown>;
        if (input.type === "markdown" && typeof spec["content"] === "string") {
          spec["content"] = sanitizeMarkdown(spec["content"]);
        }
        const result = state().addTile(
          {
            type: input.type,
            title: input.title,
            spec,
            ...(input.layout ? { layout: input.layout } : {}),
          } as unknown as AddTileInput,
          {
            origin: "agent",
            label: `Added ${input.type} tile "${input.title}"`,
          },
        );
        return toToolResult(result);
      },
    }),
    tool({
      name: "update_tile",
      description:
        "Shallow-merge a patch into a tile: {title?, spec?: {key: value}}. " +
        "Spec keys must fit the tile's type. If the user edited a property " +
        "in the last 10 minutes you get a conflict — ask the user, then " +
        "retry with force: true.",
      inputSchema: updateTileInput,
      execute: ({ tileId, patch, force }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        return applyPatch(tile, patch, force);
      },
    }),
    tool({
      name: "move_tile",
      description:
        "Move/resize a tile on the 12-column grid (x + w <= 12). Conflicts " +
        "if the user moved it in the last 10 minutes (force: true overrides).",
      inputSchema: moveTileInput,
      execute: ({ tileId, x, y, w, h, force }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        const result = state().moveTile(
          tileId,
          { x, y, w, h },
          {
            origin: "agent",
            label: `Moved "${tile.title}"`,
            ...(force !== undefined ? { force } : {}),
          },
        );
        return toToolResult(result);
      },
    }),
    tool({
      name: "remove_tile",
      description:
        "Remove a tile (soft: the user sees a 10s undo toast and can also " +
        "revert from the activity feed).",
      inputSchema: removeTileInput,
      execute: ({ tileId }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        const result = state().removeTile(tileId, {
          origin: "agent",
          label: `Removed "${tile.title}"`,
        });
        return toToolResult(result, {
          removed: true,
          undoHint: "The user can undo this from the toast or activity feed.",
        });
      },
    }),
    tool({
      name: "set_global_filter",
      description:
        "Set/replace the global filter on one column (applies to every tile " +
        'whose dataset has that column). op: eq | in | between | contains. ' +
        "between expects value: [low, high].",
      inputSchema: setGlobalFilterInput,
      execute: ({ column, op, value, force }) => {
        if (op === "between" && (!Array.isArray(value) || value.length !== 2)) {
          return { error: 'op "between" needs value: [low, high].' };
        }
        if (op === "in" && !Array.isArray(value)) {
          return { error: 'op "in" needs an array value.' };
        }
        const result = state().setFilter(
          { column, op, value },
          {
            origin: "agent",
            label: `Filtered ${column} ${op} ${shortValue(value)}`,
            ...(force !== undefined ? { force } : {}),
          },
        );
        return toToolResult(result);
      },
    }),
    tool({
      name: "clear_global_filters",
      description: "Remove all global column filters (keeps the date range).",
      inputSchema: clearGlobalFiltersInput,
      execute: () =>
        toToolResult(
          state().clearFilters({
            origin: "agent",
            label: "Cleared global filters",
          }),
        ),
    }),
    tool({
      name: "set_date_range",
      description:
        "Set the global date range (the time brush) as ISO dates, e.g. " +
        '{from: "2025-01-01", to: "2025-06-30"}.',
      inputSchema: setDateRangeInput,
      execute: ({ from, to, force }) => {
        if (from > to) {
          return { error: `from (${from}) must not be after to (${to}).` };
        }
        const result = state().setDateRange(
          { from, to },
          {
            origin: "agent",
            label: `Set date range ${from} → ${to}`,
            ...(force !== undefined ? { force } : {}),
          },
        );
        return toToolResult(result);
      },
    }),
    tool({
      name: "set_theme",
      description:
        "Change the dashboard theme: mode (dark|light) and/or palette " +
        "(a named palette or an array of hex colors).",
      inputSchema: setThemeInput,
      execute: ({ palette, mode, force }) => {
        if (palette === undefined && mode === undefined) {
          return { error: "Provide palette and/or mode." };
        }
        const parts = [
          ...(mode ? [`mode=${mode}`] : []),
          ...(palette ? [`palette=${shortValue(palette)}`] : []),
        ];
        const result = state().setTheme(
          {
            ...(palette !== undefined ? { palette } : {}),
            ...(mode !== undefined ? { mode } : {}),
          },
          {
            origin: "agent",
            label: `Set theme ${parts.join(" ")}`,
            ...(force !== undefined ? { force } : {}),
          },
        );
        return toToolResult(result);
      },
    }),
    tool({
      name: "set_dashboard_title",
      description: "Rename the dashboard.",
      inputSchema: setDashboardTitleInput,
      execute: ({ title, force }) =>
        toToolResult(
          state().setTitle(title, {
            origin: "agent",
            label: `Renamed dashboard to "${title}"`,
            ...(force !== undefined ? { force } : {}),
          }),
        ),
    }),
    tool({
      name: "add_annotation",
      description:
        "Pin a short text callout to a tile, optionally anchored to an " +
        "x value and/or series.",
      inputSchema: addAnnotationInput,
      execute: ({ tileId, text, anchor }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        const result = state().addAnnotation(tileId, text, anchor, {
          origin: "agent",
          label: `Annotated "${tile.title}"`,
        });
        return toToolResult(result);
      },
    }),
  ];

  const contextTools: ToolDefinition[] = [
    tool({
      name: "get_dashboard_state",
      description:
        "Summary of the current dashboard: title, theme, global filters, " +
        "and every tile's id/type/title/spec summary/layout. No data.",
      inputSchema: getDashboardStateInput,
      annotations: READ_ONLY,
      execute: () => {
        const { doc } = state();
        return {
          title: doc.title,
          theme: doc.theme,
          filters: doc.filters,
          tiles: doc.tiles.map((t) => ({
            tileId: t.id,
            type: t.type,
            title: t.title,
            specSummary: summarizeSpec(t),
            layout: t.layout,
            ...(t.annotations.length > 0
              ? { annotations: t.annotations.length }
              : {}),
          })),
        };
      },
    }),
    tool({
      name: "get_user_focus",
      description:
        "What the user is pointing at RIGHT NOW: selected tile, brushed " +
        "chart range, hovered tile, and their edits from the last 10 " +
        'minutes (tileId "__dashboard__" = dashboard-level properties). ' +
        'Call this whenever the user says "this", "here" or asks about ' +
        "what they are looking at.",
      inputSchema: getUserFocusInput,
      annotations: READ_ONLY,
      execute: () => {
        const s = state();
        const edits = pruneHumanEdits(s.recentHumanEdits, Date.now());
        return {
          ...(s.selectedTileId ? { selectedTileId: s.selectedTileId } : {}),
          ...(s.brushedRange ? { brushedRange: s.brushedRange } : {}),
          ...(s.hoveredTileId ? { hoveredTileId: s.hoveredTileId } : {}),
          recentHumanEdits: edits.map((e) => ({
            tileId: e.tileId,
            property: e.property,
            at: iso(e.at),
          })),
        };
      },
    }),
    tool({
      name: "describe_tile",
      description:
        "Full spec of one tile plus a summary of the data it renders " +
        "(first rows, cap 50).",
      inputSchema: describeTileInput,
      annotations: READ_ONLY,
      execute: async ({ tileId }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        return {
          ...describeTilePayload(tile),
          data: await tileDataSummary(ds, tile),
        };
      },
    }),
    tool({
      name: "get_activity_log",
      description:
        "The last 30 dashboard commands: {by: human|agent, label, at, " +
        "undone?} — newest first. Use it to see what the user (or you) " +
        "changed recently.",
      inputSchema: getActivityLogInput,
      annotations: READ_ONLY,
      execute: () =>
        state().activityLog.slice(0, 30).map((a) => ({
          by: a.by,
          label: a.label,
          at: iso(a.at),
          ...(a.undone ? { undone: true } : {}),
        })),
    }),
  ];

  return [...dataTools, ...buildTools, ...contextTools];
}

// ---------------------------------------------------------------------------
// Dynamic tools (3) — registered only while a tile is selected
// ---------------------------------------------------------------------------

export function buildSelectedTileTools(
  ctx: ToolContext,
  selected?: Pick<Tile, "type" | "title">,
): ToolDefinition[] {
  const ds = ctx.dataSource;
  const store: StudioStoreApi = ctx.store ?? useDashboardStore;
  const state = () => store.getState();

  /** Selection is resolved at EXECUTE time — never from a stale closure. */
  const selectedTile = (): Tile | null => {
    const s = state();
    return s.doc.tiles.find((t) => t.id === s.selectedTileId) ?? null;
  };

  const noSelection = {
    error: "No tile is selected.",
    hint: "Ask the user to select a tile, or use update_tile with a tileId.",
  };

  const label = selected ? ` (currently "${selected.title}")` : "";

  const applyPatch = (
    tile: Tile,
    patch: { title?: string; spec?: Record<string, unknown> },
    force: boolean | undefined,
  ): Record<string, unknown> => {
    const checked = checkTilePatch(tile, patch);
    if (!checked.ok) return { error: checked.error };
    const props = [
      ...(checked.patch.title !== undefined ? ["title"] : []),
      ...Object.keys(checked.patch.spec ?? {}).map((k) => `spec.${k}`),
    ];
    const result = state().updateTile(tile.id, checked.patch, {
      origin: "agent",
      label: `Updated "${tile.title}" (${props.join(", ")})`,
      ...(force !== undefined ? { force } : {}),
    });
    return toToolResult(result, { updated: props });
  };

  return [
    tool({
      name: "edit_selected_tile",
      description:
        `Patch the tile the user has selected${label} without needing its ` +
        "id: {patch: {title?, spec?}} like update_tile.",
      inputSchema: editSelectedTileInput,
      execute: ({ patch, force }) => {
        const tile = selectedTile();
        if (!tile) return noSelection;
        return applyPatch(tile, patch, force);
      },
    }),
    tool({
      name: "restyle_selected_tile",
      description:
        `Restyle the selected chart tile${label}: change color, chart type ` +
        "(line|bar|area|pie) and/or stacking.",
      inputSchema: restyleSelectedTileInput,
      execute: ({ color, chartType, stacked, force }) => {
        const tile = selectedTile();
        if (!tile) return noSelection;
        if (tile.type !== "chart") {
          return {
            error: `Selected tile is a ${tile.type}; only chart tiles can be restyled.`,
          };
        }
        const spec: Record<string, unknown> = {
          ...(color !== undefined ? { color } : {}),
          ...(chartType !== undefined ? { chartType } : {}),
          ...(stacked !== undefined ? { stacked } : {}),
        };
        if (Object.keys(spec).length === 0) {
          return { error: "Provide color, chartType and/or stacked." };
        }
        return applyPatch(tile, { spec }, force);
      },
    }),
    tool({
      name: "explain_selected_tile",
      description:
        `Spec + rendered-data summary of the selected tile${label}, plus ` +
        "which global filters affect it.",
      inputSchema: explainSelectedTileInput,
      annotations: READ_ONLY,
      execute: async () => {
        const tile = selectedTile();
        if (!tile) return noSelection;
        const { doc } = state();
        const dataset =
          "dataset" in tile.spec ? (tile.spec as { dataset: string }).dataset : null;
        let affectingFilters = doc.filters.filters;
        if (dataset) {
          try {
            const cols = new Set(
              (await ds.getSchema(dataset)).map((c) => c.name),
            );
            affectingFilters = doc.filters.filters.filter((f) =>
              cols.has(f.column),
            );
          } catch {
            /* unknown dataset: report all global filters */
          }
        }
        return {
          ...describeTilePayload(tile),
          data: await tileDataSummary(ds, tile),
          affectedByFilters: affectingFilters,
          ...(doc.filters.dateRange ? { dateRange: doc.filters.dateRange } : {}),
        };
      },
    }),
  ];
}

export const STATIC_TOOL_NAMES = [
  "list_datasets",
  "get_dataset_schema",
  "profile_column",
  "sample_rows",
  "run_sql",
  "add_tile",
  "update_tile",
  "move_tile",
  "remove_tile",
  "set_global_filter",
  "clear_global_filters",
  "set_date_range",
  "set_theme",
  "set_dashboard_title",
  "add_annotation",
  "get_dashboard_state",
  "get_user_focus",
  "describe_tile",
  "get_activity_log",
] as const;

export const DYNAMIC_TOOL_NAMES = [
  "edit_selected_tile",
  "restyle_selected_tile",
  "explain_selected_tile",
] as const;
