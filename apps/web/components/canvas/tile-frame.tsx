"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChartBar,
  ChartBarHorizontal,
  ChartDonut,
  ChartLine,
  ChartLineUp,
  ChartPieSlice,
  ChartPolar,
  ChartScatter,
  Check,
  CopySimple,
  DotsSixVertical,
  Funnel,
  Gauge,
  GridNine,
  Note,
  PencilSimple,
  Sparkle,
  StackSimple,
  Table,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type {
  ChartQueryDims,
  ChartSpec,
  ChartType,
  Tile,
  TileType,
} from "@/lib/dashboard-store";
import { autoLayout, useDashboardStore } from "@/lib/dashboard-store";
import {
  detectTimeGrain,
  rewriteTimeGrain,
  type TimeGrain,
} from "@/lib/sql";
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

// ---------------------------------------------------------------------------
// Chart-type quick switcher (A10)
// ---------------------------------------------------------------------------

interface ChartTypeMeta {
  type: ChartType;
  label: string;
  icon: React.ComponentType<{ className?: string; weight?: "duotone" }>;
  /** Phosphor weight override (area = filled line chart). */
  duotone?: boolean;
}

const CHART_TYPE_META: Record<ChartType, ChartTypeMeta> = {
  line: { type: "line", label: "Line", icon: ChartLine },
  bar: { type: "bar", label: "Bar", icon: ChartBar },
  area: { type: "area", label: "Area", icon: ChartLine, duotone: true },
  hbar: { type: "hbar", label: "Horizontal bar", icon: ChartBarHorizontal },
  pie: { type: "pie", label: "Pie", icon: ChartPieSlice },
  donut: { type: "donut", label: "Donut", icon: ChartDonut },
  funnel: { type: "funnel", label: "Funnel", icon: Funnel },
  scatter: { type: "scatter", label: "Scatter", icon: ChartScatter },
  combo: { type: "combo", label: "Combo", icon: ChartLineUp },
  stacked100: { type: "stacked100", label: "100% stacked", icon: StackSimple },
  radar: { type: "radar", label: "Radar", icon: ChartPolar },
  heatmap: { type: "heatmap", label: "Heatmap", icon: GridNine },
};

/**
 * Chart types this spec can switch to without breaking its query shape:
 * cartesian swaps always work; part-to-whole needs a single series; scatter
 * and heatmap have structural requirements, so they are never offered as
 * targets (only kept when current).
 */
function sensibleChartTypes(spec: ChartSpec): ChartType[] {
  if (spec.chartType === "heatmap") return [];
  const structured = !("sql" in spec.query);
  const measureCount = structured
    ? (spec.query as ChartQueryDims).measures.length
    : Math.max(1, spec.seriesKeys?.length ?? 1);
  const single = measureCount <= 1;
  const types: ChartType[] = ["line", "bar", "area", "hbar"];
  if (single) types.push("donut", "pie", "funnel");
  else types.push("stacked100", "radar", "combo");
  if (!types.includes(spec.chartType)) types.unshift(spec.chartType);
  return types;
}

function ChartTypeSwitcher({ tile }: { tile: Tile }) {
  const updateTile = useDashboardStore((s) => s.updateTile);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape close the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const spec = tile.spec as ChartSpec;
  const types = sensibleChartTypes(spec);
  if (types.length < 2) return null;
  const CurrentIcon = CHART_TYPE_META[spec.chartType]?.icon ?? ChartBar;

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon-sm"
        aria-label={`Change chart type of ${tile.title}`}
        aria-expanded={open}
        className="text-muted-foreground"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({
            top: rect.bottom + 4,
            right: window.innerWidth - rect.right,
          });
          setOpen((v) => !v);
        }}
      >
        <CurrentIcon className="size-3.5" />
      </Button>
      {open && anchor
        ? // Portal: tiles carry a transform (enter animation), which would
          // turn them into the containing block for position:fixed.
          createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Chart type"
              className="fixed z-50 flex min-w-36 flex-col rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ top: anchor.top, right: anchor.right }}
              onPointerDown={(e) => e.stopPropagation()}
            >
          {types.map((t) => {
            const meta: ChartTypeMeta | undefined = CHART_TYPE_META[t];
            if (!meta) return null;
            const Icon = meta.icon;
            const active = t === spec.chartType;
            return (
              <button
                key={t}
                type="button"
                role="menuitem"
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  if (active) return;
                  updateTile(
                    tile.id,
                    { spec: { chartType: t } },
                    {
                      origin: "human",
                      label: `Switched “${tile.title}” to ${meta.label.toLowerCase()}`,
                    },
                  );
                }}
              >
                <Icon
                  className="size-3.5 shrink-0"
                  {...(meta.duotone ? { weight: "duotone" as const } : {})}
                />
                <span className="flex-1">{meta.label}</span>
                {active ? <Check className="size-3 shrink-0" /> : null}
              </button>
            );
          })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}


// ---------------------------------------------------------------------------
// Temporal granularity (month / quarter / week)
// ---------------------------------------------------------------------------

const GRAIN_LABEL: Record<TimeGrain, string> = {
  month: "Month",
  quarter: "Quarter",
  week: "Week",
};

/**
 * Shown only when the chart's SQL bins on a recognizable strftime month
 * pattern (or a week/quarter form this control previously wrote): the
 * grain swap is then a lossless rewrite through updateTile (origin
 * "human" — undoable, attributed, conflict-tracked).
 */
function GranularitySelect({ tile }: { tile: Tile }) {
  const updateTile = useDashboardStore((s) => s.updateTile);
  const spec = tile.spec as ChartSpec;
  const sql = "sql" in spec.query ? spec.query.sql : null;
  const grain = sql ? detectTimeGrain(sql) : null;
  if (!sql || !grain) return null;
  return (
    <select
      value={grain}
      aria-label={`Time granularity of ${tile.title}`}
      className="h-6 cursor-pointer rounded-md border border-transparent bg-transparent pr-0.5 text-[10px] font-medium text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-visible:border-ring"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value as TimeGrain;
        if (next === grain) return;
        updateTile(
          tile.id,
          { spec: { query: { sql: rewriteTimeGrain(sql, next) } } },
          {
            origin: "human",
            label: `Set \u201c${tile.title}\u201d granularity to ${GRAIN_LABEL[next].toLowerCase()}`,
          },
        );
      }}
    >
      {(Object.keys(GRAIN_LABEL) as TimeGrain[]).map((g) => (
        <option key={g} value={g}>
          {GRAIN_LABEL[g]}
        </option>
      ))}
    </select>
  );
}

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

/**
 * Memoized so selection/hover re-renders of the frame do not re-render the
 * chart: a recharts re-render between pointerdown and mouseup recreates the
 * SVG nodes and the browser then suppresses the click (breaks click-to-
 * cross-filter on freshly selected tiles).
 */
const TileBody = memo(function TileBody({ tile }: { tile: Tile }) {
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
});

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
  const addTile = useDashboardStore((s) => s.addTile);
  const updateTile = useDashboardStore((s) => s.updateTile);
  const undo = useDashboardStore((s) => s.undo);
  const clearAgentPulse = useDashboardStore((s) => s.clearAgentPulse);
  const pulsing = useRecentPulse(pulseAt);
  const Icon = TYPE_ICON[tile.type];
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(tile.title);

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

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    const doc = useDashboardStore.getState().doc;
    const layout = autoLayout(doc.tiles, {
      w: tile.layout.w,
      h: tile.layout.h,
    });
    addTile(
      {
        type: tile.type,
        title: `${tile.title} copy`,
        spec: structuredClone(tile.spec),
        layout,
      } as Parameters<typeof addTile>[0],
      { origin: "human", label: `Duplicated “${tile.title}”` },
    );
  };

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next.length === 0 || next === tile.title) return;
    updateTile(
      tile.id,
      { title: next },
      { origin: "human", label: `Renamed tile to “${next}”` },
    );
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
        {renaming ? (
          <input
            autoFocus
            value={draft}
            aria-label="Tile title"
            className="w-full min-w-0 border-b border-ring/60 bg-transparent text-xs font-medium text-foreground outline-none"
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commitRename}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : (
          <>
            <span className="truncate text-xs font-medium text-muted-foreground">
              {tile.title}
            </span>
            <button
              type="button"
              aria-label={`Rename ${tile.title}`}
              className="shrink-0 rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 hover:text-foreground group-hover/tile:opacity-100 group-hover/tile:delay-150"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setDraft(tile.title);
                setRenaming(true);
              }}
            >
              <PencilSimple className="size-3" />
            </button>
          </>
        )}
        {pulsing ? (
          <span className="chip-fading ml-1 inline-flex items-center gap-0.5 rounded-full border border-agent/30 bg-agent/15 px-1.5 py-px text-[10px] font-semibold text-agent">
            <Sparkle weight="fill" className="size-2.5" />
            AI
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100 group-hover/tile:delay-150">
          {tile.type === "chart" ? <GranularitySelect tile={tile} /> : null}
          {tile.type === "chart" ? <ChartTypeSwitcher tile={tile} /> : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Duplicate ${tile.title}`}
            className="text-muted-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleDuplicate}
          >
            <CopySimple className="size-3.5" />
          </Button>
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
