"use client";

/**
 * Selection bar: one floating pill for the selected tile — its name, the
 * per-tile exports, and the inspector toggle. It is deliberately a single
 * bar: three separate floating controls used to stack on top of each other
 * at the bottom of the canvas.
 */

import { DownloadSimple, FileImage, GearSix } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useUiState } from "@/lib/ui-state";
import { useInspectorState } from "@/components/inspector/state";
import { Button } from "@/components/ui/button";
import { exportTileCSV } from "@/lib/export-csv";
import { exportTilePNG } from "@/lib/export-image";
import { cn } from "@/lib/utils";

export function SelectionToolbar() {
  const presentation = useUiState((s) => s.presentation);
  const tile = useDashboardStore((s) =>
    s.selectedTileId
      ? s.doc.tiles.find((t) => t.id === s.selectedTileId)
      : undefined,
  );
  const inspectorOpen = useInspectorState((s) => s.open);
  const toggleInspector = useInspectorState((s) => s.toggle);
  if (!tile || presentation) return null;

  const guard = (p: Promise<void>, okMsg: string) =>
    p
      .then(() => toast.success(okMsg))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
      );

  return (
    <div
      data-testid="selection-toolbar"
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-card/95 py-1 pl-3 pr-1.5 shadow-card backdrop-blur"
    >
      <span className="max-w-48 truncate text-xs font-medium text-muted-foreground">
        {tile.title}
      </span>
      <div className="mx-1 h-4 w-px bg-line" />
      {tile.type !== "markdown" ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          data-testid="export-tile-csv"
          onClick={() =>
            void guard(
              exportTileCSV(tile, useDashboardStore.getState().doc),
              `Exported “${tile.title}” data as CSV.`,
            )
          }
        >
          <DownloadSimple className="size-3.5" /> CSV
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        data-testid="export-tile-png"
        onClick={() =>
          void guard(
            exportTilePNG(tile.id, tile.title),
            `Exported “${tile.title}” as PNG.`,
          )
        }
      >
        <FileImage className="size-3.5" /> PNG
      </Button>
      <div className="mx-1 h-4 w-px bg-line" />
      <button
        type="button"
        data-testid="open-inspector"
        aria-label="Inspect tile"
        aria-pressed={inspectorOpen}
        onClick={toggleInspector}
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
          inspectorOpen
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        )}
      >
        <GearSix className="size-3.5" />
        Inspect
        <kbd className="rounded border border-line bg-surface-2 px-1 font-sans text-[10px] text-muted-foreground">
          ⌘E
        </kbd>
      </button>
    </div>
  );
}
