"use client";

/**
 * Lean 12-column CSS grid canvas with pointer-based drag + resize.
 * Human moves/resizes commit through the store with origin "human".
 *
 * U4 additions (visual-only, single-commit):
 * - Gravity compaction: a MOVED tile packs upward into free space at drop
 *   (and the drag ghost previews the packed landing spot). The pack rides
 *   inside the one existing moveTile commit, so undo stays one step.
 * - Alignment guides: full-canvas hairlines light up while dragging when
 *   the snapped preview shares an edge line with any other tile.
 * U5: entrance stagger — each newly mounted tile gets a 40ms-cascade
 *   animation delay via the --tile-enter-delay CSS variable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Tile, TileLayout } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { TileFrame } from "./tile-frame";

const COLS = 12;
const ROW_H = 56;
const GAP = 12;
const MIN_W = 2;
const MIN_H = 2;
const STAGGER_MS = 40;
const STAGGER_CAP_MS = 360;

interface DragState {
  tileId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  origin: TileLayout;
  /** live pixel delta for smooth preview */
  dx: number;
  dy: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function snappedLayout(drag: DragState, cellW: number): TileLayout {
  const dCols = Math.round(drag.dx / (cellW + GAP));
  const dRows = Math.round(drag.dy / (ROW_H + GAP));
  const { x, y, w, h } = drag.origin;
  if (drag.mode === "move") {
    return {
      x: clamp(x + dCols, 0, COLS - w),
      y: Math.max(0, y + dRows),
      w,
      h,
    };
  }
  return {
    x,
    y,
    w: clamp(w + dCols, MIN_W, COLS - x),
    h: Math.max(MIN_H, h + dRows),
  };
}

function overlaps(a: TileLayout, b: TileLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Gravity: pull `layout` upward row by row while the space above is free.
 * If the position already overlaps another tile (deliberate overlap drop),
 * it is returned unchanged — never "fix" what the user chose.
 */
function gravitate(layout: TileLayout, others: TileLayout[]): TileLayout {
  if (others.some((o) => overlaps(layout, o))) return layout;
  let y = layout.y;
  while (y > 0 && !others.some((o) => overlaps({ ...layout, y: y - 1 }, o))) {
    y -= 1;
  }
  return y === layout.y ? layout : { ...layout, y };
}

interface Guides {
  v: number[];
  h: number[];
}

/** Edge lines (px) the snapped preview shares with any other tile. */
function alignmentGuides(
  ghost: TileLayout,
  others: Tile[],
  colPx: (col: number) => number,
  rowPx: (row: number) => number,
): Guides {
  const v = new Set<number>();
  const h = new Set<number>();
  for (const t of others) {
    const o = t.layout;
    if (o.x === ghost.x) v.add(colPx(ghost.x));
    if (o.x + o.w === ghost.x + ghost.w) v.add(colPx(ghost.x + ghost.w) - GAP);
    if (o.y === ghost.y) h.add(rowPx(ghost.y));
    if (o.y + o.h === ghost.y + ghost.h) h.add(rowPx(ghost.y + ghost.h) - GAP);
  }
  return { v: [...v], h: [...h] };
}

export function GridCanvas({ tiles }: { tiles: Tile[] }) {
  const moveTile = useDashboardStore((s) => s.moveTile);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // U5 entrance stagger: delay assigned once per tile id, per mount batch.
  const enterDelayRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cellW = width > 0 ? (width - GAP * (COLS - 1)) / COLS : 0;
  const colPx = (col: number) => col * (cellW + GAP);
  const rowPx = (row: number) => row * (ROW_H + GAP);

  const rectFor = (l: TileLayout) => ({
    left: colPx(l.x),
    top: rowPx(l.y),
    width: l.w * cellW + (l.w - 1) * GAP,
    height: l.h * ROW_H + (l.h - 1) * GAP,
  });

  // Assign stagger delays to tiles first seen in this render batch.
  {
    const delays = enterDelayRef.current;
    let batchIndex = 0;
    for (const t of tiles) {
      if (!delays.has(t.id)) {
        delays.set(t.id, Math.min(batchIndex * STAGGER_MS, STAGGER_CAP_MS));
        batchIndex += 1;
      }
    }
  }

  const packedDrop = useCallback((cur: DragState, cw: number): TileLayout => {
    const snapped = snappedLayout(cur, cw);
    if (cur.mode !== "move") return snapped;
    const others = useDashboardStore
      .getState()
      .doc.tiles.filter((t) => t.id !== cur.tileId)
      .map((t) => t.layout);
    return gravitate(snapped, others);
  }, []);

  const startDrag = useCallback(
    (tile: Tile, mode: "move" | "resize") => (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const state: DragState = {
        tileId: tile.id,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        origin: tile.layout,
        dx: 0,
        dy: 0,
      };
      dragRef.current = state;
      setDrag(state);

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        const next = {
          ...cur,
          dx: ev.clientX - cur.startX,
          dy: ev.clientY - cur.startY,
        };
        dragRef.current = next;
        setDrag(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const cur = dragRef.current;
        dragRef.current = null;
        setDrag(null);
        if (!cur) return;
        const el = containerRef.current;
        const w = el?.getBoundingClientRect().width ?? 0;
        const cw = w > 0 ? (w - GAP * (COLS - 1)) / COLS : 0;
        if (cw <= 0) return;
        const snapped = packedDrop(cur, cw);
        const o = cur.origin;
        if (
          snapped.x !== o.x ||
          snapped.y !== o.y ||
          snapped.w !== o.w ||
          snapped.h !== o.h
        ) {
          const verb = cur.mode === "move" ? "Moved" : "Resized";
          const title =
            useDashboardStore
              .getState()
              .doc.tiles.find((t) => t.id === cur.tileId)?.title ?? "tile";
          moveTile(cur.tileId, snapped, {
            origin: "human",
            label: `${verb} “${title}”`,
          });
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [moveTile, packedDrop],
  );

  const rows = tiles.reduce((m, t) => Math.max(m, t.layout.y + t.layout.h), 0);
  // L9: the canvas hugs its content — a slim landing strip below the last
  // row (one gap + a little air), not a 160px void. The canvas ROOT
  // stretches to the viewport via CSS, so drops below still work.
  const height = Math.max(rows, 4) * (ROW_H + GAP) + 24;

  const ghostLayout = drag && cellW > 0 ? packedDrop(drag, cellW) : null;
  const ghost = ghostLayout ? rectFor(ghostLayout) : null;
  const guides =
    drag && ghostLayout
      ? alignmentGuides(
          ghostLayout,
          tiles.filter((t) => t.id !== drag.tileId),
          colPx,
          rowPx,
        )
      : null;

  return (
    <div
      ref={containerRef}
      data-testid="grid-canvas"
      className="relative w-full"
      style={{ height }}
    >
      {guides
        ? guides.v.map((x) => (
            <div
              key={`v${x}`}
              data-testid="snap-guide"
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-ring/60"
              style={{ left: x }}
            />
          ))
        : null}
      {guides
        ? guides.h.map((y) => (
            <div
              key={`h${y}`}
              data-testid="snap-guide"
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-30 h-px bg-ring/60"
              style={{ top: y }}
            />
          ))
        : null}
      {ghost ? (
        <div
          className="pointer-events-none absolute z-40 rounded-xl border-2 border-dashed border-ring/60 bg-accent/20 transition-none"
          style={ghost}
        />
      ) : null}
      {cellW > 0
        ? tiles.map((tile) => {
            const isDragging = drag?.tileId === tile.id;
            const rect = rectFor(tile.layout);
            const style: React.CSSProperties = {
              ...rect,
              transform: isDragging
                ? `translate(${drag.dx}px, ${drag.dy}px)`
                : undefined,
              transition: isDragging
                ? "none"
                : "left 0.25s cubic-bezier(0.22,1,0.36,1), top 0.25s cubic-bezier(0.22,1,0.36,1), width 0.25s cubic-bezier(0.22,1,0.36,1), height 0.25s cubic-bezier(0.22,1,0.36,1)",
              zIndex: isDragging ? 50 : undefined,
              ["--tile-enter-delay" as string]: `${
                enterDelayRef.current.get(tile.id) ?? 0
              }ms`,
            };
            return (
              <div key={tile.id} className="absolute" style={style}>
                <TileFrame
                  tile={tile}
                  dragging={!!isDragging}
                  onDragHandleDown={startDrag(tile, "move")}
                  onResizeHandleDown={startDrag(tile, "resize")}
                />
              </div>
            );
          })
        : null}
    </div>
  );
}
