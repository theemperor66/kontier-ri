"use client";

/**
 * Client-side CSV export for a tile: rebuild the tile's query through the
 * studio SQL authority (global + tile filters, cross-filter, calculated
 * fields), run it against the shared DuckDB instance, and download the
 * result as `<tile-title>.csv`.
 */

import type { QueryResult } from "@kontier-ri/datasource";
import { buildTileQuery, toCSV as studioToCSV } from "@kontier-ri/studio";
import { dataSource } from "@/lib/datasource";
import type { DashboardDoc, Tile } from "@/lib/dashboard-store";
import { downloadBlob, slugify } from "@/lib/dashboards";

/** Run the tile's query and download the rows as CSV. Throws on failure. */
export async function exportTileCSV(tile: Tile, doc: DashboardDoc): Promise<void> {
  const datasets = await dataSource.listDatasets();
  const built = buildTileQuery(tile, {
    datasets,
    globalFilters: doc.filters.filters,
    dateRange: doc.filters.dateRange,
    crossFilter: doc.crossFilter,
    calculatedFields: doc.calculatedFields,
  });
  if (!built) {
    throw new Error(`"${tile.title}" is a ${tile.type} tile — no data to export.`);
  }
  let result: QueryResult;
  try {
    result = await dataSource.runQuery(built.sql);
  } catch (err) {
    if (built.fallbackSQL && built.fallbackSQL !== built.sql) {
      result = await dataSource.runQuery(built.fallbackSQL);
    } else {
      throw err;
    }
  }
  const csv = studioToCSV(result.columns, result.rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${slugify(tile.title)}.csv`);
}
