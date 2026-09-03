"use client";

import type { KpiSpec, Tile } from "@/lib/dashboard-store";
import { useKpiSparkline, useTileData } from "@/lib/use-tile-data";
import { formatDelta, formatValue, resolveRuleColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TileError } from "./tile-error";
import { TileShimmer } from "./tile-shimmer";

/**
 * Tint by POSITION in the page's KPI band — mint, lavender, plain surface,
 * peach — so a row of KPIs repeats the design's field sequence instead of a
 * hash-shuffled one. Index 2 is intentionally untinted (plain card).
 */
export const KPI_TINTS = ["mint", "lav", "none", "peach"] as const;

export function tintClass(position: number): string | null {
  const tint = KPI_TINTS[position % KPI_TINTS.length];
  return tint === "none" ? null : `kpi-tint-${tint}`;
}

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

/** Delta ink: up is --ok, down is --danger, flat stays muted (design). */
const DELTA_INK: Record<"up" | "down" | "flat", string> = {
  up: "var(--ok)",
  down: "var(--danger)",
  flat: "var(--ink-muted)",
};

/**
 * KPI tile (design): bottom-aligned value at clamp(22px,15cqi,34px)/600/-.03em
 * over a restrained delta row — colored delta + muted comparison note. The
 * trailing-period sparkline stays as a faint underlay when the measure has
 * temporal history (graceful skip otherwise). The card tint itself is
 * applied by TileFrame (.kpi-tint-*), matching the design's flat fields.
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
  const comparisonNote =
    spec.compare || prevIdx >= 0 ? "vs previous period" : "vs prior period";

  // Conditional formatting: first matching rule colors the value.
  const ruleColor = resolveRuleColor(value, spec.rules);
  const paths = spark && spark.length >= 3 ? sparkPaths(spark) : null;

  return (
    // container-type: the value scales with the TILE width (15cqi), exactly
    // as the design specifies.
    <div className="relative flex h-full flex-col justify-end [container-type:inline-size]">
      {paths ? (
        // Bottom-aligned clipped sparkline — a quiet underlay capped at 40%
        // of the card, never competing with the value above it.
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-3 -left-4 -right-4 h-[40%] max-h-14 overflow-hidden"
        >
          <svg
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            className="h-full w-full"
          >
            <path d={paths.area} fill="var(--chart-1)" opacity={0.07} />
            <path
              d={paths.line}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={1.25}
              opacity={0.35}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      ) : null}
      <div
        className={cn(
          "relative whitespace-nowrap text-[clamp(22px,15cqi,34px)] font-semibold leading-none tracking-[-0.03em] tabular-nums",
        )}
        style={ruleColor ? { color: ruleColor } : undefined}
      >
        {formatValue(value, spec.format)}
      </div>
      {/* Every KPI keeps this row so a KPI band shares one value baseline and
          one delta baseline (design). Without a comparison it says so. */}
      <div className="relative mt-2 flex h-[18px] items-baseline gap-1.5 text-[13px] leading-tight">
        {delta ? (
          <>
            <span
              className="font-medium tabular-nums"
              style={{ color: DELTA_INK[delta.direction] }}
            >
              {delta.text}
            </span>
            <span className="truncate text-muted-foreground">
              {comparisonNote}
            </span>
          </>
        ) : (
          <span className="truncate text-muted-foreground">
            no comparison period
          </span>
        )}
      </div>
    </div>
  );
}
