import { quoteIdent } from "@kontier-ri/datasource";
import type {
  Agg,
  ChartMeasure,
  ChartSpec,
  KpiSpec,
  TableSpec,
  Tile,
} from "./types";

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

/** Stable result-column alias for a chart measure (use as seriesKey). */
export function measureAlias(m: ChartMeasure): string {
  return m.agg === "count" && m.col === "*" ? "count" : `${m.agg}_${m.col}`;
}

export function buildChartSQL(spec: ChartSpec): string {
  if ("sql" in spec.query) return spec.query.sql;
  const q = spec.query;
  const dims = q.dims.map((d) => quoteIdent(d)).join(", ");
  const measures = q.measures
    .map((m) => `${plottableAggExpr(m.agg, m.col)} AS ${quoteIdent(measureAlias(m))}`)
    .join(", ");
  const orderBy = q.orderBy ?? quoteIdent(q.dims[0]!);
  const limit = q.limit ?? 1000;
  return (
    `SELECT ${dims}, ${measures} FROM ${quoteIdent(spec.dataset)} ` +
    `GROUP BY ${dims} ORDER BY ${orderBy} LIMIT ${limit}`
  );
}

/**
 * The read-only query a tile renders from, or null when it has none
 * (markdown tiles, incomplete KPI specs).
 */
export function buildTileQuerySQL(tile: Tile): string | null {
  switch (tile.type) {
    case "markdown":
      return null;
    case "table":
      return (tile.spec as TableSpec).sql;
    case "chart":
      return buildChartSQL(tile.spec as ChartSpec);
    case "kpi": {
      const s = tile.spec as KpiSpec;
      if (s.sql) return s.sql;
      if (s.measure && s.agg) {
        return `SELECT ${plottableAggExpr(s.agg, s.measure)} AS value FROM ${quoteIdent(s.dataset)}`;
      }
      return null;
    }
  }
}

/** One-line human/agent readable summary of a tile spec (no data). */
export function summarizeSpec(tile: Tile): string {
  switch (tile.type) {
    case "markdown": {
      const len = (tile.spec as { content: string }).content.length;
      return `markdown (${len} chars)`;
    }
    case "table": {
      const s = tile.spec as TableSpec;
      const sql = s.sql.length > 80 ? `${s.sql.slice(0, 79)}…` : s.sql;
      return `table dataset=${s.dataset} sql=${JSON.stringify(sql)}`;
    }
    case "kpi": {
      const s = tile.spec as KpiSpec;
      const src = s.sql
        ? "sql"
        : s.measure && s.agg
          ? `${s.agg}(${s.measure})`
          : "incomplete";
      return `kpi ${src} format=${s.format} dataset=${s.dataset}${s.compare ? " vs prev_period" : ""}`;
    }
    case "chart": {
      const s = tile.spec as ChartSpec;
      const q =
        "sql" in s.query
          ? "sql"
          : `dims=[${s.query.dims.join(",")}] measures=[${s.query.measures
              .map((m) => `${m.agg}(${m.col})`)
              .join(",")}]`;
      return `${s.chartType} chart dataset=${s.dataset} ${q} x=${s.xKey}${s.stacked ? " stacked" : ""}`;
    }
  }
}
