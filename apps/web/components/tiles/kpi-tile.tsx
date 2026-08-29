"use client";

import { TrendDown, TrendUp } from "@phosphor-icons/react";
import type { KpiSpec, Tile } from "@/lib/dashboard-store";
import { useTileData } from "@/lib/use-tile-data";
import { formatDelta, formatValue } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TileError } from "./tile-error";

function firstNumber(v: unknown): number | null {
  const n =
    typeof v === "string" || typeof v === "bigint" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function KpiTile({ tile }: { tile: Tile }) {
  const spec = tile.spec as KpiSpec;
  const { loading, error, result } = useTileData(tile);

  if (error) return <TileError message={error} />;
  if (loading || !result) {
    return (
      <div className="flex h-full flex-col justify-center gap-2 px-1">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  const row = result.rows[0] ?? [];
  const nameIdx = (n: string) =>
    result.columns.findIndex((c) => c.name.toLowerCase() === n);
  const valueIdx = nameIdx("value") >= 0 ? nameIdx("value") : 0;
  const prevIdx = nameIdx("prev");
  const value = firstNumber(row[valueIdx]);
  const prev =
    prevIdx >= 0 ? firstNumber(row[prevIdx]) : firstNumber(row[valueIdx + 1]);
  const delta = spec.compare || prevIdx >= 0 ? formatDelta(value, prev) : null;

  return (
    <div className="flex h-full flex-col justify-center px-1">
      <div className="text-3xl font-semibold leading-tight tracking-tight tabular-nums">
        {formatValue(value, spec.format)}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-xs font-medium",
            delta.direction === "up" && "text-emerald-500 dark:text-emerald-400",
            delta.direction === "down" && "text-red-500 dark:text-red-400",
            delta.direction === "flat" && "text-muted-foreground",
          )}
        >
          {delta.direction === "up" ? (
            <TrendUp weight="bold" className="size-3.5" />
          ) : delta.direction === "down" ? (
            <TrendDown weight="bold" className="size-3.5" />
          ) : null}
          <span>{delta.text}</span>
          <span className="font-normal text-muted-foreground">vs prev period</span>
        </div>
      ) : null}
    </div>
  );
}
