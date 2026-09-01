"use client";

import { useMemo } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { formatValue, prettifySeriesLabel } from "@/lib/format";
import {
  markOpacity,
  sectorContextMenu,
  type BaseChartProps,
  type LegendToggle,
} from "./common";
import { chartTooltip } from "./chart-tooltip";

interface DonutViewProps extends BaseChartProps {
  /**
   * Category legend toggle (session state, keyed by tile): click hides a
   * slice, shift-click isolates it. Hidden entries render dimmed.
   */
  categoryToggle?: LegendToggle;
}

/** Donut with a centered total; slices emit cross-filter clicks. */
export function DonutChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  onItemClick,
  onItemContextMenu,
  activeValue,
  hiddenKeys,
  categoryToggle,
}: DonutViewProps) {
  const valueKey = seriesKeys[0];
  const categories = useMemo(
    () => data.map((row) => String(row[xKey] ?? "")),
    [data, xKey],
  );
  const visible = useMemo(
    () => data.filter((row) => !hiddenKeys?.has(String(row[xKey] ?? ""))),
    [data, xKey, hiddenKeys],
  );
  const total = useMemo(() => {
    if (!valueKey) return null;
    let sum = 0;
    for (const row of visible) {
      const v = row[valueKey];
      if (typeof v === "number" && Number.isFinite(v)) sum += v;
    }
    return sum;
  }, [visible, valueKey]);
  if (!valueKey) return null;

  // Stable slice colors: index into the FULL category list, so toggling
  // one category off never recolors the rest.
  const colorForCategory = (cat: string) =>
    colorFor(Math.max(0, categories.indexOf(cat)));
  const showLegend = categories.length > 1 && categories.length <= 12;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={visible}
              dataKey={valueKey}
              nameKey={xKey}
              innerRadius="68%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="var(--card)"
              className={onItemClick ? "cursor-crosshair" : undefined}
              onContextMenu={sectorContextMenu(xKey, onItemContextMenu) as never}
              onClick={(item: unknown) => {
                // recharts 3 spreads the datum into the item; payload is not
                // always present (Pie sectors, Scatter points).
                const entry = item as
                  | ({ payload?: Record<string, unknown>; name?: unknown } & Record<string, unknown>)
                  | undefined;
                const v = entry?.payload?.[xKey] ?? entry?.[xKey] ?? entry?.name;
                if (v != null) onItemClick?.({ column: xKey, value: v });
              }}
            >
              {visible.map((row, i) => (
                <Cell
                  key={i}
                  fill={colorForCategory(String(row[xKey] ?? ""))}
                  opacity={markOpacity(activeValue, row[xKey])}
                />
              ))}
            </Pie>
            <RechartsTooltip
              content={chartTooltip({
                share: true,
                total: total ?? undefined,
                formatFor: () => valueFormat,
                labelFor: (_k, name) => name,
              })}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums leading-tight">
            {total != null ? formatValue(total, valueFormat ?? "compact") : "—"}
          </span>
          <span className="text-[10px] text-muted-foreground">total</span>
        </div>
      </div>
      {showLegend && categoryToggle ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 pt-1"
          role="group"
          aria-label="Toggle slices"
        >
          {categories.map((cat) => {
            const off = hiddenKeys?.has(cat) === true;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={!off}
                title={off ? `Show ${cat} (shift-click isolates)` : `Hide ${cat} (shift-click isolates)`}
                className={`flex max-w-full items-center gap-1 text-[10px] leading-4 transition-opacity ${
                  off ? "opacity-40" : ""
                } text-muted-foreground hover:text-foreground`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  categoryToggle.toggle(cat, {
                    isolate: e.shiftKey,
                    allKeys: categories,
                  });
                }}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: colorForCategory(cat) }}
                />
                <span className="truncate">{prettifySeriesLabel(cat)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
