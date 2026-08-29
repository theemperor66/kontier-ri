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
  addPageInput,
  addTileInput,
  clearCrossFilterInput,
  clearGlobalFiltersInput,
  createCalculatedFieldInput,
  createViewInput,
  describeTileInput,
  editSelectedTileInput,
  explainSelectedTileInput,
  exportTileDataInput,
  getActivityLogInput,
  getDashboardStateInput,
  getDatasetSchemaInput,
  getUserFocusInput,
  listCalculatedFieldsInput,
  listDatasetsInput,
  moveTileInput,
  profileColumnInput,
  removeCalculatedFieldInput,
  removePageInput,
  removeTileInput,
  removeViewInput,
  renamePageInput,
  restyleSelectedTileInput,
  runSqlInput,
  setCrossFilterInput,
  sampleRowsInput,
  setDashboardTitleInput,
  setDateRangeInput,
  setGlobalFilterInput,
  setThemeInput,
  setTileFiltersInput,
  switchPageInput,
  tileSpecPatchSchemas,
  tileSpecSchemas,
  updateTileInput,
} from "../schemas";
import { normalizeViewName, pruneHumanEdits, useDashboardStore } from "../store";
import {
  buildTileQuery,
  summarizeSpec,
  type TileQueryContext,
} from "../tile-sql";
import type {
  ActionResult,
  AddTileInput,
  DashboardDoc,
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
      ...(result.pageId ? { pageId: result.pageId } : {}),
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

/** TileQueryContext from the live doc (filters, cross-filter, calc fields). */
async function docQueryContext(
  ds: DataSource,
  doc: DashboardDoc,
): Promise<TileQueryContext> {
  let datasets: TileQueryContext["datasets"];
  try {
    datasets = (await ds.listDatasets()).map((d) => ({
      name: d.name,
      columns: d.columns.map((c) => ({ name: c.name, type: c.type })),
    }));
  } catch {
    /* schema-aware pushdown degrades gracefully */
  }
  return {
    ...(datasets ? { datasets } : {}),
    globalFilters: doc.filters.filters,
    dateRange: doc.filters.dateRange,
    crossFilter: doc.crossFilter,
    calculatedFields: doc.calculatedFields,
  };
}

/** Run a tile's query with the doc context; retry the fallback on failure. */
async function runTileQuery(
  ds: DataSource,
  tile: Tile,
  doc: DashboardDoc,
  cap: number,
): Promise<
  | Awaited<ReturnType<typeof runCapped>>
  | { error: string; hint?: string }
  | null
> {
  if (tile.type === "markdown") return null;
  const built = buildTileQuery(tile, await docQueryContext(ds, doc));
  if (!built) {
    return { error: "Tile spec has no query (missing sql or measure+agg)." };
  }
  try {
    return await runCapped(ds, built.sql, cap);
  } catch (err) {
    if (built.fallbackSQL && built.fallbackSQL !== built.sql) {
      try {
        return await runCapped(ds, built.fallbackSQL, cap);
      } catch {
        /* fall through to the primary error */
      }
    }
    return sqlError(err);
  }
}

async function tileDataSummary(
  ds: DataSource,
  tile: Tile,
  doc: DashboardDoc,
): Promise<unknown> {
  return runTileQuery(ds, tile, doc, DESCRIBE_ROW_CAP);
}

/** RFC-4180-ish CSV cell: quote when the value contains , " or newline. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCSV(columns: { name: string }[], rows: unknown[][]): string {
  const header = columns.map((c) => csvCell(c.name)).join(",");
  const body = rows.map((r) => r.map(csvCell).join(","));
  return [header, ...body].join("\n");
}

// ---------------------------------------------------------------------------
// Static tools (19)
// ---------------------------------------------------------------------------

export function buildStaticTools(ctx: ToolContext): ToolDefinition[] {
  const ds = ctx.dataSource;
  const store: StudioStoreApi = ctx.store ?? useDashboardStore;
  const state = () => store.getState();

  const findTile = (tileId: string): Tile | undefined => {
    for (const page of state().doc.pages) {
      const tile = page.tiles.find((t) => t.id === tileId);
      if (tile) return tile;
    }
    return undefined;
  };

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
          ...(d.description
            ? { description: d.description }
            : d.group
              ? { description: `${d.group} dataset` }
              : {}),
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
        "Add a dashboard tile (lands on the ACTIVE page). spec by type — " +
        'kpi: {dataset, sql | measure+agg, format: "currency"|"number"|"percent"|{style,currency?}, compare?: "prev_period", filters?, rules?}; ' +
        'chart: {dataset, query: {sql} | {dims, measures: [{col, agg}], orderBy?, limit?, othersBucket?}, chartType: "line"|"bar"|"area"|"pie"|"scatter"|"combo"|"donut"|"hbar"|"stacked100"|"funnel"|"heatmap"|"radar", xKey, seriesKeys?, yKey?, series?, stacked?, legend?, color?, filters?, analytics?: {trendline?, referenceLine?: {value,label?}}, format?: {value?, y2?, rules?: [{op,value,color}]}}; ' +
        "table: {dataset, sql, pageSize<=25, filters?, format?}; markdown: {content}. " +
        "othersBucket (with limit + 1 dim) keeps top-N groups and buckets the rest into 'Other'. " +
        "Measure cols may name calculated fields (list_calculated_fields). " +
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
        "Shallow-merge a patch into a tile (any page): {title?, spec?: {key: value}}. " +
        "Spec keys must fit the tile's type (see add_tile for the full " +
        "surface incl. chartType/filters/analytics/format). If the user " +
        "edited a property in the last 10 minutes you get a conflict — ask " +
        "the user, then retry with force: true.",
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
    tool({
      name: "set_tile_filters",
      description:
        "Replace ONE tile's own filters (ANDed with the global filters): " +
        "{tileId, filters: [{column, op: eq|in|between|contains, value}]}. " +
        "Empty array clears them. Not available on markdown tiles.",
      inputSchema: setTileFiltersInput,
      execute: ({ tileId, filters, force }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        const result = state().setTileFilters(tileId, filters, {
          origin: "agent",
          label:
            filters.length === 0
              ? `Cleared filters on "${tile.title}"`
              : `Filtered "${tile.title}" (${filters.map((f) => f.column).join(", ")})`,
          ...(force !== undefined ? { force } : {}),
        });
        return toToolResult(result);
      },
    }),
    tool({
      name: "set_cross_filter",
      description:
        "Cross-filter the dashboard as if the user clicked a chart element: " +
        "{column, value, sourceTileId?}. Every tile except the source (and " +
        "opted-out tiles) filters to column = value. Undoable.",
      inputSchema: setCrossFilterInput,
      execute: ({ column, value, sourceTileId }) => {
        const result = state().setCrossFilter(
          { column, value, ...(sourceTileId ? { sourceTileId } : {}) },
          {
            origin: "agent",
            label: `Cross-filtered ${column} = ${shortValue(value)}`,
          },
        );
        return toToolResult(result);
      },
    }),
    tool({
      name: "clear_cross_filter",
      description: "Remove the active cross-filter (the click-to-filter chip).",
      inputSchema: clearCrossFilterInput,
      execute: () =>
        toToolResult(
          state().clearCrossFilter({
            origin: "agent",
            label: "Cleared cross-filter",
          }),
        ),
    }),
    tool({
      name: "add_page",
      description:
        "Add a new (empty) dashboard page and switch to it. Returns {pageId}.",
      inputSchema: addPageInput,
      execute: ({ name }) =>
        toToolResult(
          state().addPage(name, {
            origin: "agent",
            label: `Added page "${name}"`,
          }),
        ),
    }),
    tool({
      name: "rename_page",
      description: "Rename a dashboard page.",
      inputSchema: renamePageInput,
      execute: ({ pageId, name, force }) => {
        const page = state().doc.pages.find((p) => p.id === pageId);
        if (!page) {
          return {
            error: `No page with id "${pageId}".`,
            hint: "Use get_dashboard_state to list pages.",
          };
        }
        const result = state().renamePage(pageId, name, {
          origin: "agent",
          label: `Renamed page "${page.name}" to "${name}"`,
          ...(force !== undefined ? { force } : {}),
        });
        return toToolResult(result);
      },
    }),
    tool({
      name: "remove_page",
      description:
        "Remove a page AND its tiles (undoable via the activity feed). " +
        "The last remaining page cannot be removed.",
      inputSchema: removePageInput,
      execute: ({ pageId }) => {
        const page = state().doc.pages.find((p) => p.id === pageId);
        if (!page) {
          return {
            error: `No page with id "${pageId}".`,
            hint: "Use get_dashboard_state to list pages.",
          };
        }
        const result = state().removePage(pageId, {
          origin: "agent",
          label: `Removed page "${page.name}"`,
        });
        return toToolResult(result, {
          undoHint: "The user can undo this from the activity feed.",
        });
      },
    }),
    tool({
      name: "switch_page",
      description:
        "Switch the visible page. Tiles listed by get_dashboard_state under " +
        "`tiles` belong to the ACTIVE page.",
      inputSchema: switchPageInput,
      execute: ({ pageId }) => {
        const page = state().doc.pages.find((p) => p.id === pageId);
        if (!page) {
          return {
            error: `No page with id "${pageId}".`,
            hint: "Use get_dashboard_state to list pages.",
          };
        }
        const result = state().switchPage(pageId, {
          origin: "agent",
          label: `Switched to page "${page.name}"`,
        });
        return toToolResult(result);
      },
    }),
    tool({
      name: "create_calculated_field",
      description:
        "Define a named SQL expression for one dataset, usable as a measure " +
        "col / dim in structured tile queries and as a KPI measure. " +
        'Example: {name: "arpu", dataset: "invoices", expression: ' +
        '"sum(amount) / count(DISTINCT customer_id)"}. Aggregate expressions ' +
        "are used verbatim; row-level ones get wrapped by the measure agg. " +
        "The expression is validated against the dataset before saving.",
      inputSchema: createCalculatedFieldInput,
      execute: async ({ name, dataset, expression, description }) => {
        // Probe the expression against the dataset so typos fail HERE.
        try {
          await runCapped(
            ds,
            `SELECT (${expression}) AS ${quoteIdent(name)} FROM ${quoteIdent(dataset)}`,
            1,
          );
        } catch (err) {
          return {
            error: `Expression failed against ${dataset}: ${message(err)}`,
            hint: "Check column names with get_dataset_schema. The expression must be a single SQL expression (no SELECT, no ';').",
          };
        }
        const result = state().addCalculatedField(
          { name, dataset, expression, ...(description ? { description } : {}) },
          { origin: "agent", label: `Defined calculated field "${name}"` },
        );
        const kind = state().doc.calculatedFields.find(
          (f) => f.name === name,
        )?.kind;
        return toToolResult(result, kind ? { name, kind } : { name });
      },
    }),
    tool({
      name: "list_calculated_fields",
      description:
        "List the calculated fields: [{name, dataset, expression, kind}]. " +
        "kind aggregate = usable as a measure directly; row = wrapped by agg.",
      inputSchema: listCalculatedFieldsInput,
      annotations: READ_ONLY,
      execute: () =>
        state().doc.calculatedFields.map((f) => ({
          name: f.name,
          dataset: f.dataset,
          expression: f.expression,
          kind: f.kind,
          ...(f.description ? { description: f.description } : {}),
        })),
    }),
    tool({
      name: "remove_calculated_field",
      description: "Remove a calculated field by name (undoable).",
      inputSchema: removeCalculatedFieldInput,
      execute: ({ name }) =>
        toToolResult(
          state().removeCalculatedField(name, {
            origin: "agent",
            label: `Removed calculated field "${name}"`,
          }),
        ),
    }),
    tool({
      name: "create_view",
      description:
        "Create a SQL view from a SELECT query; it appears as a dataset " +
        '(name auto-namespaced: "mrr" -> "view_mrr") usable in tiles and ' +
        "run_sql. Body must be a single read-only SELECT. Returns the final " +
        "{name, columns, rowCount}.",
      inputSchema: createViewInput,
      execute: async ({ name, sql, description }) => {
        if (!ds.createView || !ds.dropView) {
          return { error: "This datasource does not support views." };
        }
        const st = state();
        let viewName: string;
        try {
          viewName = normalizeViewName(name);
        } catch (err) {
          return { error: message(err) };
        }
        if (st.doc.views.some((v) => v.name === viewName)) {
          return {
            error: `A view named "${viewName}" already exists. remove_view it first.`,
          };
        }
        let meta;
        try {
          meta = await ds.createView(viewName, sql);
        } catch (err) {
          return {
            error: message(err),
            hint: "The body must be a single SELECT (DuckDB dialect) over existing datasets.",
          };
        }
        const result = st.addView(
          { name: viewName, sql, ...(description ? { description } : {}) },
          { origin: "agent", label: `Created view "${viewName}"` },
        );
        if (!result.ok) {
          await ds.dropView(viewName).catch(() => undefined);
          return toToolResult(result);
        }
        return toToolResult(result, {
          name: viewName,
          rowCount: meta.rowCount,
          columns: meta.columns.map((c) => ({ column: c.name, type: c.type })),
        });
      },
    }),
    tool({
      name: "remove_view",
      description:
        "Drop a view created with create_view (accepts the name with or " +
        "without the view_ prefix). Tiles that used it will error until " +
        "repointed.",
      inputSchema: removeViewInput,
      execute: async ({ name }) => {
        const result = state().removeView(name, {
          origin: "agent",
          label: `Removed view "${name}"`,
        });
        if (!result.ok) return toToolResult(result);
        if (ds.dropView) {
          try {
            await ds.dropView(normalizeViewName(name));
          } catch {
            /* doc registry is the source of truth; engine resyncs on load */
          }
        }
        return toToolResult(result, { removed: true });
      },
    }),
  ];

  const contextTools: ToolDefinition[] = [
    tool({
      name: "get_dashboard_state",
      description:
        "Summary of the current dashboard: title, theme, global filters, " +
        "cross-filter, pages, calculated fields, views, and every ACTIVE-page " +
        "tile's id/type/title/spec summary/layout. No data.",
      inputSchema: getDashboardStateInput,
      annotations: READ_ONLY,
      execute: () => {
        const { doc } = state();
        return {
          title: doc.title,
          theme: doc.theme,
          filters: doc.filters,
          ...(doc.crossFilter ? { crossFilter: doc.crossFilter } : {}),
          activePageId: doc.activePageId,
          pages: doc.pages.map((p) => ({
            pageId: p.id,
            name: p.name,
            tileCount: p.tiles.length,
            ...(p.id === doc.activePageId ? { active: true } : {}),
          })),
          ...(doc.calculatedFields.length > 0
            ? {
                calculatedFields: doc.calculatedFields.map((f) => ({
                  name: f.name,
                  dataset: f.dataset,
                  kind: f.kind,
                })),
              }
            : {}),
          ...(doc.views.length > 0
            ? { views: doc.views.map((v) => v.name) }
            : {}),
          tiles: doc.tiles.map((t) => ({
            tileId: t.id,
            type: t.type,
            title: t.title,
            specSummary: summarizeSpec(t),
            layout: t.layout,
            ...(t.annotations.length > 0
              ? { annotations: t.annotations.length }
              : {}),
            ...(t.ignoreCrossFilter ? { ignoreCrossFilter: true } : {}),
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
        const activePage = s.doc.pages.find((p) => p.id === s.doc.activePageId);
        return {
          ...(activePage
            ? { activePage: { pageId: activePage.id, name: activePage.name } }
            : {}),
          ...(s.doc.crossFilter ? { crossFilter: s.doc.crossFilter } : {}),
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
          data: await tileDataSummary(ds, tile, state().doc),
        };
      },
    }),
    tool({
      name: "export_tile_data",
      description:
        "The tile's CURRENT data (all active filters applied) as CSV text: " +
        "{csv, rowCount, truncated}. Default cap 500 rows (max 1000).",
      inputSchema: exportTileDataInput,
      annotations: READ_ONLY,
      execute: async ({ tileId, limit }) => {
        const tile = findTile(tileId);
        if (!tile) {
          return {
            error: `No tile with id "${tileId}".`,
            hint: "Use get_dashboard_state to list tiles.",
          };
        }
        if (tile.type === "markdown") {
          return { error: "Markdown tiles have no data to export." };
        }
        const res = await runTileQuery(ds, tile, state().doc, limit);
        if (!res || "error" in res) {
          return res ?? { error: "Tile has no query." };
        }
        return {
          csv: toCSV(res.columns, res.rows),
          rowCount: res.rowCount,
          truncated: res.truncated,
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
          data: await tileDataSummary(ds, tile, doc),
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
  "set_tile_filters",
  "set_cross_filter",
  "clear_cross_filter",
  "add_page",
  "rename_page",
  "remove_page",
  "switch_page",
  "create_calculated_field",
  "list_calculated_fields",
  "remove_calculated_field",
  "create_view",
  "remove_view",
  "get_dashboard_state",
  "get_user_focus",
  "describe_tile",
  "export_tile_data",
  "get_activity_log",
] as const;

export const DYNAMIC_TOOL_NAMES = [
  "edit_selected_tile",
  "restyle_selected_tile",
  "explain_selected_tile",
] as const;
