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
  Funnel,
  GridNine,
  Note,
  PencilSimple,
  StackSimple,
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
import { KpiTile, tintClass } from "@/components/tiles/kpi-tile";
import { TileProposalStrip } from "@/components/presence/tile-proposal";
import { ChartTile } from "@/components/tiles/chart-tile";
import { TableTile } from "@/components/tiles/table-tile";
import { MarkdownTile } from "@/components/tiles/markdown-tile";
import { tileSubline } from "@/components/tiles/tile-subline";

/** Body padding per tile type (design: tables bleed to the card edges). */
const BODY_PADDING: Record<TileType, string> = {
  kpi: "px-4 pb-3.5 pt-0",
  chart: "px-3 pb-3 pt-1",
  table: "px-0 pb-2 pt-1",
  markdown: "px-4 pb-3.5 pt-1",
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
        className="rounded-lg text-faint hover:bg-surface-2 hover:text-foreground"
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
              className="fixed z-50 flex min-w-36 flex-col rounded-[10px] border border-line bg-popover p-1 text-popover-foreground shadow-card"
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
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px]",
                  active
                    ? "bg-accent-soft text-accent-strong"
                    : "text-foreground hover:bg-surface-2",
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
      className="h-6 cursor-pointer rounded-lg border border-transparent bg-transparent px-1 text-[12px] font-medium text-faint outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:border-accent-mid"
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
  /** Mobile review mode keeps tile actions but disables spatial editing. */
  layoutInteractive?: boolean;
}

export const TileFrame = memo(function TileFrame({
  tile,
  dragging,
  onDragHandleDown,
  onResizeHandleDown,
  layoutInteractive = true,
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
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(tile.title);
  const isKpi = tile.type === "kpi";
  // Position within the page's KPI band drives the design's field sequence.
  const kpiPosition = useDashboardStore((s) =>
    s.doc.tiles.filter((t) => t.type === "kpi").findIndex((t) => t.id === tile.id),
  );
  const subline = tileSubline(tile);

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
        "tile-enter group/tile relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-card text-card-foreground shadow-card transition-[box-shadow,border-color] duration-200",
        // Design: a tinted KPI is a flat color field — transparent border,
        // no shadow (the .kpi-tint-* classes carry both).
        isKpi && tintClass(kpiPosition),
        selected && "border-accent-mid",
        dragging && "opacity-95",
      )}
      style={
        dragging
          ? { boxShadow: "0 24px 48px -16px rgba(22,27,46,.35)" }
          : selected
            ? { boxShadow: "0 0 0 3px var(--accent-soft), var(--shadow-card)" }
            : undefined
      }
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
        className={cn(
          "flex shrink-0 select-none items-start gap-2 px-4 pb-1 pt-3.5",
          layoutInteractive && "cursor-grab touch-none active:cursor-grabbing",
        )}
        // The drag handler stops propagation, so the header selects the tile
        // itself: pressing anywhere on a tile (header or body) selects it.
        onPointerDown={
          layoutInteractive
            ? (e) => {
                selectTile(tile.id);
                onDragHandleDown(e);
              }
            : undefined
        }
      >
        {/* Design header: 14px/500 title over a 12px faint sub-line built
            from the real spec (measure, dataset, comparison, filters). */}
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="flex min-w-0 items-center gap-1">
            {renaming ? (
              <input
                autoFocus
                value={draft}
                aria-label="Tile title"
                className="w-full min-w-0 border-b border-accent-mid bg-transparent text-[14px] font-medium leading-tight text-foreground outline-none"
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
                <span
                  className={cn(
                    "text-[14px] font-medium leading-tight",
                    // A KPI title is short but often two words wide at 3
                    // columns: wrap it rather than clipping the metric name.
                    // Titles wrap to two lines rather than clipping: a tile
                    // named for what it shows must stay readable at 3 cols.
                    "line-clamp-2 break-words",
                    isKpi ? "text-muted-foreground" : "text-foreground",
                  )}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setDraft(tile.title);
                    setRenaming(true);
                  }}
                >
                  {tile.title}
                </span>
                <button
                  type="button"
                  aria-label={`Rename ${tile.title}`}
                  className={cn(
                    "shrink-0 rounded p-0.5 text-faint transition-opacity duration-150 hover:text-foreground sm:opacity-0 sm:group-hover/tile:opacity-100 sm:group-hover/tile:delay-150 sm:group-focus-within/tile:opacity-100",
                    // The stacked review layout is for reading, not editing:
                    // its narrow tiles give the title the whole header.
                    layoutInteractive ? "opacity-100" : "hidden sm:block",
                  )}
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
          </div>
          {subline ? (
            <span
              className="truncate text-[12px] leading-tight text-faint"
              title={subline}
            >
              {subline}
            </span>
          ) : null}
        </div>
        {pulsing ? (
          // Design `agent` pill. The screen-reader prefix keeps the plain
          // "AI" attribution readable (and asserted) while the visible chip
          // uses the design's word.
          <span className="chip-fading mt-px shrink-0 rounded-full bg-accent-soft px-[7px] py-[2px] text-[11.5px] font-medium leading-[1.35] text-accent-strong">
            <span className="sr-only">AI </span>agent
          </span>
        ) : null}
        <div
          className={cn(
            "-mr-1 -mt-1 flex shrink-0 items-center gap-0.5 transition-opacity duration-150 sm:opacity-0 sm:group-hover/tile:opacity-100 sm:group-hover/tile:delay-150 sm:group-focus-within/tile:opacity-100",
            layoutInteractive ? "opacity-100" : "hidden sm:flex",
          )}
        >
          {tile.type === "chart" ? <GranularitySelect tile={tile} /> : null}
          {tile.type === "chart" ? <ChartTypeSwitcher tile={tile} /> : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Duplicate ${tile.title}`}
            className="rounded-lg text-faint hover:bg-surface-2 hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleDuplicate}
          >
            <CopySimple className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${tile.title}`}
            className="rounded-lg text-faint hover:bg-surface-2 hover:text-danger"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleRemove}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className={cn("min-h-0 flex-1", BODY_PADDING[tile.type])}>
        <TileBody tile={tile} />
      </div>
      <TileProposalStrip tileId={tile.id} />
      {tile.annotations.length > 0 ? (
        <div className="flex flex-wrap gap-1 border-t border-line px-4 py-1.5">
          {tile.annotations.map((a) => (
            <span
              key={a.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-warn-soft px-2 py-[2px] text-[11.5px] font-medium text-warn"
            >
              <Note weight="fill" className="size-2.5 shrink-0" />
              <span className="truncate">{a.text}</span>
            </span>
          ))}
        </div>
      ) : null}
      {layoutInteractive ? (
        <div
          className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize touch-none opacity-0 transition-opacity group-hover/tile:opacity-100"
          onPointerDown={onResizeHandleDown}
          aria-label="Resize tile"
        >
          <svg viewBox="0 0 10 10" className="size-2.5 translate-x-0.5 translate-y-0.5 text-accent-strong">
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="9" y1="5.5" x2="5.5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      ) : null}
    </div>
  );
});
