"use client";

/**
 * Mark context menu: right-click on a bar / slice / point / heatmap cell /
 * table cell. Every doc mutation goes through the existing command layer
 * (setTileFilters / addAnnotation, origin "human") so it stays undoable,
 * attributed and conflict-tracked.
 *
 * Rendered in a PORTAL (tiles carry transforms from their enter animation,
 * which would make them the containing block for position:fixed) with the
 * same scroll-pin as the chrome Menu primitive: Chrome natively scroll-
 * jumps the page when a menu item is mouse-clicked.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChatCenteredText, Crosshair, Funnel, Prohibit } from "@phosphor-icons/react";
import type { Tile, TileSpec } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { MenuItem, MenuSeparator } from "@/components/chrome/menu";
import type { SeriesClick } from "./common";
import { toCrossFilterValue } from "./common";

export interface MarkMenuTarget {
  /** Column the mark encodes (chart x dim / table column). */
  column: string;
  value: unknown;
  /** Viewport coordinates of the right-click. */
  x: number;
  y: number;
}

type FilterableSpec = Extract<TileSpec, { filters?: unknown }>;

const MENU_WIDTH = 232;

function shortValue(v: unknown): string {
  const s = String(v ?? "");
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}

export function MarkMenu({
  tile,
  target,
  values,
  onClose,
  onCrossFilter,
}: {
  tile: Tile;
  target: MarkMenuTarget;
  /** Distinct values currently visible for target.column (drives Exclude). */
  values: readonly unknown[];
  onClose: () => void;
  onCrossFilter: (click: SeriesClick) => void;
}) {
  const setTileFilters = useDashboardStore((s) => s.setTileFilters);
  const addAnnotation = useDashboardStore((s) => s.addAnnotation);
  const panelRef = useRef<HTMLDivElement>(null);
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState("");
  /** Scroll position at open; restored for a few frames around close. */
  const openScrollRef = useRef({ x: 0, y: 0 });

  const close = () => {
    const want = openScrollRef.current;
    let frames = 0;
    const pin = () => {
      if (window.scrollX !== want.x || window.scrollY !== want.y) {
        window.scrollTo(want.x, want.y);
      }
      if (++frames < 6) requestAnimationFrame(pin);
    };
    pin();
    onClose();
  };

  useEffect(() => {
    openScrollRef.current = { x: window.scrollX, y: window.scrollY };
    const onDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const { column, value } = target;
  const others = useMemo(() => {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const v of values) {
      if (v == null) continue;
      const s = String(v);
      if (s === String(value) || seen.has(s)) continue;
      seen.add(s);
      out.push(toCrossFilterValue(v));
    }
    return out;
  }, [values, value]);
  // FilterOp has no "neq": Exclude keeps the complement of the visible
  // values via op "in" — same frozen grammar, honest semantics. Unbounded
  // domains (huge tables) get the item disabled instead of a 100+ IN list.
  const canExclude = others.length > 0 && others.length <= 100;

  const baseFilters = () => {
    const spec = tile.spec as FilterableSpec;
    return (spec.filters ?? []).filter((f) => f.column !== column);
  };

  const keepOnly = () => {
    setTileFilters(
      tile.id,
      [...baseFilters(), { column, op: "eq", value: toCrossFilterValue(value) }],
      {
        origin: "human",
        label: `Kept only ${column} = ${shortValue(value)} on \u201c${tile.title}\u201d`,
      },
    );
  };

  const exclude = () => {
    setTileFilters(
      tile.id,
      [...baseFilters(), { column, op: "in", value: others }],
      {
        origin: "human",
        label: `Excluded ${column} = ${shortValue(value)} on \u201c${tile.title}\u201d`,
      },
    );
  };

  const commitNote = () => {
    const text = note.trim();
    if (text.length > 0) {
      const anchorX = typeof value === "number" ? value : String(value);
      addAnnotation(tile.id, text, { x: anchorX }, {
        origin: "human",
        label: `Annotated \u201c${tile.title}\u201d at ${shortValue(value)}`,
      });
    }
    close();
  };

  const left = Math.min(target.x, window.innerWidth - MENU_WIDTH - 12);
  const top = Math.min(target.y, window.innerHeight - 220);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label="Mark actions"
      data-testid="mark-menu"
      className="menu-enter fixed z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style={{ top, left, width: MENU_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="truncate px-2.5 pb-1 pt-1.5 text-[11px] text-muted-foreground">
        {column} · <span className="font-medium text-foreground">{shortValue(value)}</span>
      </div>
      {annotating ? (
        <div className="px-1.5 pb-1">
          <input
            autoFocus
            value={note}
            placeholder="Annotation…"
            aria-label={`Annotation at ${shortValue(value)}`}
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNote();
              if (e.key === "Escape") close();
            }}
          />
        </div>
      ) : (
        <>
          <MenuItem
            icon={<Funnel />}
            className="py-1.5 text-xs"
            onSelect={() => {
              keepOnly();
              close();
            }}
          >
            Keep only {shortValue(value)}
          </MenuItem>
          <MenuItem
            icon={<Prohibit />}
            className="py-1.5 text-xs"
            disabled={!canExclude}
            title={canExclude ? undefined : "Too many other values to keep"}
            onSelect={() => {
              exclude();
              close();
            }}
          >
            Exclude {shortValue(value)}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Crosshair />}
            className="py-1.5 text-xs"
            onSelect={() => {
              onCrossFilter({ column, value });
              close();
            }}
          >
            Cross-filter by this
          </MenuItem>
          <MenuItem
            icon={<ChatCenteredText />}
            className="py-1.5 text-xs"
            onSelect={() => setAnnotating(true)}
          >
            Annotate here
          </MenuItem>
        </>
      )}
    </div>,
    document.body,
  );
}
