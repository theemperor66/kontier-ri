"use client";

import { useMemo } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { formatValue, humanizeIdent, prettifySeriesLabel } from "@/lib/format";
import {
  markOpacity,
  sectorContextMenu,
  type BaseChartProps,
  type LegendToggle,
} from "./common";
import { chartTooltip } from "./chart-tooltip";

/** "plan" -> "plans"; already-plural dims are left alone. */
function pluralize(word: string, n: number): string {
  if (n === 1) return word;
  if (/s$/i.test(word)) return word;
  if (/y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

interface DonutViewProps extends BaseChartProps {
  /**
   * Category legend toggle (session state, keyed by tile): click hides a
   * slice, shift-click isolates it. Hidden entries render dimmed.
   */
  categoryToggle?: LegendToggle;
  /** Ring thickness: the design donut (default) or a fuller pie. */
  variant?: "donut" | "pie";
}

/**
 * Design donut: a ring with a surface hole carrying the visible category
 * COUNT, and a right-side legend list (8px swatch, label, muted value).
 * Slices still emit cross-filter clicks and the mark context menu.
 */
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
  variant = "donut",
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
  const valueByCategory = useMemo(() => {
    const map = new Map<string, number>();
    if (!valueKey) return map;
    for (const row of data) {
      const v = row[valueKey];
      if (typeof v === "number" && Number.isFinite(v)) {
        map.set(String(row[xKey] ?? ""), v);
      }
    }
    return map;
  }, [data, xKey, valueKey]);
  if (!valueKey) return null;

  // Stable slice colors: index into the FULL category list, so toggling
  // one category off never recolors the rest.
  const colorForCategory = (cat: string) =>
    colorFor(Math.max(0, categories.indexOf(cat)));
  const showLegend = categories.length > 1 && categories.length <= 12;
  const noun = pluralize(
    humanizeIdent(xKey).toLowerCase(),
    visible.length,
  );

  return (
    <div className="flex h-full w-full items-center gap-4">
      <div className="relative aspect-square h-full max-h-[110px] w-[clamp(84px,42%,110px)] shrink-0 self-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={visible}
              dataKey={valueKey}
              nameKey={xKey}
              innerRadius={variant === "pie" ? "48%" : "64%"}
              outerRadius="100%"
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
        {/* Design: the hole carries the count of visible categories. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className="text-center text-[15px] font-semibold leading-tight tabular-nums"
            title={
              total != null
                ? `Total ${formatValue(total, valueFormat)}`
                : undefined
            }
          >
            {visible.length} {noun}
          </span>
        </div>
      </div>
      {showLegend && categoryToggle ? (
        <div
          className="flex min-w-0 flex-1 flex-col justify-center gap-2 overflow-hidden"
          role="group"
          aria-label="Toggle slices"
        >
          {categories.map((cat) => {
            const off = hiddenKeys?.has(cat) === true;
            const v = valueByCategory.get(cat);
            const share =
              v != null && total != null && total > 0 ? v / total : null;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={!off}
                title={
                  v != null
                    ? `${prettifySeriesLabel(cat)}: ${formatValue(v, valueFormat)} (shift-click isolates)`
                    : `Toggle ${cat} (shift-click isolates)`
                }
                className={`flex w-full min-w-0 items-center gap-2 text-left text-[12px] leading-4 transition-opacity ${
                  off ? "opacity-40" : ""
                } hover:text-foreground`}
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
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: colorForCategory(cat) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {prettifySeriesLabel(cat)}
                </span>
                {share != null && !off ? (
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatValue(share, "percent")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
