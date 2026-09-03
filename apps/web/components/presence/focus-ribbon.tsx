"use client";

/**
 * Focus bar: what the agent can see about the human's current pointing.
 * It floats over the canvas instead of sitting in the layout flow — a bar
 * that appears on selection must never push the tiles the user just clicked.
 */

import { ArrowRight, ClipboardText, CursorClick, Scan } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { cn } from "@/lib/utils";

export function FocusRibbon({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const brushed = useDashboardStore((s) => s.brushedRange);
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);
  const selectedTitle = useDashboardStore((s) =>
    s.doc.tiles.find((tile) => tile.id === s.selectedTileId)?.title,
  );
  const session = useDashboardStore((s) => s.presence.session);

  // The selection bar already names the selected tile, so the ribbon speaks
  // only for what it cannot show: a brushed range or a cross-filter.
  if (!brushed && !crossFilter) return null;

  const detail = brushed
    ? `${brushed.from} → ${brushed.to}${selectedTitle ? ` on ${selectedTitle}` : ""}`
    : crossFilter
      ? `${crossFilter.column} = ${String(crossFilter.value)}`
      : (selectedTitle ?? "Current selection");
  const prompt = session
    ? "Use get_work_context and investigate the focus I just set. Show the evidence, and ask for my judgment before making an assumption."
    : `Investigate my current focus in Kontier RI: ${detail}. Read get_user_focus first, then show the evidence on the canvas.`;

  return (
    <div
      data-testid="focus-ribbon"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4",
        // Sit above the selection bar rather than under it.
        selectedTitle ? "bottom-16" : "bottom-3",
      )}
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-line bg-card/95 py-1.5 pl-3 pr-1.5 shadow-card backdrop-blur">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
          {brushed ? <Scan className="size-3" /> : <CursorClick className="size-3" />}
        </span>
        <span className="min-w-0 text-[12.5px]">
          <span className="text-muted-foreground">Agent sees </span>
          <span className="font-medium">{detail}</span>
        </span>
        <button
          type="button"
          data-testid="copy-focus-prompt"
          onClick={() => {
            void navigator.clipboard
              .writeText(prompt)
              .then(() => toast.success("Focus prompt copied."))
              .catch(() => toast.error("Could not access the clipboard."));
          }}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ClipboardText className="size-3.5" />
          <span className="hidden sm:inline">Copy prompt</span>
        </button>
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-primary px-2.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Workspace
          <ArrowRight className="size-3" />
        </button>
      </div>
    </div>
  );
}
