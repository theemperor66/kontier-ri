"use client";

/**
 * Shell extras mount point: command palette, dashboard manager, templates
 * gallery, persistence bootstrap, presentation-mode hotkeys + exit control.
 * Mounted once from StudioApp; everything here is shell-owned.
 */

import { useEffect } from "react";
import { CornersIn, Play } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useUiState } from "@/lib/ui-state";
import { CommandPalette } from "@/components/chrome/command-palette";
import { DashboardManager } from "@/components/chrome/dashboard-manager";
import { TemplatesGallery } from "@/components/chrome/templates-gallery";
import { DashboardPersistence } from "@/components/chrome/dashboard-persistence";
import { SelectionToolbar } from "@/components/chrome/selection-toolbar";

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}

/** F toggles presentation mode; Escape exits it (when no dialog is open). */
function PresentationHotkeys() {
  const togglePresentation = useUiState((s) => s.togglePresentation);
  const setPresentation = useUiState((s) => s.setPresentation);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const ui = useUiState.getState();
      const dialogOpen = ui.paletteOpen || ui.managerOpen || ui.templatesOpen;
      if (e.key.toLowerCase() === "f" && !dialogOpen) {
        e.preventDefault();
        togglePresentation();
      } else if (e.key === "Escape" && ui.presentation && !dialogOpen) {
        setPresentation(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePresentation, setPresentation]);
  return null;
}

/** Floating exit control while presenting (chrome is hidden). */
function PresentationExit() {
  const presentation = useUiState((s) => s.presentation);
  const setPresentation = useUiState((s) => s.setPresentation);
  if (!presentation) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 opacity-40 transition-opacity hover:opacity-100">
      <Button
        variant="outline"
        size="sm"
        data-testid="exit-presentation"
        className="bg-background/80 shadow-lg backdrop-blur"
        onClick={() => setPresentation(false)}
      >
        <CornersIn className="size-4" /> Exit
        <kbd className="rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground">F</kbd>
      </Button>
    </div>
  );
}

export function ShellExtras() {
  return (
    <>
      <DashboardPersistence />
      <PresentationHotkeys />
      <PresentationExit />
      <SelectionToolbar />
      <CommandPalette />
      <DashboardManager />
      <TemplatesGallery />
    </>
  );
}

/** Top-bar affordance to enter presentation mode (also on F). */
export function PresentationButton() {
  const setPresentation = useUiState((s) => s.setPresentation);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Presentation mode"
      onClick={() => setPresentation(true)}
    >
      <Play className="size-4" />
    </Button>
  );
}
