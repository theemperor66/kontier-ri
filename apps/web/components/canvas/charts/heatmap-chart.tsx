"use client";

import { Fragment, useMemo, useState } from "react";
import { formatValue } from "@/lib/format";
import {
  inkMix,
  markOpacity,
  type BaseChartProps,
} from "./common";

interface HeatmapViewProps extends BaseChartProps {
  /** Row dimension (second dim of the query). */
  yKey: string;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "2024-09" -> "Sep 24" (headers stay horizontal AND legible — A5). */
function shortLabel(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})/);
  if (!m) return v;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]!.slice(2)}` : v;
}

/** CSS-grid heatmap: xKey columns x yKey rows, cells shaded by value. */
export function HeatmapChartView({
  data,
  xKey,
  yKey,
  seriesKeys,
  valueFormat,
  onItemClick,
  activeValue,
}: HeatmapViewProps) {
  const valueKey = seriesKeys.find((k) => k !== yKey) ?? seriesKeys[0];
  const [hover, setHover] = useState<{ x: string; y: string } | null>(null);

  const model = useMemo(() => {
    if (!valueKey) return null;
    const xs: string[] = [];
    const ys: string[] = [];
    const seenX = new Set<string>();
    const seenY = new Set<string>();
    const cells = new Map<string, number>();
    for (const row of data) {
      const x = String(row[xKey] ?? "");
      const y = String(row[yKey] ?? "");
      if (!seenX.has(x)) {
        seenX.add(x);
        xs.push(x);
      }
      if (!seenY.has(y)) {
        seenY.add(y);
        ys.push(y);
      }
      const v = toNum(row[valueKey]);
      if (v != null) cells.set(`${x}\u0000${y}`, v);
    }
    let min = Infinity;
    let max = -Infinity;
    for (const v of cells.values()) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { xs: xs.slice(0, 40), ys: ys.slice(0, 30), cells, min, max };
  }, [data, xKey, yKey, valueKey]);

  if (!valueKey || !model || model.cells.size === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Heatmap needs two dimensions and one measure.
      </div>
    );
  }
  const { xs, ys, cells, min, max } = model;
  const span = max - min;
  // Crowded columns: keep headers HORIZONTAL, label every 2nd/3rd column
  // (hovered column always shows its label; full text lives in the cell
  // tooltip). Rotated labels were near-illegible at 100% zoom.
  const labelStep = xs.length > 18 ? 3 : xs.length > 8 ? 2 : 1;
  /** Dim cells outside the hovered row/column (cross-highlight). */
  const hoverDim = (x: string, y: string): number => {
    if (!hover) return 1;
    return hover.x === x || hover.y === y ? 1 : 0.45;
  };

  return (
    <div className="h-full w-full overflow-auto">
      <div
        className="grid h-full min-h-0 gap-px"
        style={{
          gridTemplateColumns: `minmax(76px, auto) repeat(${xs.length}, minmax(24px, 1fr))`,
          gridTemplateRows: `auto repeat(${ys.length}, minmax(20px, 1fr))`,
        }}
        onMouseLeave={() => setHover(null)}
      >
        <div />
        {xs.map((x, i) => {
          // Hover reveals the hovered column's label; drop step-labels within
          // one column of it so the two never overlap.
          const hoverIdx = hover ? xs.indexOf(hover.x) : -1;
          const showLabel =
            hoverIdx >= 0
              ? x === hover!.x ||
                (i % labelStep === 0 && Math.abs(i - hoverIdx) > 1)
              : i % labelStep === 0;
          return (
            <button
              key={`cx-${x}`}
              type="button"
              title={x}
              className={`overflow-visible whitespace-nowrap px-0.5 pb-0.5 text-center text-[10px] leading-tight transition-colors ${
                hover?.x === x
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              } ${onItemClick ? "cursor-pointer hover:text-foreground" : "cursor-default"}`}
              onClick={() => onItemClick?.({ column: xKey, value: x })}
            >
              {showLabel ? shortLabel(x) : "\u00a0"}
            </button>
          );
        })}
        {ys.map((y) => (
          <Fragment key={`row-${y}`}>
            <button
              key={`ry-${y}`}
              type="button"
              title={y}
              className={`truncate pr-1.5 text-right text-[10px] leading-tight transition-colors ${
                hover?.y === y
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              } ${onItemClick ? "cursor-pointer hover:text-foreground" : "cursor-default"} self-center`}
              onClick={() => onItemClick?.({ column: yKey, value: y })}
            >
              {y}
            </button>
            {xs.map((x) => {
              const v = cells.get(`${x}\u0000${y}`);
              const frac = v == null || span <= 0 ? 0.5 : (v - min) / span;
              return (
                <button
                  key={`c-${x}-${y}`}
                  type="button"
                  title={
                    v == null
                      ? `${y} / ${x}: —`
                      : `${y} / ${x}: ${formatValue(v, valueFormat ?? "number")}`
                  }
                  className={`group/cell relative rounded-[2px] transition-opacity duration-100 ${onItemClick ? "cursor-pointer" : "cursor-default"} outline-offset-[-1px] hover:outline hover:outline-1 hover:outline-ring`}
                  style={{
                    backgroundColor:
                      v == null ? "var(--muted)" : inkMix(frac),
                    opacity: markOpacity(activeValue, x) * hoverDim(x, y),
                  }}
                  onMouseEnter={() => setHover({ x, y })}
                  onClick={() => onItemClick?.({ column: xKey, value: x })}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
