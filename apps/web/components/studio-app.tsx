"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import { SelectedTileTools, WebMCPTools } from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import { DataProvider, dataSource } from "@/lib/datasource";
import { buildDemoDoc } from "@/lib/demo";
import { GridCanvas } from "@/components/canvas/grid-canvas";
import { TopBar } from "@/components/chrome/top-bar";
import { FilterBar } from "@/components/chrome/filter-bar";
import { ActivityFeed } from "@/components/chrome/activity-feed";
import { EmptyState } from "@/components/chrome/empty-state";
import { ShellExtras } from "@/components/chrome/shell-extras";
import { AgentCursor } from "@/components/presence/agent-cursor";
import { InsightTray } from "@/components/presence/insight-tray";
import { PlanCard } from "@/components/presence/plan-card";
import { useUiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

/** Sync doc.theme.mode (store, agent-controllable) -> next-themes class. */
function ThemeSync() {
  const mode = useDashboardStore((s) => s.doc.theme.mode);
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(mode);
  }, [mode, setTheme]);
  return null;
}

/** Global keyboard shortcuts: ⌘Z undo, ⇧⌘Z / ⌘Y redo. */
function Hotkeys() {
  const undo = useDashboardStore((s) => s.undo);
  const redo = useDashboardStore((s) => s.redo);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  return null;
}

function CanvasArea() {
  const tiles = useDashboardStore((s) => s.doc.tiles);
  const mode = useDashboardStore((s) => s.doc.theme.mode);
  const resetDashboard = useDashboardStore((s) => s.resetDashboard);
  const selectTile = useDashboardStore((s) => s.selectTile);

  if (tiles.length === 0) {
    return (
      <EmptyState onLoadDemo={() => resetDashboard(buildDemoDoc(mode))} />
    );
  }
  return (
    <div
      data-canvas-root
      className="px-4 py-4"
      onPointerDown={(e) => {
        // Clicking canvas background clears the selection.
        if (e.target === e.currentTarget) selectTile(null);
      }}
    >
      <GridCanvas tiles={tiles} />
    </div>
  );
}

export function StudioApp() {
  const [activityOpen, setActivityOpen] = useState(false);
  const resolvedTheme = useDashboardStore((s) => s.doc.theme.mode);
  // Presentation mode (F): chrome hidden, tiles full-bleed.
  const presentation = useUiState((s) => s.presentation);

  return (
    <DataProvider>
      {/* WebMCP: 36 static tools + 3 selection-scoped tools (top-level mount;
          registration is a no-op when document.modelContext is absent). */}
      <WebMCPTools dataSource={dataSource} />
      <SelectedTileTools dataSource={dataSource} />
      <ThemeSync />
      <Hotkeys />
      <div className="flex min-h-dvh flex-col">
        {!presentation ? (
          <TopBar
            activityOpen={activityOpen}
            onToggleActivity={() => setActivityOpen((v) => !v)}
          />
        ) : null}
        {!presentation ? <FilterBar /> : null}
        {!presentation ? <InsightTray /> : null}
        <main
          className={cn(
            "min-h-0 flex-1 transition-[padding] duration-300",
            !presentation && activityOpen && "lg:pr-80",
          )}
        >
          <CanvasArea />
        </main>
        {!presentation ? (
          <ActivityFeed open={activityOpen} onClose={() => setActivityOpen(false)} />
        ) : null}
      </div>
      {/* Agent presence layer (E2): renders ONLY from real tool calls. */}
      <PlanCard />
      <AgentCursor />
      <ShellExtras />
      <Toaster
        position="bottom-right"
        theme={resolvedTheme}
        toastOptions={{
          style: {
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
          },
        }}
      />
    </DataProvider>
  );
}
