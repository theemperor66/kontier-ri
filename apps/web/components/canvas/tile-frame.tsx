"use client";

import { memo, useEffect, useState } from "react";
import {
  ChartBar,
  DotsSixVertical,
  Gauge,
  Note,
  Sparkle,
  Table,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Tile, TileType } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KpiTile } from "@/components/tiles/kpi-tile";
import { ChartTile } from "@/components/tiles/chart-tile";
import { TableTile } from "@/components/tiles/table-tile";
import { MarkdownTile } from "@/components/tiles/markdown-tile";

const TYPE_ICON: Record<TileType, React.ComponentType<{ className?: string }>> = {
  kpi: Gauge,
  chart: ChartBar,
  table: Table,
  markdown: Note,
};

const PULSE_MS = 6000;

/** True while `timestamp` is within the pulse window; auto-expires. */
function useRecentPulse(timestamp: number | undefined): boolean {
  const [, force] = useState(0);
  const active = timestamp != null && Date.now() - timestamp < PULSE_MS;
  useEffect(() => {
    if (!active || timestamp == null) return;
    const t = setTimeout(
      () => force((n) => n + 1),
      PULSE_MS - (Date.now() - timestamp) + 50,
    );
    return () => clearTimeout(t);
  }, [timestamp, active]);
  return active;
}

function TileBody({ tile }: { tile: Tile }) {
  switch (tile.type) {
    case "kpi":
      return <KpiTile tile={tile} />;
    case "chart":
      return <ChartTile tile={tile} />;
    case "table":
      return <TableTile tile={tile} />;
    case "markdown":
      return <MarkdownTile tile={tile} />;
  }
}

export interface TileFrameProps {
  tile: Tile;
  dragging: boolean;
  onDragHandleDown: (e: React.PointerEvent) => void;
  onResizeHandleDown: (e: React.PointerEvent) => void;
}

export const TileFrame = memo(function TileFrame({
  tile,
  dragging,
  onDragHandleDown,
  onResizeHandleDown,
}: TileFrameProps) {
  const selected = useDashboardStore((s) => s.selectedTileId === tile.id);
  const pulseAt = useDashboardStore((s) => s.agentPulse[tile.id]);
  const selectTile = useDashboardStore((s) => s.selectTile);
  const setHoveredTile = useDashboardStore((s) => s.setHoveredTile);
  const removeTile = useDashboardStore((s) => s.removeTile);
  const undo = useDashboardStore((s) => s.undo);
  const clearAgentPulse = useDashboardStore((s) => s.clearAgentPulse);
  const pulsing = useRecentPulse(pulseAt);
  const Icon = TYPE_ICON[tile.type];

  // Acknowledge the glow once it finishes so the next agent edit re-triggers.
  useEffect(() => {
    if (!pulsing && pulseAt != null) clearAgentPulse(tile.id);
  }, [pulsing, pulseAt, clearAgentPulse, tile.id]);

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeTile(tile.id, { origin: "human", label: `Removed “${tile.title}”` });
    toast(`Removed “${tile.title}”`, {
      action: {
        label: "Undo",
        onClick: () => undo(),
      },
      duration: 10000,
    });
  };

  return (
    <div
      data-testid={`tile-${tile.id}`}
      data-tile-type={tile.type}
      className={cn(
        "tile-enter group/tile relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow",
        selected && "ring-2 ring-ring/70",
        dragging && "opacity-90 shadow-2xl",
      )}
      onPointerDown={() => selectTile(tile.id)}
      onMouseEnter={() => setHoveredTile(tile.id)}
      onMouseLeave={() => setHoveredTile(null)}
    >
      {pulsing ? (
        <div
          key={`pulse-${pulseAt}`}
          aria-hidden
          className="agent-touched pointer-events-none absolute inset-0 z-20 rounded-xl border border-transparent"
        />
      ) : null}
      <div
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1.5 px-3 pb-1 pt-2.5 active:cursor-grabbing"
        onPointerDown={onDragHandleDown}
      >
        <DotsSixVertical className="size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/tile:opacity-100" />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-muted-foreground">
          {tile.title}
        </span>
        {pulsing ? (
          <span className="chip-fading ml-1 inline-flex items-center gap-0.5 rounded-full border border-violet-500/30 bg-violet-500/15 px-1.5 py-px text-[10px] font-semibold text-violet-500 dark:text-violet-300">
            <Sparkle weight="fill" className="size-2.5" />
            AI
          </span>
        ) : null}
        <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover/tile:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${tile.title}`}
            className="text-muted-foreground hover:text-destructive"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleRemove}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3 pt-1">
        <TileBody tile={tile} />
      </div>
      {tile.annotations.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-t border-border/60 px-3 py-1.5">
          {tile.annotations.map((a) => (
            <span
              key={a.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300"
            >
              <Note weight="fill" className="size-2.5 shrink-0" />
              <span className="truncate">{a.text}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div
        className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize touch-none opacity-0 transition-opacity group-hover/tile:opacity-100"
        onPointerDown={onResizeHandleDown}
        aria-label="Resize tile"
      >
        <svg viewBox="0 0 8 8" className="size-2.5 translate-x-0.5 translate-y-0.5 text-muted-foreground/60">
          <path d="M7 1v6H1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
});
