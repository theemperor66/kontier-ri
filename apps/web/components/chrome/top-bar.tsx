"use client";

/**
 * Top bar (product design): a 56px rounded surface card holding the rail
 * toggle, the breadcrumb, the command search, live agent status, and the
 * agent-panel toggle. Data actions the design does not draw (upload, share,
 * export, presentation, dashboards) stay reachable in one overflow menu so
 * nothing the product can do becomes unreachable.
 */

import { useRef } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ClockCounterClockwise,
  DotsThreeVertical,
  DownloadSimple,
  Export,
  FileImage,
  LinkSimple,
  MagnifyingGlass,
  Moon,
  Play,
  SidebarSimple,
  Sparkle,
  SquaresFour,
  Sun,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Menu, MenuItem, MenuSeparator } from "./menu";
import { WebMCPStatus } from "./webmcp-status";
import { ShareWorkspaceButton } from "./share-workspace";
import { useUiState, type WorkspaceView } from "@/lib/ui-state";
import { buildShareURL } from "@/lib/share-url";
import { exportDashboardJSON } from "@/lib/dashboards";
import { exportDashboardPNG } from "@/lib/export-image";
import { withViewTransition } from "@/lib/theme-transition";
import { cn } from "@/lib/utils";

const VIEW_LABEL: Record<WorkspaceView, string> = {
  home: "Home",
  canvas: "Reports",
  approvals: "Approvals",
  datasets: "Datasets",
  model: "Semantic model",
  governance: "Data health",
  audit: "Audit log",
};

export function TopBar({
  onOpenActivity,
  onToggleAgentPanel,
  agentPanelOpen,
}: {
  onOpenActivity: () => void;
  onToggleAgentPanel: () => void;
  agentPanelOpen: boolean;
}) {
  const title = useDashboardStore((s) => s.doc.title);
  const mode = useDashboardStore((s) => s.doc.theme.mode);
  const setTheme = useDashboardStore((s) => s.setTheme);
  const undo = useDashboardStore((s) => s.undo);
  const redo = useDashboardStore((s) => s.redo);
  const canUndo = useDashboardStore((s) => s.undoStack.length > 0);
  const canRedo = useDashboardStore((s) => s.redoStack.length > 0);
  const activityCount = useDashboardStore((s) => s.activityLog.length);
  const pendingAgentItems = useDashboardStore(
    (s) =>
      s.presence.decisions.filter((decision) => decision.status === "pending").length +
      s.presence.insights.filter((insight) => insight.state === "proposed").length +
      s.presence.changeSets.filter((set) => set.status === "proposed").length,
  );
  const view = useUiState((s) => s.view);
  const toggleRail = useUiState((s) => s.toggleRail);
  const railCollapsed = useUiState((s) => s.railCollapsed);
  const setPaletteOpen = useUiState((s) => s.setPaletteOpen);
  const setManagerOpen = useUiState((s) => s.setManagerOpen);
  const setPresentation = useUiState((s) => s.setPresentation);
  const setVersionsOpen = useUiState((s) => s.setVersionsOpen);
  const { importFiles, status, statusDetail } = useDataSource();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const imported = await importFiles(files);
      toast.success(
        `Imported ${imported.map((d) => `${d.name} (${d.rowCount.toLocaleString()} rows)`).join(", ")}`,
      );
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const copyShareLink = () => {
    const doc = useDashboardStore.getState().doc;
    void navigator.clipboard
      .writeText(buildShareURL(doc))
      .then(() => toast.success("Share link copied."))
      .catch(() => toast.error("Could not access the clipboard."));
  };

  const toggleTheme = () => {
    const next = mode === "dark" ? "light" : "dark";
    withViewTransition(
      () =>
        setTheme(
          { mode: next },
          { origin: "human", label: `Switched to ${next} mode` },
        ),
      { fallbackClass: "theme-fade" },
    );
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 rounded-xl border border-line bg-card pl-3 pr-3.5 sm:gap-2.5">
      <Tooltip content={railCollapsed ? "Show navigation" : "Hide navigation"}>
        <button
          type="button"
          aria-label={railCollapsed ? "Show navigation" : "Hide navigation"}
          data-testid="toggle-rail"
          onClick={toggleRail}
          className="grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <SidebarSimple className="size-[18px]" />
        </button>
      </Tooltip>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden text-faint sm:inline">{VIEW_LABEL[view]}</span>
        <span className="hidden text-faint sm:inline">/</span>
        <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      </nav>

      {status === "booting" ? (
        <span className="hidden shrink-0 animate-pulse whitespace-nowrap text-xs text-muted-foreground xl:inline">
          {statusDetail}
        </span>
      ) : null}

      <div className="flex-1" />

      <button
        type="button"
        data-testid="open-palette"
        aria-label="Search commands"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-[38px] w-[230px] cursor-pointer items-center gap-2.5 rounded-[9px] border border-line px-3.5 text-sm text-muted-foreground transition-colors hover:border-line-2 hover:text-foreground lg:flex"
      >
        <MagnifyingGlass className="size-3.5" />
        Search commands
        <kbd className="ml-auto rounded border border-line px-1.5 py-px text-[11px] font-normal text-faint">
          ⌘K
        </kbd>
      </button>
      <Tooltip content="Search commands (⌘K)">
        <button
          type="button"
          aria-label="Search commands"
          onClick={() => setPaletteOpen(true)}
          className="grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground lg:hidden"
        >
          <MagnifyingGlass className="size-4" />
        </button>
      </Tooltip>

      {/* Joining or inviting is one visible click, never a wall. */}
      <ShareWorkspaceButton />

      <div className="hidden md:block">
        <WebMCPStatus />
      </div>

      <div className="hidden items-center md:flex">
        <Tooltip content="Undo (⌘Z)">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => undo()}
          >
            <ArrowCounterClockwise className="size-4" />
          </Button>
        </Tooltip>
        <Tooltip content="Redo (⇧⌘Z)">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => redo()}
          >
            <ArrowClockwise className="size-4" />
          </Button>
        </Tooltip>
      </div>

      <Tooltip content={mode === "dark" ? "Light mode" : "Dark mode"}>
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className="grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </Tooltip>

      <Menu
        label="More actions"
        trigger={(props, open) => (
          <Tooltip content="More — share, upload, dashboards, present, activity">
            <button
              type="button"
              aria-label="More actions"
              data-testid="more-actions"
              className={cn(
                "grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
                open && "bg-surface-2 text-foreground",
              )}
              {...props}
            >
              <DotsThreeVertical weight="bold" className="size-4" />
            </button>
          </Tooltip>
        )}
      >
        <MenuItem
          icon={<LinkSimple />}
          data-testid="copy-share-link"
          onSelect={copyShareLink}
        >
          Copy share link
        </MenuItem>
        <MenuItem
          icon={<FileImage />}
          onSelect={() =>
            void exportDashboardPNG(useDashboardStore.getState().doc.title).catch(
              (err) => toast.error(err instanceof Error ? err.message : String(err)),
            )
          }
        >
          Export as PNG
        </MenuItem>
        <MenuItem icon={<DownloadSimple />} onSelect={() => exportDashboardJSON()}>
          Export as JSON
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<UploadSimple />} onSelect={() => fileRef.current?.click()}>
          Upload CSV / Parquet
        </MenuItem>
        <MenuItem
          icon={<SquaresFour />}
          data-testid="open-manager"
          onSelect={() => setManagerOpen(true)}
        >
          Manage dashboards
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<Play />}
          shortcut="F"
          data-testid="enter-presentation"
          onSelect={() => withViewTransition(() => setPresentation(true))}
        >
          Presentation mode
        </MenuItem>
        <MenuItem
          icon={<ClockCounterClockwise />}
          data-testid="open-versions"
          onSelect={() => setVersionsOpen(true)}
        >
          Version history
        </MenuItem>
        <MenuItem
          icon={<ClockCounterClockwise />}
          data-testid="open-activity"
          onSelect={onOpenActivity}
        >
          <span className="flex items-center gap-2">
            Activity feed
            {activityCount > 0 ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-2 px-1 text-[9px] font-semibold text-muted-foreground">
                {activityCount > 99 ? "99+" : activityCount}
              </span>
            ) : null}
          </span>
        </MenuItem>
      </Menu>

      <Tooltip content="Agent workspace — brief, plan, approvals">
        <button
          type="button"
          aria-label="Agent workspace"
          aria-expanded={agentPanelOpen}
          data-testid="agent-workspace-button"
          onClick={onToggleAgentPanel}
          className={cn(
            "relative grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-lg transition-colors",
            agentPanelOpen
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
        >
          <Sparkle weight="fill" className="size-4" />
          {pendingAgentItems > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
              {pendingAgentItems > 9 ? "9+" : pendingAgentItems}
            </span>
          ) : null}
        </button>
      </Tooltip>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.parquet"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </header>
  );
}
