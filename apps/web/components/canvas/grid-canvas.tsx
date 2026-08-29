"use client";

/**
 * Lean 12-column CSS grid canvas with pointer-based drag + resize.
 * Human moves/resizes commit through the store with origin "human".
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

function snappedLayout(
  drag: DragState,
  cellW: number,
): TileLayout {
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

export function GridCanvas({ tiles }: { tiles: Tile[] }) {
  const moveTile = useDashboardStore((s) => s.moveTile);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

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

  const rectFor = (l: TileLayout) => ({
    left: l.x * (cellW + GAP),
    top: l.y * (ROW_H + GAP),
    width: l.w * cellW + (l.w - 1) * GAP,
    height: l.h * ROW_H + (l.h - 1) * GAP,
  });

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
        const snapped = snappedLayout(cur, cw);
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
          moveTile(
            { tileId: cur.tileId, ...snapped },
            { origin: "human", label: `${verb} “${title}”` },
          );
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [moveTile],
  );

  const rows = tiles.reduce((m, t) => Math.max(m, t.layout.y + t.layout.h), 0);
  const height = Math.max(rows, 4) * (ROW_H + GAP) + 160;

  const ghost =
    drag && cellW > 0 ? rectFor(snappedLayout(drag, cellW)) : null;

  return (
    <div
      ref={containerRef}
      data-testid="grid-canvas"
      className="relative w-full"
      style={{ height }}
    >
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
