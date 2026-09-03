"use client";

/**
 * Tile inspector (Component Interaction Pack): a docked right-side panel
 * that makes every tile spec HUMAN-editable — the same properties the agent
 * edits through WebMCP tools, through the same store actions (updateTile /
 * setTileFilters / setTileIgnoreCrossFilter, origin "human"), so every edit
 * is undoable, attributed in the activity feed, and conflict-tracked.
 *
 * Open: double-click a tile body, the ⚙ "Inspect" pill next to the
 * selection toolbar, or ⌘E on a selection. Esc closes. The canvas stays
 * visible and live-previews every change. Positioned fixed at the viewport
 * (never inside a transformed tile — containing-block trap).
 */

import { useEffect, useRef, useState } from "react";
import { GearSix, X } from "@phosphor-icons/react";
import type { ChartSpec, Tile } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useUiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { commitSpec, commitTitle, useDebounced } from "./commit";
import { Section, TextField } from "./fields";
import { useInspectorState } from "./state";
import { DataSection } from "./section-data";
import { VisualizeSection } from "./section-visualize";
import { FormatSection } from "./section-format";
import { FiltersSection } from "./section-filters";
import { AnalyticsSection } from "./section-analytics";

// ---------------------------------------------------------------------------
// Openers: double-click a tile, ⌘E on selection
// ---------------------------------------------------------------------------

function InspectorOpeners() {
  useEffect(() => {
    const onDblClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.closest !== "function") return;
      // Ignore double-clicks on interactive controls (rename input etc.).
      if (t.closest("input, textarea, select, button, [contenteditable=true]")) {
        return;
      }
      const frame = t.closest<HTMLElement>("[data-tile-type]");
      if (!frame) return;
      const testId = frame.getAttribute("data-testid") ?? "";
      if (!testId.startsWith("tile-")) return;
      useDashboardStore.getState().selectTile(testId.slice(5));
      useInspectorState.getState().setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "e"
      ) {
        if (!useDashboardStore.getState().selectedTileId) return;
        e.preventDefault();
        useInspectorState.getState().toggle();
      }
    };
    document.addEventListener("dblclick", onDblClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}

// ---------------------------------------------------------------------------
// ⚙ trigger — rendered as its own fixed pill measured to sit right of
// the existing selection toolbar (chrome-owned; deliberately not edited).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function TitleField({ tile }: { tile: Tile }) {
  const [draft, setDraft] = useState(tile.title);
  const lastCommitted = useRef(tile.title);
  useEffect(() => {
    if (tile.title !== lastCommitted.current) {
      lastCommitted.current = tile.title;
      setDraft(tile.title);
    }
  }, [tile.title]);
  const debounced = useDebounced((v: string) => {
    const next = v.trim();
    if (next.length === 0 || next === tile.title) return;
    lastCommitted.current = next;
    commitTitle(tile.id, next, `Renamed tile to “${next}”`);
  });
  return (
    <TextField
      label="Title"
      testId="inspector-title"
      value={draft}
      error={draft.trim().length === 0 ? "Title cannot be empty." : null}
      onChange={(v) => {
        setDraft(v);
        debounced.call(v);
      }}
      onFlush={debounced.flush}
    />
  );
}

function MarkdownSection({ tile }: { tile: Tile }) {
  const content = (tile.spec as { content: string }).content;
  const [draft, setDraft] = useState(content);
  const lastCommitted = useRef(content);
  useEffect(() => {
    if (content !== lastCommitted.current) {
      lastCommitted.current = content;
      setDraft(content);
    }
  }, [content]);
  const debounced = useDebounced((v: string) => {
    lastCommitted.current = v;
    commitSpec(tile.id, { content: v }, `Edited “${tile.title}” markdown`);
  });
  return (
    <Section title="Content" testId="inspector-markdown">
      <TextField
        label="Markdown"
        testId="inspector-markdown-input"
        textarea
        rows={12}
        mono
        value={draft}
        hint="Raw HTML is stripped; markdown renders live on the tile."
        onChange={(v) => {
          setDraft(v);
          debounced.call(v);
        }}
        onFlush={debounced.flush}
      />
    </Section>
  );
}

const TYPE_LABEL: Record<Tile["type"], string> = {
  kpi: "KPI",
  chart: "Chart",
  table: "Table",
  markdown: "Markdown",
};

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
    ),
  ).filter((el) => el.offsetParent !== null);
}

function InspectorPanel() {
  const open = useInspectorState((s) => s.open);
  const setOpen = useInspectorState((s) => s.setOpen);
  const presentation = useUiState((s) => s.presentation);
  const tile = useDashboardStore((s) =>
    s.selectedTileId
      ? s.doc.tiles.find((t) => t.id === s.selectedTileId)
      : undefined,
  );
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const visible = open && !!tile && !presentation;

  // Capture the focus origin and move focus into the panel on open (a11y:
  // keyboard users land on the first control; Tab is trapped below).
  useEffect(() => {
    if (!visible) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const raf = requestAnimationFrame(() => {
      focusables(panelRef.current)[0]?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  if (!visible || !tile) return null;

  const close = () => {
    setOpen(false);
    restoreRef.current?.focus?.({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // Own the Escape: the shell-level handler deselects the tile.
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const els = focusables(panelRef.current);
    if (els.length === 0) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const chartType = tile.type === "chart" ? (tile.spec as ChartSpec).chartType : null;

  return (
    <aside
      ref={panelRef}
      data-testid="tile-inspector"
      role="complementary"
      aria-label={`Tile inspector: ${tile.title}`}
      onKeyDown={onKeyDown}
      className="fixed right-0 top-14 z-30 flex h-[calc(100dvh-3.5rem)] w-[21rem] flex-col border-l border-border/70 bg-background/95 shadow-xl backdrop-blur-md"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-3">
        <GearSix className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">Inspector</h2>
          <p className="text-[11px] text-muted-foreground">
            {TYPE_LABEL[tile.type]} tile · edits apply live, undo with ⌘Z
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close inspector"
          data-testid="close-inspector"
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>
      {/* key by tile id: drafts reset when the inspected tile changes */}
      <div key={tile.id} className="min-h-0 flex-1 overflow-y-auto pb-8">
        <Section title="Tile" testId="inspector-tile">
          <TitleField tile={tile} />
        </Section>
        {tile.type === "markdown" ? (
          <MarkdownSection tile={tile} />
        ) : (
          <>
            <DataSection tile={tile} />
            {tile.type === "chart" ? <VisualizeSection tile={tile} /> : null}
            <FormatSection tile={tile} />
            <FiltersSection tile={tile} />
            {tile.type === "chart" && chartType ? (
              <AnalyticsSection tile={tile} />
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * Single mount point for the app shell: keyboard openers + the panel. The
 * visible trigger lives in the selection bar, so the canvas carries one
 * floating control instead of three.
 */
export function TileInspectorMount() {
  return (
    <>
      <InspectorOpeners />
      <InspectorPanel />
    </>
  );
}
