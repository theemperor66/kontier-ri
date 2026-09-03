"use client";

/**
 * Shared read-model helpers for the non-canvas workspace views
 * (Home / Approvals / Datasets / Semantic model / Data health / Audit log).
 *
 * Everything here is derived from live product state: the DuckDB dataset
 * registry, the dashboard document and the command log. Nothing is invented —
 * when a fact is unknown (a refresh schedule, an owner, a source system) the
 * views say so instead of filling the gap.
 */

import { useEffect, useState } from "react";
import type { DatasetMeta } from "@kontier-ri/datasource";
import type {
  ChartSpec,
  KpiSpec,
  TableSpec,
  Tile,
} from "@/lib/dashboard-store";
import { dataSource, useDataSource } from "@/lib/datasource";

// ---------------------------------------------------------------------------
// Live dataset registry
// ---------------------------------------------------------------------------

/** Where a dataset came from — the only origins the engine actually knows. */
export type DatasetOrigin = "demo" | "uploaded" | "view";

export function datasetOrigin(meta: DatasetMeta): DatasetOrigin {
  if (meta.group === "views" || meta.name.startsWith("view_")) return "view";
  if (meta.group === "uploads") return "uploaded";
  return "demo";
}

export const ORIGIN_LABEL: Record<DatasetOrigin, string> = {
  demo: "Demo data",
  uploaded: "Uploaded in this tab",
  view: "SQL views",
};

export const ORIGIN_NOTE: Record<DatasetOrigin, string> = {
  demo: "Loaded from the bundled CSVs when the tab opened.",
  uploaded:
    "Held in this browser tab only. A reload clears it and tiles that use it stop resolving.",
  view: "Defined by SQL in this dashboard and re-created in the engine on load.",
};

/**
 * The dataset list as the engine reports it right now. The provider only
 * re-lists after an import, so views created later (create_view) are picked up
 * by re-listing whenever the doc's view registry changes.
 */
export function useLiveDatasets(viewCount = 0): {
  datasets: DatasetMeta[];
  status: ReturnType<typeof useDataSource>["status"];
  statusDetail: string;
} {
  const { datasets, status, statusDetail, dataVersion } = useDataSource();
  const [live, setLive] = useState<DatasetMeta[]>(datasets);

  useEffect(() => {
    setLive(datasets);
  }, [datasets]);

  useEffect(() => {
    let cancelled = false;
    if (status !== "ready") return;
    void dataSource
      .listDatasets()
      .then((next) => {
        if (!cancelled) setLive(next);
      })
      .catch(() => {
        /* keep the provider's list; the status card reports engine errors */
      });
    return () => {
      cancelled = true;
    };
  }, [status, dataVersion, viewCount]);

  return { datasets: live, status, statusDetail };
}

/** Total rows across a dataset list (BIGINT counts are already numbers). */
export function totalRows(datasets: DatasetMeta[]): number {
  return datasets.reduce((sum, d) => sum + (d.rowCount || 0), 0);
}

// ---------------------------------------------------------------------------
// Column types
// ---------------------------------------------------------------------------

/** Short chip label for a DuckDB type (VARCHAR -> str, BIGINT -> int, …). */
export function shortType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("timestamp") || t.includes("time")) return "time";
  if (t.includes("date")) return "date";
  if (t.includes("bool")) return "bool";
  if (
    t.includes("double") ||
    t.includes("decimal") ||
    t.includes("float") ||
    t.includes("real") ||
    t.includes("numeric")
  ) {
    return "num";
  }
  if (t.includes("int") || t.includes("hugeint")) return "int";
  if (t.includes("char") || t.includes("text") || t.includes("string")) {
    return "str";
  }
  if (t.includes("json") || t.includes("struct") || t.includes("map")) {
    return "obj";
  }
  return t.slice(0, 4) || "?";
}

// ---------------------------------------------------------------------------
// Tile -> data lineage (derived from the real tile spec, never invented)
// ---------------------------------------------------------------------------

/** The dataset a tile's spec points at (markdown tiles read no data). */
export function tileDataset(tile: Tile): string | null {
  if (tile.type === "markdown") return null;
  const spec = tile.spec as KpiSpec | ChartSpec | TableSpec;
  return typeof spec.dataset === "string" && spec.dataset ? spec.dataset : null;
}

/** Raw SQL a tile carries in its spec (table sql, kpi sql, chart sql query). */
export function tileSQL(tile: Tile): string[] {
  const out: string[] = [];
  if (tile.type === "table") {
    const spec = tile.spec as TableSpec;
    if (spec.sql) out.push(spec.sql);
  } else if (tile.type === "kpi") {
    const spec = tile.spec as KpiSpec;
    if (spec.sql) out.push(spec.sql);
  } else if (tile.type === "chart") {
    const spec = tile.spec as ChartSpec;
    if ("sql" in spec.query && spec.query.sql) out.push(spec.query.sql);
  }
  return out;
}

/**
 * Every known dataset/view a tile actually reads: its `spec.dataset` plus any
 * registered name that appears as an identifier in the tile's own SQL.
 */
export function tileSources(tile: Tile, knownNames: string[]): string[] {
  const found = new Set<string>();
  const primary = tileDataset(tile);
  if (primary) found.add(primary);
  const sql = tileSQL(tile).join("\n");
  if (sql) {
    for (const name of knownNames) {
      const pattern = new RegExp(`(^|[^\\w"])"?${escapeRegExp(name)}"?([^\\w"]|$)`, "i");
      if (pattern.test(sql)) found.add(name);
    }
  }
  return [...found];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Calculated fields whose name appears in a tile's structured query or SQL. */
export function tileMeasures(tile: Tile, fieldNames: string[]): string[] {
  if (tile.type === "markdown" || fieldNames.length === 0) return [];
  const haystack = JSON.stringify(tile.spec);
  return fieldNames.filter((name) =>
    new RegExp(`(^|[^\\w])${escapeRegExp(name)}([^\\w]|$)`).test(haystack),
  );
}
