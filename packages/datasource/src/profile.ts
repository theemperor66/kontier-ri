import { quoteIdent } from "./guard";
import type { ColumnProfile } from "./types";

export const TOP_VALUES_LIMIT = 10;

/** SQL for count / nulls / distinct / min / max of one column. */
export function buildStatsSQL(dataset: string, column: string): string {
  const d = quoteIdent(dataset);
  const c = quoteIdent(column);
  return [
    "SELECT",
    "  count(*)::DOUBLE AS total,",
    `  count(${c})::DOUBLE AS non_null,`,
    `  count(DISTINCT ${c})::DOUBLE AS distinct_count,`,
    `  min(${c}) AS min_value,`,
    `  max(${c}) AS max_value`,
    `FROM ${d}`,
  ].join("\n");
}

/** SQL for the most frequent values of one column. */
export function buildTopValuesSQL(dataset: string, column: string): string {
  const d = quoteIdent(dataset);
  const c = quoteIdent(column);
  return [
    `SELECT ${c} AS value, count(*)::DOUBLE AS n`,
    `FROM ${d}`,
    `WHERE ${c} IS NOT NULL`,
    "GROUP BY 1",
    "ORDER BY n DESC, 1",
    `LIMIT ${TOP_VALUES_LIMIT}`,
  ].join("\n");
}

export interface RawRows {
  rows: Record<string, unknown>[];
}

/** Shape raw stat/top-value rows into a ColumnProfile. */
export function shapeProfile(
  dataset: string,
  column: string,
  type: string,
  stats: Record<string, unknown>,
  topRows: Record<string, unknown>[],
): ColumnProfile {
  const total = Number(stats["total"] ?? 0);
  const nonNull = Number(stats["non_null"] ?? 0);
  return {
    dataset,
    column,
    type,
    count: total,
    nulls: total - nonNull,
    distinct: Number(stats["distinct_count"] ?? 0),
    min: stats["min_value"] ?? null,
    max: stats["max_value"] ?? null,
    topValues: topRows.map((r) => ({
      value: r["value"] ?? null,
      count: Number(r["n"] ?? 0),
    })),
  };
}
