"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import { WorkspaceProvider } from "@/lib/workspace-sync";
import { WorkspaceGate } from "@/components/chrome/workspace-gate";
import {
  DecisionScopedTools,
  ProposalScopedTools,
  SelectedTileTools,
  WebMCPTools,
} from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import { DataProvider, dataSource } from "@/lib/datasource";
import { buildDemoDoc } from "@/lib/demo";
import { GridCanvas } from "@/components/canvas/grid-canvas";
import { AppRail } from "@/components/chrome/app-rail";
import { DataRail } from "@/components/chrome/data-rail";
import { TopBar } from "@/components/chrome/top-bar";
import { ReportHeader } from "@/components/chrome/report-header";
import { EmptyState } from "@/components/chrome/empty-state";
import { ShellExtras } from "@/components/chrome/shell-extras";
import { AgentCursor } from "@/components/presence/agent-cursor";
import { CollaborationRail } from "@/components/presence/collaboration-rail";
import { FocusRibbon } from "@/components/presence/focus-ribbon";
import { WorkspaceSurface } from "@/components/chrome/workspace-surface";
import { TileInspectorMount } from "@/components/inspector/tile-inspector";
import { useInspectorState } from "@/components/inspector/state";
import { useUiState } from "@/lib/ui-state";
import {
  WebMCPRegistryProvider,
  useWebMCPRegistry,
} from "@/lib/webmcp-registry";
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

function CanvasArea({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const tiles = useDashboardStore((s) => s.doc.tiles);
  const mode = useDashboardStore((s) => s.doc.theme.mode);
  const resetDashboard = useDashboardStore((s) => s.resetDashboard);
  const selectTile = useDashboardStore((s) => s.selectTile);
  const setAddVisualOpen = useUiState((s) => s.setAddVisualOpen);
  const presentation = useUiState((s) => s.presentation);
  // A report keeps its header (and page tabs) as soon as it holds anything;
  // only a genuinely fresh document shows the first-run surface.
  const documentHasContent = useDashboardStore(
    (s) => s.doc.pages.length > 1 || s.doc.pages.some((page) => page.tiles.length > 0),
  );

  if (!documentHasContent) {
    return <EmptyState onLoadDemo={() => resetDashboard(buildDemoDoc(mode))} />;
  }

  if (tiles.length === 0) {
    return (
      <>
        {!presentation ? <ReportHeader /> : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pt-4">
          <div className="rounded-xl border border-dashed border-line-2 px-6 py-12 text-center">
            <p className="text-sm font-medium">This page is empty.</p>
            <p className="mx-auto mt-1 max-w-[46ch] text-[13px] leading-relaxed text-muted-foreground">
              Add a visual yourself, or hand the page to your agent — it can add
              tiles here through the same command layer you use.
            </p>
            <button
              type="button"
              onClick={() => setAddVisualOpen(true)}
              className="mt-4 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line-2 bg-card px-3.5 text-[13px] font-medium transition-colors hover:bg-surface-2"
            >
              Add visual
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {!presentation ? <ReportHeader /> : null}
      <div className="relative min-h-0 flex-1">
        <div
          data-canvas-root
          className="h-full overflow-y-auto px-1 pb-6 pt-4 lg:-mr-4 lg:pr-4"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) selectTile(null);
          }}
        >
          <GridCanvas tiles={tiles} />
        </div>
        {!presentation ? <FocusRibbon onOpenWorkspace={onOpenWorkspace} /> : null}
      </div>
    </>
  );
}

function StudioAppInner() {
  const resolvedTheme = useDashboardStore((s) => s.doc.theme.mode);
  const view = useUiState((s) => s.view);
  const agentPanelOpen = useUiState((s) => s.agentPanelOpen);
  const setAgentPanelOpen = useUiState((s) => s.setAgentPanelOpen);
  const setAgentPanelTab = useUiState((s) => s.setAgentPanelTab);
  const railCollapsed = useUiState((s) => s.railCollapsed);
  const toggleRail = useUiState((s) => s.toggleRail);
  const setRailCollapsed = useUiState((s) => s.setRailCollapsed);
  const presentation = useUiState((s) => s.presentation);
  const inspectorOpen = useInspectorState((s) => s.open);
  const hasSelection = useDashboardStore((s) => s.selectedTileId != null);
  const { report: reportToolStatus } = useWebMCPRegistry();

  // The rail is a permanent column on a workspace-sized screen and an
  // overlay on a phone; start collapsed there instead of covering the canvas.
  useEffect(() => {
    // Idempotent on purpose. This used to toggle, which flips twice under
    // React's double-invoked mount effects and left the rail open across the
    // whole phone screen, swallowing every tap on the page beneath it.
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setRailCollapsed(true);
    }
    // Run once on mount: after that the rail is the user's decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const revealAgentWork = () => {
      setAgentPanelOpen(true);
    };
    window.addEventListener("kontier:agent-work", revealAgentWork);
    return () => window.removeEventListener("kontier:agent-work", revealAgentWork);
  }, [setAgentPanelOpen]);

  const railOpen =
    agentPanelOpen && !(inspectorOpen && hasSelection) && !presentation;

  return (
    <DataProvider>
      {/* WebMCP: 40 static tools, plus bundles that mount with the work —
          3 selection-scoped, 2 proposal-scoped, 1 decision-scoped. Every
          registration is a no-op when document.modelContext is absent. */}
      <WebMCPTools dataSource={dataSource} onStatusChange={reportToolStatus} />
      <SelectedTileTools
        dataSource={dataSource}
        onStatusChange={reportToolStatus}
      />
      {/* Phase-scoped bundles: the toolbelt itself changes with the state of
          the work — revise/withdraw exist only while a proposal is open. */}
      <ProposalScopedTools
        dataSource={dataSource}
        onStatusChange={reportToolStatus}
      />
      <DecisionScopedTools
        dataSource={dataSource}
        onStatusChange={reportToolStatus}
      />
      <ThemeSync />
      <Hotkeys />

      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        {!presentation ? (
          <>
            {!railCollapsed ? (
              <button
                type="button"
                aria-label="Close navigation"
                className="fixed inset-0 z-40 bg-nav/50 lg:hidden"
                onClick={toggleRail}
              />
            ) : null}
            <div
              className={cn(
                "fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
                railCollapsed ? "-translate-x-full lg:hidden" : "translate-x-0",
              )}
            >
              <AppRail />
            </div>
          </>
        ) : null}

        <div
          className={cn(
            "grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)]",
            presentation ? "gap-0 p-0" : "gap-3.5 p-3 pb-0 sm:p-4 sm:pb-0",
          )}
        >
          {!presentation ? (
            <TopBar
              agentPanelOpen={agentPanelOpen}
              onOpenActivity={() => {
                setAgentPanelTab("activity");
                setAgentPanelOpen(true);
              }}
              onToggleAgentPanel={() => setAgentPanelOpen(!agentPanelOpen)}
            />
          ) : null}

          <div
            className={cn(
              "grid min-h-0 min-w-0 gap-3.5",
              railOpen ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1",
            )}
          >
            <div className="flex min-h-0 min-w-0 overflow-hidden">
              {(view === "canvas" && !presentation) ? (
                <div className="hidden lg:block">
                  <DataRail />
                </div>
              ) : null}
              <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {view === "canvas" || presentation ? (
                  <CanvasArea onOpenWorkspace={() => setAgentPanelOpen(true)} />
                ) : (
                  <WorkspaceSurface view={view} />
                )}
              </main>
            </div>
            {!presentation ? (
              <CollaborationRail
                open={railOpen}
                onClose={() => setAgentPanelOpen(false)}
              />
            ) : null}
          </div>
        </div>

      </div>

      {/* Agent motion renders only from real agent-origin commands. */}
      <AgentCursor />
      <ShellExtras />
      <TileInspectorMount />
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

export function StudioApp() {
  return (
    <WebMCPRegistryProvider>
      {/* The workspace loop wraps the app: which workspace this tab is in
          decides what every approval and every edit means. */}
      <WorkspaceProvider>
        <WorkspaceGate>
          <StudioAppInner />
        </WorkspaceGate>
      </WorkspaceProvider>
    </WebMCPRegistryProvider>
  );
}
