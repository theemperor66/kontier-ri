"use client";

/**
 * Selection toolbar: floating pill with per-tile export actions (CSV data /
 * PNG image) for the currently selected tile. Chrome-owned so the canvas
 * tile frames stay lean; hidden in presentation mode.
 */

import { DownloadSimple, FileImage } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useUiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { exportTileCSV } from "@/lib/export-csv";
import { exportTilePNG } from "@/lib/export-image";

export function SelectionToolbar() {
  const presentation = useUiState((s) => s.presentation);
  const tile = useDashboardStore((s) =>
    s.selectedTileId
      ? s.doc.tiles.find((t) => t.id === s.selectedTileId)
      : undefined,
  );
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
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover/95 py-1 pl-3 pr-1.5 shadow-lg backdrop-blur"
    >
      <span className="max-w-48 truncate text-xs font-medium text-muted-foreground">
        {tile.title}
      </span>
      <div className="mx-1 h-4 w-px bg-border" />
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
    </div>
  );
}
