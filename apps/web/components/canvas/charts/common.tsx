"use client";

/**
 * Shared theme + prop contract for the canvas chart renderers.
 * All series inks come from the Kontier chart tokens (var(--chart-N)).
 */

import { useCallback, useState } from "react";
import type { CrossFilter } from "@kontier-ri/studio";
import type { FormatOptions, ValueFormat } from "@/lib/format";
import { formatAxisTick, prettifySeriesLabel } from "@/lib/format";
import { useDashboardStore } from "@/lib/dashboard-store";

export const CHART_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Legend formatter: SQL aliases render as human words (A2). */
export function legendLabelFormatter(value: unknown): React.ReactNode {
  return prettifySeriesLabel(String(value ?? ""));
}

/** Injected series key that carries the computed trendline. */
export const TREND_KEY = "__trend";

export interface SeriesClick {
  column: string;
  value: unknown;
}

/** Normalized props every canvas chart renderer accepts. */
export interface BaseChartProps {
  data: Record<string, unknown>[];
  /** Category / x-axis column name. */
  xKey: string;
  /** Numeric series (already filtered to existing columns). */
  seriesKeys: string[];
  colorFor: (index: number) => string;
  /** spec.format.value — number formatting for values + y axis. */
  valueFormat?: ValueFormat | FormatOptions;
  /** Cross-filter emission: a mark was clicked. */
  onItemClick?: (click: SeriesClick) => void;
  /** Active cross-filter value on xKey (marks not matching are dimmed). */
  activeValue?: unknown;
  /** Series hidden via legend toggle. */
  hiddenKeys?: ReadonlySet<string>;
}

export function axisTickFormatter(valueFormat?: ValueFormat | FormatOptions) {
  return (v: number): string => formatAxisTick(v, valueFormat);
}

/** Y-axis width: currency ticks ("\u20ac100K") need more room than "100K". */
export function axisWidth(valueFormat?: ValueFormat | FormatOptions): number {
  const style = typeof valueFormat === "string" ? valueFormat : valueFormat?.style;
  return style === "currency" ? 56 : 44;
}

/** Opacity for a clickable mark under an active cross-filter. */
export function markOpacity(
  activeValue: unknown,
  markValue: unknown,
): number {
  if (activeValue == null) return 1;
  return String(activeValue) === String(markValue) ? 1 : 0.35;
}

/** Kontier-ink sequential color scale (heatmap, funnel stages). */
export function inkMix(fraction: number, ink = "var(--chart-1)"): string {
  const pct = Math.round(15 + 80 * Math.min(1, Math.max(0, fraction)));
  return `color-mix(in oklab, ${ink} ${pct}%, transparent)`;
}

/** Legend-toggle state: click a legend entry to hide/show its series. */
export function useHiddenSeries(): {
  hidden: ReadonlySet<string>;
  toggle: (key: unknown) => void;
} {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((key: unknown) => {
    if (typeof key !== "string" || key.length === 0) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  return { hidden, toggle };
}

// ---------------------------------------------------------------------------
// Cross-filter emission (shared by chart + table tiles)
// ---------------------------------------------------------------------------

export function toCrossFilterValue(v: unknown): CrossFilter["value"] {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "bigint") return Number(v);
  return String(v);
}

/**
 * Click-to-cross-filter: returns the active crossFilter and a toggle handler
 * (clicking the same {column, value} again clears the filter).
 */
export function useCrossFilterEmit(tileId: string): {
  crossFilter: CrossFilter | null;
  emit: (click: SeriesClick) => void;
} {
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);
  const setCrossFilter = useDashboardStore((s) => s.setCrossFilter);
  const clearCrossFilter = useDashboardStore((s) => s.clearCrossFilter);
  const emit = useCallback(
    ({ column, value }: SeriesClick) => {
      const v = toCrossFilterValue(value);
      const current = useDashboardStore.getState().doc.crossFilter;
      if (
        current &&
        current.column === column &&
        String(current.value) === String(v)
      ) {
        clearCrossFilter({ origin: "human", label: "Cleared cross-filter" });
        return;
      }
      setCrossFilter(
        { column, value: v, sourceTileId: tileId },
        { origin: "human", label: `Cross-filter ${column} = ${String(v)}` },
      );
    },
    [setCrossFilter, clearCrossFilter, tileId],
  );
  return { crossFilter, emit };
}
