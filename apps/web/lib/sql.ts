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

// ---------------------------------------------------------------------------
// Client-side sorting (table header sort) — wrap the built query
// ---------------------------------------------------------------------------

export interface SortSpec {
  column: string;
  dir: "asc" | "desc";
}

/** Wrap a built query so its OUTPUT columns can be re-ordered. */
export function wrapOrderBy(sql: string, sort: SortSpec): string {
  const inner = sql.trim().replace(/;\s*$/, "");
  const dir = sort.dir === "desc" ? "DESC" : "ASC";
  return `SELECT * FROM (${inner}) __sorted ORDER BY ${quoteIdent(sort.column)} ${dir} NULLS LAST`;
}

// ---------------------------------------------------------------------------
// Temporal granularity (tile-header month/quarter/week select)
// ---------------------------------------------------------------------------

export type TimeGrain = "month" | "quarter" | "week";

/**
 * The rewrite family: every grain is expressed over the SAME inner date
 * expression, so switching grains is a lossless in-place substitution.
 * DuckDB strftime has no quarter code, hence the concat form.
 */
export function timeGrainExpr(inner: string, grain: TimeGrain): string {
  if (grain === "quarter") {
    return `concat(strftime(${inner}, '%Y'), '-Q', quarter(${inner}))`;
  }
  const fmt = grain === "week" ? "'%Y-W%W'" : "'%Y-%m'";
  return `strftime(${inner}, ${fmt})`;
}

interface SqlCall {
  start: number;
  end: number;
  args: string[];
}

/** Top-level comma split, respecting '...' strings and nested parens. */
function splitTopLevel(argsStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const ch of argsStr) {
    if (inStr) {
      cur += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  const last = cur.trim();
  if (last) parts.push(last);
  return parts;
}

/** All balanced `name(...)` calls in `sql` with their parsed arguments. */
function findCalls(sql: string, name: string): SqlCall[] {
  const out: SqlCall[] = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 0;
    let inStr = false;
    let end = -1;
    for (let i = openIdx; i < sql.length; i++) {
      const ch = sql[i]!;
      if (inStr) {
        if (ch === "'") inStr = false;
        continue;
      }
      if (ch === "'") {
        inStr = true;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    out.push({
      start: m.index,
      end: end + 1,
      args: splitTopLevel(sql.slice(openIdx + 1, end)),
    });
  }
  return out;
}

interface GrainMatch {
  start: number;
  end: number;
  inner: string;
  grain: TimeGrain;
}

/** Whole-arg call check: `expr` is exactly `name(...)`. */
function soleCall(expr: string, name: string): SqlCall | null {
  const calls = findCalls(expr, name);
  const c = calls[0];
  return c && c.start === 0 && c.end === expr.length ? c : null;
}

function grainMatches(sql: string): GrainMatch[] {
  const matches: GrainMatch[] = [];
  // Quarter form first (its inner strftime must not double-match below).
  for (const c of findCalls(sql, "concat")) {
    if (c.args.length !== 3 || c.args[1] !== "'-Q'") continue;
    const s = soleCall(c.args[0]!, "strftime");
    const q = soleCall(c.args[2]!, "quarter");
    if (
      s &&
      q &&
      s.args.length === 2 &&
      s.args[1] === "'%Y'" &&
      q.args.length === 1 &&
      q.args[0] === s.args[0]
    ) {
      matches.push({ start: c.start, end: c.end, inner: s.args[0]!, grain: "quarter" });
    }
  }
  for (const c of findCalls(sql, "strftime")) {
    if (matches.some((g) => c.start >= g.start && c.end <= g.end)) continue;
    if (c.args.length !== 2) continue;
    const grain =
      c.args[1] === "'%Y-%m'"
        ? ("month" as const)
        : c.args[1] === "'%Y-W%W'"
          ? ("week" as const)
          : null;
    if (grain) {
      matches.push({ start: c.start, end: c.end, inner: c.args[0]!, grain });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Detect the temporal granularity of a raw chart SQL: present when the SQL
 * bins on one of the rewrite-family expressions (month strftime pattern,
 * or a week/quarter form this module previously wrote).
 */
export function detectTimeGrain(sql: string): TimeGrain | null {
  const g = grainMatches(sql);
  return g.length > 0 ? g[0]!.grain : null;
}

/** Rewrite every grain expression in `sql` to `grain` (lossless family swap). */
export function rewriteTimeGrain(sql: string, grain: TimeGrain): string {
  let out = sql;
  for (const g of grainMatches(sql).reverse()) {
    out = out.slice(0, g.start) + timeGrainExpr(g.inner, grain) + out.slice(g.end);
  }
  return out;
}
