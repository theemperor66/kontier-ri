"use client";

/**
 * Shell extras mount point: command palette, dashboard manager, templates
 * gallery, persistence bootstrap, presentation-mode hotkeys + exit control,
 * aria-live agent announcer. Mounted once from StudioApp.
 */

import { useEffect } from "react";
import { CornersIn, Play } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useUiState } from "@/lib/ui-state";
import { useDashboardStore } from "@/lib/dashboard-store";
import { withViewTransition } from "@/lib/theme-transition";
import { CommandPalette } from "@/components/chrome/command-palette";
import { DashboardManager } from "@/components/chrome/dashboard-manager";
import { TemplatesGallery } from "@/components/chrome/templates-gallery";
import { AddVisualDialog } from "@/components/chrome/add-visual";
import { VersionHistory } from "@/components/chrome/version-history";
import { AgentDiagnostics } from "@/components/chrome/agent-diagnostics";
import { DashboardPersistence } from "@/components/chrome/dashboard-persistence";
import { SelectionToolbar } from "@/components/chrome/selection-toolbar";
import { AgentAnnouncer } from "@/components/presence/agent-announcer";
import { InvestigationRecorder } from "@/lib/investigations";

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
  );
}

/**
 * F toggles presentation mode (with a cross-fade); Escape exits it, and
 * otherwise deselects the selected tile (when no dialog is open — dialogs
 * and dropdown menus own their local Escape and stop propagation).
 */
/** ⌘B toggles the field pane, the way a BI tool's data pane always has. */
function DataRailHotkey() {
  const toggleDataRail = useUiState((s) => s.toggleDataRail);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleDataRail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDataRail]);
  return null;
}

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
        withViewTransition(() => togglePresentation());
      } else if (e.key === "Escape" && !dialogOpen) {
        if (ui.presentation) {
          withViewTransition(() => setPresentation(false));
        } else {
          const store = useDashboardStore.getState();
          if (store.selectedTileId) store.selectTile(null);
        }
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
    <div className="fixed bottom-4 right-4 z-50 opacity-40 transition-opacity hover:opacity-100 focus-within:opacity-100">
      <Button
        variant="outline"
        size="sm"
        data-testid="exit-presentation"
        className="bg-background/80 shadow-lg backdrop-blur"
        onClick={() => withViewTransition(() => setPresentation(false))}
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
      <DataRailHotkey />
      <PresentationExit />
      <SelectionToolbar />
      <CommandPalette />
      <DashboardManager />
      <TemplatesGallery />
      <AddVisualDialog />
      <VersionHistory />
      <AgentDiagnostics />
      <AgentAnnouncer />
      <InvestigationRecorder />
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
      onClick={() => withViewTransition(() => setPresentation(true))}
    >
      <Play className="size-4" />
    </Button>
  );
}
