"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { DataProvider } from "@/lib/datasource";
import { buildDemoDoc } from "@/lib/demo";
import { GridCanvas } from "@/components/canvas/grid-canvas";
import { TopBar } from "@/components/chrome/top-bar";
import { FilterBar } from "@/components/chrome/filter-bar";
import { ActivityFeed } from "@/components/chrome/activity-feed";
import { EmptyState } from "@/components/chrome/empty-state";
import { cn } from "@/lib/utils";

/** Sync doc.theme (store, agent-controllable) -> next-themes class. */
function ThemeSync() {
  const theme = useDashboardStore((s) => s.doc.theme);
  const { setTheme } = useTheme();
  useEffect(() => {
    setTheme(theme);
  }, [theme, setTheme]);
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
  const theme = useDashboardStore((s) => s.doc.theme);
  const loadDoc = useDashboardStore((s) => s.loadDoc);
  const selectTile = useDashboardStore((s) => s.selectTile);

  if (tiles.length === 0) {
    return (
      <EmptyState
        onLoadDemo={() =>
          loadDoc(buildDemoDoc(theme), {
            origin: "human",
            label: "Loaded demo dashboard",
          })
        }
      />
    );
  }
  return (
    <div
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
  const resolvedTheme = useDashboardStore((s) => s.doc.theme);

  return (
    <DataProvider>
      <ThemeSync />
      <Hotkeys />
      <div className="flex min-h-dvh flex-col">
        <TopBar
          activityOpen={activityOpen}
          onToggleActivity={() => setActivityOpen((v) => !v)}
        />
        <FilterBar />
        <main
          className={cn(
            "min-h-0 flex-1 transition-[padding] duration-300",
            activityOpen && "lg:pr-80",
          )}
        >
          <CanvasArea />
        </main>
        <ActivityFeed open={activityOpen} onClose={() => setActivityOpen(false)} />
      </div>
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
