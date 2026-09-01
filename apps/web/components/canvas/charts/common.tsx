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

/** Viewport coordinates where a mark context menu should open. */
export interface MarkPoint {
  x: number;
  y: number;
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
  /** Right-click on a mark: open the mark context menu at viewport coords. */
  onItemContextMenu?: (click: SeriesClick, at: MarkPoint) => void;
}

/**
 * Chart-level contextmenu adapter for cartesian recharts charts: recharts
 * passes the categorical hover state (activeLabel) plus the mouse event.
 * preventDefault suppresses the native menu; left-click cross-filter
 * behavior (chart onClick) is untouched.
 */
export function chartContextMenu(
  xKey: string,
  cb?: (click: SeriesClick, at: MarkPoint) => void,
): ((state: { activeLabel?: unknown }, e: unknown) => void) | undefined {
  if (!cb) return undefined;
  return (state, e) => {
    const ev = e as
      | {
          clientX?: number;
          clientY?: number;
          preventDefault?: () => void;
          stopPropagation?: () => void;
        }
      | undefined;
    if (state?.activeLabel == null || typeof ev?.clientX !== "number") return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    cb(
      { column: xKey, value: state.activeLabel },
      { x: ev.clientX, y: ev.clientY ?? 0 },
    );
  };
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

// ---------------------------------------------------------------------------
// Legend visibility (session-scoped, per tile)
// ---------------------------------------------------------------------------

/**
 * Hidden legend entries per tile — SESSION state only: it survives tile
 * re-mounts (page switches, re-queries) but is never written to the doc,
 * never undoable and never activity-logged.
 */
const sessionHiddenSeries = new Map<string, ReadonlySet<string>>();

export interface LegendToggle {
  hidden: ReadonlySet<string>;
  /**
   * Toggle one entry. `isolate` (shift-click) hides every OTHER entry;
   * shift-clicking an already-isolated entry restores all of them.
   */
  toggle: (
    key: unknown,
    opts?: { isolate?: boolean; allKeys?: readonly string[] },
  ) => void;
}

/** Legend-toggle state: click a legend entry to hide/show its series. */
export function useHiddenSeries(tileId: string): LegendToggle {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => sessionHiddenSeries.get(tileId) ?? new Set(),
  );
  const toggle = useCallback(
    (
      key: unknown,
      opts?: { isolate?: boolean; allKeys?: readonly string[] },
    ) => {
      if (typeof key !== "string" || key.length === 0) return;
      setHidden((prev) => {
        let next: Set<string>;
        const all = opts?.allKeys ?? [];
        if (opts?.isolate && all.length > 1) {
          const others = all.filter((k) => k !== key);
          const alreadyIsolated =
            !prev.has(key) && others.every((k) => prev.has(k));
          next = alreadyIsolated ? new Set() : new Set(others);
        } else {
          next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
        }
        sessionHiddenSeries.set(tileId, next);
        return next;
      });
    },
    [tileId],
  );
  return { hidden, toggle };
}

interface LegendPayloadEntry {
  value?: unknown;
  color?: string;
  dataKey?: unknown;
  inactive?: boolean;
}

/**
 * Custom <Legend content> with toggling: click hides/shows a series,
 * shift-click isolates it, hidden entries render dimmed. A content
 * renderer (not Legend onClick) because recharts 3 legend items do not
 * reliably forward item clicks.
 */
export function legendToggleContent(
  legend: LegendToggle,
  allKeys: readonly string[],
): (props: unknown) => React.ReactNode {
  const render = (props: unknown) => {
    const { payload } = props as { payload?: LegendPayloadEntry[] };
    if (!payload || payload.length === 0) return null;
    return (
      <ul
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 pt-0.5 text-[11px] leading-4"
        role="group"
        aria-label="Toggle series"
      >
        {payload.map((entry, i) => {
          const key =
            typeof entry.dataKey === "string"
              ? entry.dataKey
              : String(entry.value ?? "");
          const off = legend.hidden.has(key);
          const label = prettifySeriesLabel(String(entry.value ?? ""));
          return (
            <li key={`${key}-${i}`} className="flex min-w-0">
              <button
                type="button"
                aria-pressed={!off}
                title={
                  off
                    ? `Show ${label} (shift-click isolates)`
                    : `Hide ${label} (shift-click isolates)`
                }
                className={`flex min-w-0 cursor-pointer items-center gap-1 transition-opacity ${
                  off ? "opacity-40" : ""
                } text-muted-foreground hover:text-foreground`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  legend.toggle(key, { isolate: e.shiftKey, allKeys });
                }}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: entry.color ?? "var(--chart-1)" }}
                />
                <span className="truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };
  return render;
}

/**
 * Per-item contextmenu adapter (Pie sectors, Scatter points): recharts 3
 * spreads the datum into the item and passes the mouse event in a trailing
 * argument — scan the args for both.
 */
export function sectorContextMenu(
  xKey: string,
  cb?: (click: SeriesClick, at: MarkPoint) => void,
): ((...args: unknown[]) => void) | undefined {
  if (!cb) return undefined;
  return (...args: unknown[]) => {
    let value: unknown;
    let ev:
      | { clientX: number; clientY?: number; preventDefault?: () => void }
      | undefined;
    for (const a of args) {
      if (a == null || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      if (typeof o.clientX === "number" && typeof o.preventDefault === "function") {
        ev = o as unknown as typeof ev;
        continue;
      }
      if (value == null) {
        const payload = (o.payload ?? o) as Record<string, unknown>;
        value = payload[xKey] ?? o.name;
      }
    }
    if (value == null || ev == null) return;
    ev.preventDefault?.();
    cb({ column: xKey, value }, { x: ev.clientX, y: ev.clientY ?? 0 });
  };
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
