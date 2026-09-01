"use client";

/** Runs a tile's query against the shared DataSource; re-runs on global
 * filter / date-range / cross-filter / calculated-field / data changes.
 * SQL comes from the single authority @kontier-ri/studio buildTileQuery
 * (global + tile filters, date range, cross-filter, calculated fields);
 * fallbackSQL is retried when pushed-down filters reference columns the
 * tile's SQL does not expose. */

import { useEffect, useMemo, useState } from "react";
import type { QueryResult } from "@kontier-ri/datasource";
import {
  buildTileQuery,
  filterClause,
  measureExpr,
  pickDateColumn,
  type BuiltTileQuery,
} from "@kontier-ri/studio";
import { dataSource, useDataSource } from "@/lib/datasource";
import { quoteIdent, wrapOrderBy, type SortSpec } from "@/lib/sql";
import type { KpiSpec, Tile } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";

export interface TileData {
  loading: boolean;
  error: string | null;
  result: QueryResult | null;
  /**
   * True when a requested `sort` was applied server-side (ORDER BY wrap).
   * False when the wrap failed and the caller should client-sort instead.
   */
  serverSorted?: boolean;
}

export function useTileData(tile: Tile, sort?: SortSpec | null): TileData {
  const { datasets, dataVersion, status } = useDataSource();
  const filters = useDashboardStore((s) => s.doc.filters.filters);
  const dateRange = useDashboardStore((s) => s.doc.filters.dateRange);
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);
  const calculatedFields = useDashboardStore((s) => s.doc.calculatedFields);

  const built: BuiltTileQuery | null = useMemo(() => {
    if (tile.type === "markdown") return null;
    try {
      return buildTileQuery(tile, {
        datasets,
        globalFilters: filters,
        dateRange,
        crossFilter,
        calculatedFields,
      });
    } catch (err) {
      console.warn("tile query build failed", err);
      return null;
    }
  }, [tile, datasets, filters, dateRange, crossFilter, calculatedFields]);

  const [data, setData] = useState<TileData>({
    loading: true,
    error: null,
    result: null,
  });

  useEffect(() => {
    if (!built || status !== "ready") return;
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, error: null }));
    (async () => {
      // Candidate order: sorted primary, sorted fallback, then the
      // unsorted originals (a failing ORDER BY wrap degrades to the
      // caller's client-side page sort, never to an error).
      const candidates: Array<{ sql: string; serverSorted: boolean }> = [];
      const push = (sql: string | undefined, serverSorted: boolean) => {
        if (sql && !candidates.some((c) => c.sql === sql)) {
          candidates.push({ sql, serverSorted });
        }
      };
      if (sort) {
        push(wrapOrderBy(built.sql, sort), true);
        if (built.fallbackSQL) push(wrapOrderBy(built.fallbackSQL, sort), true);
      }
      push(built.sql, false);
      push(built.fallbackSQL, false);
      let lastErr: unknown = null;
      for (const c of candidates) {
        try {
          const result = await dataSource.runQuery(c.sql);
          if (!cancelled) {
            setData({
              loading: false,
              error: null,
              result,
              serverSorted: sort ? c.serverSorted : undefined,
            });
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!cancelled) {
        setData({
          loading: false,
          error: lastErr instanceof Error ? lastErr.message : String(lastErr),
          result: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [built, status, dataVersion, sort]);

  return data;
}

// ---------------------------------------------------------------------------
// KPI sparkline (A3): last 12 periods of the measure, one extra query.
// ---------------------------------------------------------------------------

function isDateTypeName(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("date") || t.includes("timestamp");
}

/**
 * Trailing per-period history for a structured (measure/agg) KPI tile.
 * Returns null when the spec is raw SQL, the dataset has no date column,
 * or the query fails — the KPI then renders exactly as before (graceful
 * skip). Respects global + tile filters; deliberately ignores the global
 * date range so the spark always shows trailing context.
 */
export function useKpiSparkline(tile: Tile): number[] | null {
  const { datasets, dataVersion, status } = useDataSource();
  const filters = useDashboardStore((s) => s.doc.filters.filters);
  const calculatedFields = useDashboardStore((s) => s.doc.calculatedFields);
  const [points, setPoints] = useState<number[] | null>(null);

  const sql = useMemo(() => {
    if (tile.type !== "kpi") return null;
    const spec = tile.spec as KpiSpec;
    if (spec.sql) return null;
    const meta = datasets.find((d) => d.name === spec.dataset);
    if (!meta) return null;
    const dateCol = pickDateColumn(meta.columns);
    if (!dateCol) return null;
    try {
      const fields = calculatedFields.filter(
        (f) => f.dataset === spec.dataset,
      );
      const { expr } = measureExpr(
        { col: spec.measure ?? "*", agg: spec.agg ?? "sum" },
        fields,
      );
      const periodExpr = isDateTypeName(dateCol.type)
        ? `strftime(CAST(${quoteIdent(dateCol.name)} AS DATE), '%Y-%m')`
        : `substr(CAST(${quoteIdent(dateCol.name)} AS VARCHAR), 1, 7)`;
      const names = new Set(meta.columns.map((c) => c.name));
      const clauses = [
        ...filters.filter((f) => names.has(f.column)).map(filterClause),
        ...(spec.filters ?? [])
          .filter((f) => names.has(f.column))
          .map(filterClause),
      ];
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
      return (
        `WITH per_period AS (SELECT ${periodExpr} AS __p, ${expr} AS __v ` +
        `FROM ${quoteIdent(spec.dataset)}${where} GROUP BY 1) ` +
        `SELECT __p, __v FROM per_period ORDER BY __p DESC LIMIT 12`
      );
    } catch {
      return null;
    }
  }, [tile, datasets, filters, calculatedFields]);

  useEffect(() => {
    if (!sql || status !== "ready") {
      setPoints(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await dataSource.runQuery(sql);
        if (cancelled) return;
        const vi = result.columns.findIndex((c) => c.name === "__v");
        const vals = result.rows
          .map((r) => {
            const v = r[vi < 0 ? 1 : vi];
            const n = typeof v === "bigint" ? Number(v) : (v as number);
            return typeof n === "number" && Number.isFinite(n) ? n : null;
          })
          .filter((n): n is number => n != null)
          .reverse();
        setPoints(vals.length >= 3 ? vals : null);
      } catch {
        if (!cancelled) setPoints(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sql, status, dataVersion]);

  return points;
}
