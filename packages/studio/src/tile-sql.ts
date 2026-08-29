import { quoteIdent } from "@kontier-ri/datasource";
import type {
  Agg,
  CalculatedField,
  ChartMeasure,
  ChartQueryDims,
  ChartSpec,
  CrossFilter,
  DateRange,
  GlobalFilter,
  KpiSpec,
  TableSpec,
  Tile,
  TileFilter,
} from "./types";

// ---------------------------------------------------------------------------
// Aggregate / alias helpers
// ---------------------------------------------------------------------------

/** SQL aggregate expression for a measure. */
export function aggExpr(agg: Agg, col: string): string {
  if (agg === "count") return col === "*" ? "count(*)" : `count(${quoteIdent(col)})`;
  if (agg === "count_distinct") return `count(DISTINCT ${quoteIdent(col)})`;
  return `${agg}(${quoteIdent(col)})`;
}

/**
 * Aggregates whose DuckDB result type widens beyond a plain JS number:
 * sum/avg on BIGINT/DECIMAL yield HUGEINT/DECIMAL128 and count yields BIGINT,
 * which Arrow surfaces as BigInt/struct objects that charts cannot plot.
 */
const WIDENING_AGGS: readonly Agg[] = ["sum", "avg", "count", "count_distinct"];

/** aggExpr, CAST to DOUBLE when the aggregate widens (safe to plot/format). */
export function plottableAggExpr(agg: Agg, col: string): string {
  const expr = aggExpr(agg, col);
  return WIDENING_AGGS.includes(agg) ? `CAST(${expr} AS DOUBLE)` : expr;
}

/** plottableAggExpr over a raw SQL expression (calculated fields). */
function plottableAggOverExpr(agg: Agg, inner: string): string {
  const base =
    agg === "count"
      ? `count(${inner})`
      : agg === "count_distinct"
        ? `count(DISTINCT ${inner})`
        : `${agg}(${inner})`;
  return WIDENING_AGGS.includes(agg) ? `CAST(${base} AS DOUBLE)` : base;
}

/** Stable result-column alias for a chart measure (use as seriesKey). */
export function measureAlias(m: ChartMeasure): string {
  return m.agg === "count" && m.col === "*" ? "count" : `${m.agg}_${m.col}`;
}

// ---------------------------------------------------------------------------
// Literals / filter clauses (single SQL authority — PLAN-V2)
// ---------------------------------------------------------------------------

export function sqlLiteral(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Minimal column info the SQL builder needs for schema-aware pushdown. */
export interface ColumnInfo {
  name: string;
  type: string;
}

/** Minimal dataset info (subset of @kontier-ri/datasource DatasetMeta). */
export interface DatasetInfo {
  name: string;
  columns: ColumnInfo[];
}

const DATE_NAME_PRIORITY = [
  "month",
  "date",
  "invoice_date",
  "created_at",
  "signup_date",
  "start_date",
  "canceled_at",
];

function isDateType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("date") || t.includes("timestamp");
}

/** Pick the column the global date range applies to for a dataset. */
export function pickDateColumn(columns: ColumnInfo[]): ColumnInfo | null {
  for (const name of DATE_NAME_PRIORITY) {
    const col = columns.find((c) => c.name === name);
    if (col) return col;
  }
  return columns.find((c) => isDateType(c.type)) ?? null;
}

function dateRangeClause(col: ColumnInfo, range: DateRange): string {
  const ident = quoteIdent(col.name);
  if (!isDateType(col.type)) {
    // String month column ('YYYY-MM'): compare on the month prefix.
    const from = sqlLiteral(range.from.slice(0, 7));
    const to = sqlLiteral(range.to.slice(0, 7));
    return `substr(CAST(${ident} AS VARCHAR), 1, 7) BETWEEN ${from} AND ${to}`;
  }
  return `CAST(${ident} AS DATE) BETWEEN ${sqlLiteral(range.from)} AND ${sqlLiteral(range.to)}`;
}

/** One WHERE clause for a global/tile/cross filter. */
export function filterClause(filter: GlobalFilter | TileFilter): string {
  const ident = quoteIdent(filter.column);
  switch (filter.op) {
    case "eq":
      return `${ident} = ${sqlLiteral(filter.value)}`;
    case "in": {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      return `${ident} IN (${values.map(sqlLiteral).join(", ")})`;
    }
    case "between": {
      const [lo, hi] = Array.isArray(filter.value)
        ? filter.value
        : [filter.value, filter.value];
      return `${ident} BETWEEN ${sqlLiteral(lo)} AND ${sqlLiteral(hi)}`;
    }
    case "contains":
      return `CAST(${ident} AS VARCHAR) ILIKE ${sqlLiteral(`%${String(filter.value)}%`)}`;
  }
}

/** WHERE clauses for the global filters + date range that fit a schema. */
export function buildWhereClauses(
  columns: ColumnInfo[],
  filters: GlobalFilter[],
  dateRange: DateRange | null,
): string[] {
  const names = new Set(columns.map((c) => c.name));
  const clauses = filters
    .filter((f) => names.has(f.column))
    .map(filterClause);
  if (dateRange) {
    const dateCol = pickDateColumn(columns);
    if (dateCol) clauses.push(dateRangeClause(dateCol, dateRange));
  }
  return clauses;
}

function whereSQL(clauses: string[]): string {
  return clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
}

/** Wrap a raw SELECT so filters can be applied to its output columns. */
export function wrapWithClauses(sql: string, clauses: string[]): string {
  if (clauses.length === 0) return sql;
  const inner = sql.trim().replace(/;\s*$/, "");
  return `SELECT * FROM (${inner}) __tile${whereSQL(clauses)}`;
}

// ---------------------------------------------------------------------------
// Query context (global filters / cross-filter / calculated fields)
// ---------------------------------------------------------------------------

/**
 * Everything the SQL builder may take into account beyond the tile spec.
 * All fields optional: `buildTileQuerySQL(tile)` behaves exactly like v1.
 */
export interface TileQueryContext {
  /** Dataset schemas: enables schema-aware global-filter/date pushdown. */
  datasets?: DatasetInfo[];
  globalFilters?: GlobalFilter[];
  dateRange?: DateRange | null;
  /**
   * Applied to every tile except the source tile and tiles with
   * ignoreCrossFilter (checked here via the `tile` argument).
   */
  crossFilter?: CrossFilter | null;
  /** Overrides tile.spec.filters when provided. */
  tileFilters?: TileFilter[];
  calculatedFields?: CalculatedField[];
}

export interface BuiltTileQuery {
  sql: string;
  /**
   * Unfiltered/less-filtered query to retry when `sql` fails (pushed-down
   * filters referenced columns the tile's SQL does not expose).
   */
  fallbackSQL?: string;
}

interface ResolvedContext {
  columns: ColumnInfo[] | null;
  /** Clauses verified against the dataset schema (safe for structured SQL). */
  verified: string[];
  /** Best-effort clauses (tile filters + cross filter without schema info). */
  bestEffort: string[];
  fields: CalculatedField[];
}

function crossFilterApplies(
  tile: Pick<Tile, "id" | "ignoreCrossFilter">,
  cf: CrossFilter | null | undefined,
): cf is CrossFilter {
  if (!cf) return false;
  if (tile.ignoreCrossFilter) return false;
  return cf.sourceTileId !== tile.id;
}

function resolveContext(
  tile: Tile,
  dataset: string,
  ctx: TileQueryContext,
  opts: { dateRange: boolean },
): ResolvedContext {
  const columns =
    ctx.datasets?.find((d) => d.name === dataset)?.columns ?? null;
  const names = columns ? new Set(columns.map((c) => c.name)) : null;
  const knows = (column: string) => names === null || names.has(column);

  const verified: string[] = [];
  const bestEffort: string[] = [];

  // Global filters + date range: schema-aware only (v1 behavior preserved).
  if (columns) {
    verified.push(
      ...buildWhereClauses(
        columns,
        ctx.globalFilters ?? [],
        opts.dateRange ? (ctx.dateRange ?? null) : null,
      ),
    );
  }

  // Tile-level filters: explicit intent for THIS tile — always applied
  // (best-effort when we cannot verify the column exists).
  // NOTE: not schema-checked — raw-SQL tiles filter on their OUTPUT columns,
  // which the base-table schema cannot verify. fallbackSQL covers failures.
  const tileFilters =
    ctx.tileFilters ?? (tile.spec as { filters?: TileFilter[] }).filters ?? [];
  for (const f of tileFilters) {
    bestEffort.push(filterClause(f));
  }

  // Cross filter: skip for the source tile / opted-out tiles; skip when the
  // schema proves the column does not exist on this dataset.
  const cf = ctx.crossFilter;
  if (crossFilterApplies(tile, cf) && knows(cf.column)) {
    bestEffort.push(filterClause({ column: cf.column, op: "eq", value: cf.value }));
  }

  const fields = (ctx.calculatedFields ?? []).filter(
    (f) => f.dataset === dataset,
  );
  return { columns, verified, bestEffort, fields };
}

// ---------------------------------------------------------------------------
// Calculated-field expansion
// ---------------------------------------------------------------------------

function findField(
  fields: CalculatedField[],
  name: string,
): CalculatedField | undefined {
  return fields.find((f) => f.name === name);
}

/** SELECT expression for a dim (calculated row fields expand in place). */
function dimExpr(dim: string, fields: CalculatedField[]): string {
  const field = findField(fields, dim);
  return field ? `(${field.expression})` : quoteIdent(dim);
}

/**
 * SELECT expression + alias for a measure. Row-level calculated fields are
 * wrapped by the measure agg; aggregate-level fields are used verbatim
 * (their expression IS the aggregate) and aliased by their name.
 */
export function measureExpr(
  m: ChartMeasure,
  fields: CalculatedField[],
): { expr: string; alias: string } {
  const field = findField(fields, m.col);
  if (!field) {
    return { expr: plottableAggExpr(m.agg, m.col), alias: measureAlias(m) };
  }
  if (field.kind === "aggregate") {
    return {
      expr: `CAST((${field.expression}) AS DOUBLE)`,
      alias: field.name,
    };
  }
  return {
    expr: plottableAggOverExpr(m.agg, `(${field.expression})`),
    alias: measureAlias(m),
  };
}

// ---------------------------------------------------------------------------
// Chart SQL
// ---------------------------------------------------------------------------

function buildDimsChartSQL(
  spec: ChartSpec,
  q: ChartQueryDims,
  clauses: string[],
  fields: CalculatedField[],
): string {
  const dimExprs = q.dims.map((d) => dimExpr(d, fields));
  const dimSelect = q.dims
    .map((d, i) =>
      dimExprs[i] === quoteIdent(d)
        ? quoteIdent(d)
        : `${dimExprs[i]} AS ${quoteIdent(d)}`,
    )
    .join(", ");
  const measureParts = q.measures.map((m) => measureExpr(m, fields));
  const measures = measureParts
    .map((m) => `${m.expr} AS ${quoteIdent(m.alias)}`)
    .join(", ");
  const where = whereSQL(clauses);

  if (q.othersBucket && q.limit !== undefined && q.dims.length === 1) {
    return buildOthersBucketSQL(spec, q, clauses, fields);
  }

  const groupBy = dimExprs.join(", ");
  const orderBy = q.orderBy ?? quoteIdent(q.dims[0]!);
  const limit = q.limit ?? 1000;
  return (
    `SELECT ${dimSelect}, ${measures} FROM ${quoteIdent(spec.dataset)}${where} ` +
    `GROUP BY ${groupBy} ORDER BY ${orderBy} LIMIT ${limit}`
  );
}

/**
 * Top-N + "Other": rank groups by the FIRST measure (desc), keep the top
 * `limit`, collapse the rest into an 'Other' row. All aggregates are
 * computed over the base rows (no re-aggregation), so avg/median/count
 * distinct stay correct inside the bucket.
 */
function buildOthersBucketSQL(
  spec: ChartSpec,
  q: ChartQueryDims,
  clauses: string[],
  fields: CalculatedField[],
): string {
  const dim = q.dims[0]!;
  const dExpr = dimExpr(dim, fields);
  const dAlias = quoteIdent(dim);
  const first = measureExpr(q.measures[0]!, fields);
  const measures = q.measures
    .map((m) => measureExpr(m, fields))
    .map((m) => `${m.expr} AS ${quoteIdent(m.alias)}`)
    .join(", ");
  const where = whereSQL(clauses);
  const n = q.limit!;
  return (
    `WITH __ranks AS (` +
    `SELECT ${dExpr} AS __k, row_number() OVER (ORDER BY ${first.expr} DESC) AS __rn ` +
    `FROM ${quoteIdent(spec.dataset)}${where} GROUP BY 1` +
    `) ` +
    `SELECT CASE WHEN __ranks.__rn <= ${n} THEN CAST(${dExpr} AS VARCHAR) ELSE 'Other' END AS ${dAlias}, ` +
    `${measures} ` +
    `FROM ${quoteIdent(spec.dataset)}${where} ` +
    `JOIN __ranks ON ${dExpr} IS NOT DISTINCT FROM __ranks.__k ` +
    `GROUP BY 1 ORDER BY min(__ranks.__rn)`
  );
}

/**
 * Chart SQL with optional context (filters, cross-filter, calculated
 * fields). Without ctx this is byte-for-byte the v1 output.
 */
export function buildChartSQL(spec: ChartSpec, ctx?: TileQueryContext): string {
  return buildChartQuery(specTile(spec), ctx ?? {}).sql;
}

/** Wrap a bare chart spec in a tile shell (internal). */
function specTile(spec: ChartSpec): Tile {
  return {
    id: "__spec__",
    type: "chart",
    title: "",
    layout: { x: 0, y: 0, w: 1, h: 1 },
    spec,
    annotations: [],
  };
}

function buildChartQuery(tile: Tile, ctx: TileQueryContext): BuiltTileQuery {
  const spec = tile.spec as ChartSpec;
  if ("sql" in spec.query) {
    const r = resolveContext(tile, spec.dataset, ctx, { dateRange: false });
    const clauses = [...r.verified, ...r.bestEffort];
    const sql = wrapWithClauses(spec.query.sql, clauses);
    return clauses.length > 0
      ? { sql, fallbackSQL: spec.query.sql }
      : { sql };
  }
  const q = spec.query;
  const r = resolveContext(tile, spec.dataset, ctx, { dateRange: true });
  const all = [...r.verified, ...r.bestEffort];
  const sql = buildDimsChartSQL(spec, q, all, r.fields);
  if (r.bestEffort.length === 0) return { sql };
  return {
    sql,
    fallbackSQL: buildDimsChartSQL(spec, q, r.verified, r.fields),
  };
}

// ---------------------------------------------------------------------------
// KPI SQL
// ---------------------------------------------------------------------------

function kpiValueExpr(spec: KpiSpec, fields: CalculatedField[]): string {
  const measure = spec.measure ?? "*";
  const agg = spec.agg ?? "sum";
  return measureExpr({ col: measure, agg }, fields).expr;
}

function buildKpiQuery(tile: Tile, ctx: TileQueryContext): BuiltTileQuery {
  const spec = tile.spec as KpiSpec;
  if (spec.sql) {
    const r = resolveContext(tile, spec.dataset, ctx, { dateRange: false });
    const clauses = [...r.verified, ...r.bestEffort];
    const sql = wrapWithClauses(spec.sql, clauses);
    return clauses.length > 0 ? { sql, fallbackSQL: spec.sql } : { sql };
  }
  const r = resolveContext(tile, spec.dataset, ctx, { dateRange: true });
  const clauses = [...r.verified, ...r.bestEffort];
  const base = quoteIdent(spec.dataset);
  const valueExpr = kpiValueExpr(spec, r.fields);

  if (spec.compare === "prev_period" && r.columns) {
    const dateCol = pickDateColumn(r.columns);
    if (dateCol) {
      // Latest month vs the month before (within active filters).
      const monthExpr = isDateType(dateCol.type)
        ? `strftime(CAST(${quoteIdent(dateCol.name)} AS DATE), '%Y-%m')`
        : `substr(CAST(${quoteIdent(dateCol.name)} AS VARCHAR), 1, 7)`;
      const sql =
        `WITH per_month AS (SELECT ${monthExpr} AS __m, ${valueExpr} AS __v ` +
        `FROM ${base}${whereSQL(clauses)} GROUP BY 1), ` +
        `ranked AS (SELECT __m, __v, row_number() OVER (ORDER BY __m DESC) AS __rn FROM per_month) ` +
        `SELECT max(CASE WHEN __rn = 1 THEN __v END) AS value, ` +
        `max(CASE WHEN __rn = 2 THEN __v END) AS prev FROM ranked`;
      return { sql };
    }
  }
  const sql = `SELECT ${valueExpr} AS value FROM ${base}${whereSQL(clauses)}`;
  if (r.bestEffort.length === 0) return { sql };
  return {
    sql,
    fallbackSQL: `SELECT ${valueExpr} AS value FROM ${base}${whereSQL(r.verified)}`,
  };
}

function findFieldForKpi(
  spec: KpiSpec,
  ctx: TileQueryContext,
): CalculatedField | undefined {
  if (!spec.measure) return undefined;
  return (ctx.calculatedFields ?? []).find(
    (f) => f.name === spec.measure && f.dataset === spec.dataset,
  );
}

// ---------------------------------------------------------------------------
// Table SQL + tile entry points
// ---------------------------------------------------------------------------

function buildTableQuery(tile: Tile, ctx: TileQueryContext): BuiltTileQuery {
  const spec = tile.spec as TableSpec;
  const r = resolveContext(tile, spec.dataset, ctx, { dateRange: false });
  const clauses = [...r.verified, ...r.bestEffort];
  const sql = wrapWithClauses(spec.sql, clauses);
  return clauses.length > 0 ? { sql, fallbackSQL: spec.sql } : { sql };
}

/**
 * THE single SQL authority (PLAN-V2): the query a tile renders from, with
 * global filters, date range, tile filters, cross-filter and calculated
 * fields applied. Returns null for markdown tiles / incomplete KPI specs.
 * `fallbackSQL` (when present) should be retried if `sql` fails.
 */
export function buildTileQuery(
  tile: Tile,
  ctx: TileQueryContext = {},
): BuiltTileQuery | null {
  switch (tile.type) {
    case "markdown":
      return null;
    case "table":
      return buildTableQuery(tile, ctx);
    case "chart":
      return buildChartQuery(tile, ctx);
    case "kpi": {
      const s = tile.spec as KpiSpec;
      // Complete = sql, or measure+agg, or measure naming a calculated field.
      if (!s.sql && !(s.measure && s.agg) && !findFieldForKpi(s, ctx)) {
        return null;
      }
      return buildKpiQuery(tile, ctx);
    }
  }
}

/**
 * The read-only query a tile renders from, or null when it has none
 * (markdown tiles, incomplete KPI specs). ctx-less calls are unchanged v1.
 */
export function buildTileQuerySQL(
  tile: Tile,
  ctx: TileQueryContext = {},
): string | null {
  return buildTileQuery(tile, ctx)?.sql ?? null;
}

// ---------------------------------------------------------------------------
// Spec summaries (agent-facing one-liners)
// ---------------------------------------------------------------------------

/** One-line human/agent readable summary of a tile spec (no data). */
export function summarizeSpec(tile: Tile): string {
  const extras = (spec: { filters?: TileFilter[] }): string =>
    spec.filters?.length ? ` filters=${spec.filters.length}` : "";
  switch (tile.type) {
    case "markdown": {
      const len = (tile.spec as { content: string }).content.length;
      return `markdown (${len} chars)`;
    }
    case "table": {
      const s = tile.spec as TableSpec;
      const sql = s.sql.length > 80 ? `${s.sql.slice(0, 79)}…` : s.sql;
      return `table dataset=${s.dataset} sql=${JSON.stringify(sql)}${extras(s)}`;
    }
    case "kpi": {
      const s = tile.spec as KpiSpec;
      const src = s.sql
        ? "sql"
        : s.measure
          ? `${s.agg ? `${s.agg}(${s.measure})` : s.measure}`
          : "incomplete";
      const fmt = typeof s.format === "string" ? s.format : s.format.style;
      return `kpi ${src} format=${fmt} dataset=${s.dataset}${s.compare ? " vs prev_period" : ""}${extras(s)}`;
    }
    case "chart": {
      const s = tile.spec as ChartSpec;
      const q =
        "sql" in s.query
          ? "sql"
          : `dims=[${s.query.dims.join(",")}] measures=[${s.query.measures
              .map((m) => `${m.agg}(${m.col})`)
              .join(",")}]${s.query.othersBucket ? ` top${s.query.limit}+other` : ""}`;
      return `${s.chartType} chart dataset=${s.dataset} ${q} x=${s.xKey}${s.stacked ? " stacked" : ""}${extras(s)}`;
    }
  }
}
