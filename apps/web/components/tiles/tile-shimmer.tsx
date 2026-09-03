"use client";

import { cn } from "@/lib/utils";

/**
 * Per-tile loading shimmer: a faint chart silhouette instead of a flat
 * skeleton block, so loading tiles read as "chart coming".
 */
export function TileShimmer({ kind = "chart" }: { kind?: "chart" | "kpi" | "table" }) {
  if (kind === "kpi") {
    return (
      <div className="flex h-full flex-col justify-end gap-2">
        <div className="h-8 w-32 animate-pulse rounded-md bg-surface-2" />
        <div className="h-3.5 w-24 animate-pulse rounded-md bg-surface-2/70" />
      </div>
    );
  }
  if (kind === "table") {
    return (
      <div className="flex h-full flex-col gap-1.5 overflow-hidden px-4 py-1">
        <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
        {[0.9, 0.75, 0.85, 0.7, 0.8].map((w, i) => (
          <div
            key={i}
            className="h-3.5 animate-pulse rounded bg-muted/60"
            style={{ width: `${w * 100}%`, animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    );
  }
  const bars = [0.45, 0.7, 0.55, 0.85, 0.65, 0.95, 0.75, 0.6];
  return (
    <div
      className="flex h-full w-full items-end gap-[6%] px-2 pb-2"
      aria-busy="true"
      aria-label="Loading chart"
    >
      {bars.map((h, i) => (
        <div
          key={i}
          className={cn("flex-1 animate-pulse rounded-t-sm bg-muted")}
          style={{ height: `${h * 80}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}
