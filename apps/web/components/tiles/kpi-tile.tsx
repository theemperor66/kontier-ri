"use client";

import { TrendDown, TrendUp } from "@phosphor-icons/react";
import type { KpiSpec, Tile } from "@/lib/dashboard-store";
import { useKpiSparkline, useTileData } from "@/lib/use-tile-data";
import { formatDelta, formatValue, resolveRuleColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TileError } from "./tile-error";
import { TileShimmer } from "./tile-shimmer";

function firstNumber(v: unknown): number | null {
  const n =
    typeof v === "string" || typeof v === "bigint" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Line + area path for the sparkline underlay (viewBox 0 0 100 32). */
function sparkPaths(points: number[]): { line: string; area: string } {
  const w = 100;
  const h = 32;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const step = w / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * step;
    const y =
      span <= 0 ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return { line, area };
}

/**
 * KPI v2 (A3): display number on the Kontier type scale, ▲▼ delta chip with
 * success/destructive semantics, and a trailing-12-period sparkline underlay
 * when the measure has temporal history (graceful skip otherwise).
 */
export function KpiTile({ tile }: { tile: Tile }) {
  const spec = tile.spec as KpiSpec;
  const { loading, error, result } = useTileData(tile);
  const spark = useKpiSparkline(tile);

  if (error) return <TileError message={error} />;
  if (loading || !result) return <TileShimmer kind="kpi" />;

  const row = result.rows[0] ?? [];
  const nameIdx = (n: string) =>
    result.columns.findIndex((c) => c.name.toLowerCase() === n);
  const valueIdx = nameIdx("value") >= 0 ? nameIdx("value") : 0;
  const prevIdx = nameIdx("prev");
  const value = firstNumber(row[valueIdx]);
  const prev =
    prevIdx >= 0 ? firstNumber(row[prevIdx]) : firstNumber(row[valueIdx + 1]);
  // Delta: explicit compare first; else derive from the sparkline's last
  // two periods so structured KPIs always carry trend context.
  const delta =
    spec.compare || prevIdx >= 0
      ? formatDelta(value, prev)
      : spark && spark.length >= 2
        ? formatDelta(spark[spark.length - 1], spark[spark.length - 2])
        : null;

  // Conditional formatting: first matching rule colors the value.
  const ruleColor = resolveRuleColor(value, spec.rules);
  const paths = spark && spark.length >= 3 ? sparkPaths(spark) : null;

  return (
    <div className="relative flex h-full flex-col justify-center px-1">
      {paths ? (
        <svg
          aria-hidden
          viewBox="0 0 100 32"
          preserveAspectRatio="none"
          className="pointer-events-none absolute -bottom-3 -left-3 -right-3 h-[42%] max-h-14 w-auto min-w-full"
        >
          <path d={paths.area} fill="var(--chart-1)" opacity={0.08} />
          <path
            d={paths.line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={1.25}
            opacity={0.45}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
      <div
        className="relative text-4xl font-semibold leading-tight tracking-tight tabular-nums"
        style={ruleColor ? { color: ruleColor } : undefined}
      >
        {formatValue(value, spec.format)}
      </div>
      {delta ? (
        <div className="relative mt-1.5 flex items-center gap-1.5 text-[11px]">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
              delta.direction === "up" &&
                "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400",
              delta.direction === "down" && "bg-destructive/10 text-destructive",
              delta.direction === "flat" && "bg-muted text-muted-foreground",
            )}
          >
            {delta.direction === "up" ? (
              <TrendUp weight="bold" className="size-3" />
            ) : delta.direction === "down" ? (
              <TrendDown weight="bold" className="size-3" />
            ) : null}
            {delta.text}
          </span>
          <span className="text-muted-foreground">vs prev period</span>
        </div>
      ) : null}
    </div>
  );
}
