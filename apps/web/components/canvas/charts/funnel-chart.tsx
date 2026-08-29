"use client";

import { useMemo } from "react";
import { formatValue } from "@/lib/format";
import {
  inkMix,
  markOpacity,
  type BaseChartProps,
} from "./common";

/**
 * Funnel: descending stages with width proportional to value.
 * Rendered as a CSS flex column (crisper labels + conversion % than the
 * recharts trapezoid funnel at tile sizes).
 */
export function FunnelChartView({
  data,
  xKey,
  seriesKeys,
  valueFormat,
  onItemClick,
  activeValue,
}: BaseChartProps) {
  const valueKey = seriesKeys[0];
  const stages = useMemo(() => {
    if (!valueKey) return [];
    const rows = data
      .map((row) => ({
        label: String(row[xKey] ?? ""),
        raw: row[xKey],
        value:
          typeof row[valueKey] === "number" &&
          Number.isFinite(row[valueKey] as number)
            ? (row[valueKey] as number)
            : 0,
      }))
      .sort((a, b) => b.value - a.value);
    const max = rows[0]?.value ?? 0;
    return rows.map((r, i) => ({
      ...r,
      widthPct: max > 0 ? Math.max(6, (r.value / max) * 100) : 0,
      convPct: i === 0 || max === 0 ? null : r.value / (rows[0]?.value ?? 1),
    }));
  }, [data, xKey, valueKey]);
  if (!valueKey) return null;

  return (
    <div className="flex h-full w-full flex-col justify-center gap-1 py-1">
      {stages.map((s, i) => (
        <button
          key={`${s.label}-${i}`}
          type="button"
          className={`group/stage flex min-h-0 flex-1 items-stretch gap-2 text-left ${onItemClick ? "cursor-pointer" : "cursor-default"}`}
          onClick={() =>
            s.raw != null && onItemClick?.({ column: xKey, value: s.raw })
          }
        >
          <span className="flex w-24 shrink-0 items-center justify-end truncate text-[11px] text-muted-foreground">
            {s.label}
          </span>
          <span className="relative flex min-w-0 flex-1 items-center">
            <span
              className="h-full max-h-9 min-h-4 rounded-sm transition-[filter] group-hover/stage:brightness-110"
              style={{
                width: `${s.widthPct}%`,
                backgroundColor: inkMix(
                  stages.length > 1 ? 1 - (i / (stages.length - 1)) * 0.7 : 1,
                ),
                opacity: markOpacity(activeValue, s.raw),
              }}
            />
            <span className="ml-1.5 shrink-0 text-[11px] font-medium tabular-nums">
              {formatValue(s.value, valueFormat ?? "compact")}
            </span>
            {s.convPct != null ? (
              <span className="ml-1 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {formatValue(s.convPct, "percent")}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
