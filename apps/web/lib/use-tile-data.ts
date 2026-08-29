"use client";

/** Runs a tile's query against the shared DataSource; re-runs on global
 * filter / date-range / cross-filter / data changes. Falls back to the
 * unfiltered query when pushed-down filters reference columns the tile's
 * SQL does not expose. */

import { useEffect, useMemo, useState } from "react";
import type { QueryResult } from "@kontier-ri/datasource";
import type { TileFilter } from "@kontier-ri/studio";
import { dataSource, useDataSource } from "@/lib/datasource";
import {
  buildChartQuery,
  buildKpiQuery,
  buildTableQuery,
  type BuiltQuery,
} from "@/lib/sql";
import type {
  ChartSpec,
  GlobalFilter,
  KpiSpec,
  TableSpec,
  Tile,
} from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";

export interface TileData {
  loading: boolean;
  error: string | null;
  result: QueryResult | null;
}

export function useTileData(tile: Tile): TileData {
  const { datasets, dataVersion, status } = useDataSource();
  const filters = useDashboardStore((s) => s.doc.filters.filters);
  const dateRange = useDashboardStore((s) => s.doc.filters.dateRange);
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);

  // Effective filter list: global filters + tile-scoped spec.filters +
  // the active cross-filter (unless this tile opted out or originated it).
  // Filters whose column is absent from the tile's dataset are dropped by
  // buildWhereClauses, so a cross-filter never breaks unrelated tiles.
  const effectiveFilters: GlobalFilter[] = useMemo(() => {
    const merged: GlobalFilter[] = [...filters];
    if (tile.type !== "markdown") {
      const tileFilters = (tile.spec as { filters?: TileFilter[] }).filters;
      if (Array.isArray(tileFilters)) merged.push(...tileFilters);
    }
    if (
      crossFilter &&
      !tile.ignoreCrossFilter &&
      crossFilter.sourceTileId !== tile.id
    ) {
      merged.push({
        column: crossFilter.column,
        op: "eq",
        value: crossFilter.value,
      });
    }
    return merged;
  }, [filters, tile.type, tile.spec, tile.ignoreCrossFilter, tile.id, crossFilter]);

  const built: BuiltQuery | null = useMemo(() => {
    if (tile.type === "markdown") return null;
    try {
      if (tile.type === "kpi") {
        return buildKpiQuery(
          tile.spec as KpiSpec,
          datasets,
          effectiveFilters,
          dateRange,
        );
      }
      if (tile.type === "chart") {
        return buildChartQuery(
          tile.spec as ChartSpec,
          datasets,
          effectiveFilters,
          dateRange,
        );
      }
      return buildTableQuery(tile.spec as TableSpec, datasets, effectiveFilters);
    } catch (err) {
      console.warn("tile query build failed", err);
      return null;
    }
  }, [tile.type, tile.spec, datasets, effectiveFilters, dateRange]);

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
      try {
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
        if (!cancelled) setData({ loading: false, error: null, result });
      } catch (err) {
        if (!cancelled) {
          setData({
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            result: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [built, status, dataVersion]);

  return data;
}
