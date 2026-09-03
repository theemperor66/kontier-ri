"use client";

/**
 * Tile sub-line (design: 12px faint line under the 14px title).
 *
 * Derived from the REAL spec only — dataset, aggregation/measure, x dim,
 * comparison and tile filters. Nothing here is invented: when a fact is not
 * in the spec it is omitted. `summarizeSpec` (the canonical technical
 * summary used by the agent tools) backs the hover title so the exact spec
 * stays one hover away.
 */

import { summarizeSpec } from "@kontier-ri/studio";
import type {
  ChartSpec,
  KpiSpec,
  TableSpec,
  Tile,
} from "@/lib/dashboard-store";
import { humanizeIdent, prettifySeriesLabel } from "@/lib/format";

const DOT = " \u00b7 ";

/** "sum(amount_eur)" -> "Amount (EUR)"; count(*) -> "Row count". */
function measureLabel(agg: string | undefined, col: string | undefined): string {
  if (!col || col === "*") return agg === "count" ? "Row count" : "Rows";
  return prettifySeriesLabel(`${agg ?? "sum"}_${col}`);
}

function filterNote(filters: readonly unknown[] | undefined): string | null {
  const n = filters?.length ?? 0;
  if (n === 0) return null;
  return n === 1 ? "1 filter" : `${n} filters`;
}

/**
 * KPI cards are the narrowest tiles on the grid (3 of 12 columns), so their
 * sub-line stays short: the measure when the spec names one, otherwise the
 * dataset. The full technical summary is one hover away on the header.
 */
function kpiSub(spec: KpiSpec): string {
  const parts = spec.sql
    ? [spec.dataset]
    : [measureLabel(spec.agg, spec.measure), spec.dataset];
  const f = filterNote(spec.filters);
  if (f) parts.push(f);
  return parts.join(DOT);
}

function chartSub(spec: ChartSpec): string {
  const measures =
    "sql" in spec.query
      ? (spec.seriesKeys ?? []).map(prettifySeriesLabel)
      : spec.query.measures.map((m) => measureLabel(m.agg, m.col));
  const by = spec.xKey ? humanizeIdent(spec.xKey).toLowerCase() : null;
  const head =
    measures.length > 0
      ? `${measures.slice(0, 2).join(", ")}${measures.length > 2 ? "\u2026" : ""}${
          by ? ` by ${by}` : ""
        }`
      : by
        ? `By ${by}`
        : "Custom SQL";
  const parts = [head, spec.dataset];
  const f = filterNote(spec.filters);
  if (f) parts.push(f);
  return parts.join(DOT);
}

function tableSub(spec: TableSpec): string {
  const parts = [spec.dataset];
  const f = filterNote(spec.filters);
  if (f) parts.push(f);
  if (spec.pageSize) parts.push(`${spec.pageSize} per page`);
  return parts.join(DOT);
}

/** One faint line of real context under the tile title. */
export function tileSubline(tile: Tile): string {
  switch (tile.type) {
    case "kpi":
      return kpiSub(tile.spec as KpiSpec);
    case "chart":
      return chartSub(tile.spec as ChartSpec);
    case "table":
      return tableSub(tile.spec as TableSpec);
    case "markdown":
      return "Note";
  }
}

/** Exact spec summary for the header tooltip (same string the agent sees). */
export function tileSpecTitle(tile: Tile): string {
  try {
    return summarizeSpec(tile);
  } catch {
    return tile.title;
  }
}
