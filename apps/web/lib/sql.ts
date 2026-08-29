/**
 * Best-effort SQL construction for tiles: structured queries get first-class
 * global filter / date-range support; raw-SQL tiles get a wrapped filter
 * attempt with graceful fallback (see useTileData).
 */

import type { ColumnMeta, DatasetMeta } from "@kontier-ri/datasource";
import { measureAlias, plottableAggExpr } from "@kontier-ri/studio";
import type {
  ChartSpec,
  DateRange,
  GlobalFilter,
  KpiSpec,
  TableSpec,
} from "@/lib/dashboard-store";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdent(name: string): string {
  if (IDENT_RE.test(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

export function sqlLiteral(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
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
export function pickDateColumn(columns: ColumnMeta[]): ColumnMeta | null {
  for (const name of DATE_NAME_PRIORITY) {
    const col = columns.find((c) => c.name === name);
    if (col) return col;
  }
  return columns.find((c) => isDateType(c.type)) ?? null;
}

function dateRangeClause(col: ColumnMeta, range: DateRange): string {
  const ident = quoteIdent(col.name);
  if (!isDateType(col.type)) {
    // String month column ('YYYY-MM'): compare on the month prefix.
    const from = sqlLiteral(range.from.slice(0, 7));
    const to = sqlLiteral(range.to.slice(0, 7));
    return `substr(CAST(${ident} AS VARCHAR), 1, 7) BETWEEN ${from} AND ${to}`;
  }
  return `CAST(${ident} AS DATE) BETWEEN ${sqlLiteral(range.from)} AND ${sqlLiteral(range.to)}`;
}

function filterClause(filter: GlobalFilter): string {
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

/** WHERE clauses that apply to a dataset given its schema. */
export function buildWhereClauses(
  columns: ColumnMeta[],
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

/** Wrap a raw SELECT so global filters can be applied to its output columns. */
export function wrapWithClauses(sql: string, clauses: string[]): string {
  if (clauses.length === 0) return sql;
  const inner = sql.trim().replace(/;\s*$/, "");
  return `SELECT * FROM (${inner}) __tile${whereSQL(clauses)}`;
}

function findDataset(
  datasets: DatasetMeta[],
  name: string,
): DatasetMeta | undefined {
  return datasets.find((d) => d.name === name);
}

// ---------------------------------------------------------------------------
// Per-tile-type SQL
// ---------------------------------------------------------------------------

export interface BuiltQuery {
  sql: string;
  /** Fallback to run when `sql` fails (filters referenced missing columns). */
  fallbackSQL?: string;
}

export function buildChartQuery(
  spec: ChartSpec,
  datasets: DatasetMeta[],
  filters: GlobalFilter[],
  dateRange: DateRange | null,
): BuiltQuery {
  const meta = findDataset(datasets, spec.dataset);
  if ("sql" in spec.query) {
    const clauses = buildWhereClauses(
      meta?.columns ?? [],
      filters,
      // Raw SQL usually aggregates dates away; only push simple filters in.
      null,
    );
    return {
      sql: wrapWithClauses(spec.query.sql, clauses),
      fallbackSQL: spec.query.sql,
    };
  }
  const q = spec.query;
  const selectParts = [
    ...q.dims.map(quoteIdent),
    // plottableAggExpr CASTs widening aggregates (sum/avg/count) to DOUBLE so
    // HUGEINT/DECIMAL results survive as plain JS numbers for charting.
    // Alias matches @kontier-ri/studio measureAlias -> stable seriesKeys.
    ...q.measures.map(
      (m) => `${plottableAggExpr(m.agg, m.col)} AS ${quoteIdent(measureAlias(m))}`,
    ),
  ];
  const clauses = meta
    ? buildWhereClauses(meta.columns, filters, dateRange)
    : [];
  const groupBy =
    q.dims.length > 0
      ? ` GROUP BY ${q.dims.map((_, i) => i + 1).join(", ")}`
      : "";
  const orderBy = q.orderBy
    ? ` ORDER BY ${q.orderBy}`
    : q.dims.length > 0
      ? " ORDER BY 1"
      : "";
  const limit = ` LIMIT ${Math.min(q.limit ?? 500, 2000)}`;
  const sql = `SELECT ${selectParts.join(", ")} FROM ${quoteIdent(spec.dataset)}${whereSQL(clauses)}${groupBy}${orderBy}${limit}`;
  return { sql };
}

export function buildKpiQuery(
  spec: KpiSpec,
  datasets: DatasetMeta[],
  filters: GlobalFilter[],
  dateRange: DateRange | null,
): BuiltQuery {
  const meta = findDataset(datasets, spec.dataset);
  if (spec.sql) {
    const clauses = buildWhereClauses(meta?.columns ?? [], filters, null);
    return {
      sql: wrapWithClauses(spec.sql, clauses),
      fallbackSQL: spec.sql,
    };
  }
  const agg = spec.agg ?? "sum";
  const clauses = meta
    ? buildWhereClauses(meta.columns, filters, dateRange)
    : [];
  const base = quoteIdent(spec.dataset);
  if (spec.compare === "prev_period" && meta) {
    const dateCol = pickDateColumn(meta.columns);
    if (dateCol) {
      // Compare the latest month vs the month before (within active filters).
      const monthExpr = isDateType(dateCol.type)
        ? `strftime(CAST(${quoteIdent(dateCol.name)} AS DATE), '%Y-%m')`
        : `substr(CAST(${quoteIdent(dateCol.name)} AS VARCHAR), 1, 7)`;
      const where = whereSQL(clauses);
      const valueExpr = plottableAggExpr(agg, spec.measure ?? "*");
      const sql = `WITH per_month AS (SELECT ${monthExpr} AS __m, ${valueExpr} AS __v FROM ${base}${where} GROUP BY 1), ranked AS (SELECT __m, __v, row_number() OVER (ORDER BY __m DESC) AS __rn FROM per_month) SELECT max(CASE WHEN __rn = 1 THEN __v END) AS value, max(CASE WHEN __rn = 2 THEN __v END) AS prev FROM ranked`;
      return { sql };
    }
  }
  const valueExpr = plottableAggExpr(agg, spec.measure ?? "*");
  return {
    sql: `SELECT ${valueExpr} AS value FROM ${base}${whereSQL(clauses)}`,
  };
}

export function buildTableQuery(
  spec: TableSpec,
  datasets: DatasetMeta[],
  filters: GlobalFilter[],
): BuiltQuery {
  const meta = findDataset(datasets, spec.dataset);
  const clauses = buildWhereClauses(meta?.columns ?? [], filters, null);
  return {
    sql: wrapWithClauses(spec.sql, clauses),
    fallbackSQL: spec.sql,
  };
}
