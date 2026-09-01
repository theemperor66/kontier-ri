"use client";

/**
 * Top bar (U4/A6): [brand] [title] [page tabs] … [WebMCP pill] [Share ▾]
 * [⌘K with visible label] [undo/redo] [••• overflow]. The two labeled
 * controls are the ones that matter (Share, Search); upload / dashboards /
 * presentation / theme / activity live in the overflow menu. Every control
 * keeps a tooltip with its shortcut where one exists.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  CaretDown,
  ClockCounterClockwise,
  DotsThreeVertical,
  DownloadSimple,
  Export,
  FileImage,
  LinkSimple,
  MagnifyingGlass,
  Moon,
  Play,
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
import { PageTabs } from "./page-tabs";
import { WebMCPStatus } from "./webmcp-status";
import { KontierWordmark } from "./kontier-wordmark";
import { useUiState } from "@/lib/ui-state";
import { buildShareURL } from "@/lib/share-url";
import { exportDashboardJSON } from "@/lib/dashboards";
import { exportDashboardPNG } from "@/lib/export-image";
import { withViewTransition } from "@/lib/theme-transition";
import { cn } from "@/lib/utils";

export function TopBar({
  onToggleActivity,
  activityOpen,
}: {
  onToggleActivity: () => void;
  activityOpen: boolean;
}) {
  const title = useDashboardStore((s) => s.doc.title);
  const mode = useDashboardStore((s) => s.doc.theme.mode);
  const setTitle = useDashboardStore((s) => s.setTitle);
  const setTheme = useDashboardStore((s) => s.setTheme);
  const undo = useDashboardStore((s) => s.undo);
  const redo = useDashboardStore((s) => s.redo);
  const canUndo = useDashboardStore((s) => s.undoStack.length > 0);
  const canRedo = useDashboardStore((s) => s.redoStack.length > 0);
  const activityCount = useDashboardStore((s) => s.activityLog.length);
  const { importFiles, status, statusDetail } = useDataSource();
  const setPaletteOpen = useUiState((s) => s.setPaletteOpen);
  const setManagerOpen = useUiState((s) => s.setManagerOpen);
  const setPresentation = useUiState((s) => s.setPresentation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    setDraft(title);
  }, [title]);

  const commitTitle = () => {
    const next = draft.trim();
    if (next && next !== title) {
      setTitle(next, { origin: "human", label: `Renamed dashboard to “${next}”` });
    } else {
      setDraft(title);
    }
  };

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
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex shrink-0 items-center gap-2">
          <KontierWordmark className="h-[18px] w-auto shrink-0 text-foreground" />
          <span className="hidden translate-y-px text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground xl:inline">
            Revenue Intelligence
          </span>
        </div>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(title);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Dashboard title"
          className="h-8 w-36 shrink-0 truncate rounded-md bg-transparent px-2 text-sm font-medium outline-none transition-[width,background-color] duration-200 hover:bg-accent/60 focus:w-64 focus:bg-accent/60 focus:ring-2 focus:ring-ring/50 md:w-48"
        />
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <div className="min-w-0 flex-1">
          <PageTabs />
        </div>
        {status === "booting" ? (
          <span className="hidden shrink-0 animate-pulse whitespace-nowrap text-xs text-muted-foreground md:inline">
            {statusDetail}
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <WebMCPStatus />
          <div className="mx-1 h-5 w-px bg-border" />

          <Menu
            label="Share"
            trigger={(props, open) => (
              <Tooltip content="Share — copy link, export PNG / JSON">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Share"
                  data-testid="share-menu"
                  className={cn(
                    "gap-1 px-2.5",
                    open && "bg-accent text-accent-foreground",
                  )}
                  {...props}
                >
                  <Export className="size-4" />
                  Share
                  <CaretDown
                    className={cn(
                      "size-3 text-muted-foreground transition-transform duration-150",
                      open && "rotate-180",
                    )}
                  />
                </Button>
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
                void exportDashboardPNG(
                  useDashboardStore.getState().doc.title,
                ).catch((err) =>
                  toast.error(err instanceof Error ? err.message : String(err)),
                )
              }
            >
              Export as PNG
            </MenuItem>
            <MenuItem
              icon={<DownloadSimple />}
              onSelect={() => exportDashboardJSON()}
            >
              Export as JSON
            </MenuItem>
          </Menu>

          <Tooltip content="Command palette (⌘K)">
            <Button
              variant="outline"
              size="sm"
              aria-label="Command palette"
              data-testid="open-palette"
              className="gap-1.5 px-2.5 text-muted-foreground"
              onClick={() => setPaletteOpen(true)}
            >
              <MagnifyingGlass className="size-4" />
              <span className="hidden lg:inline">Search</span>
              <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px]">
                ⌘K
              </kbd>
            </Button>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-border" />
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

          <Menu
            label="More actions"
            trigger={(props, open) => (
              <Tooltip content="More — upload, dashboards, present, theme, activity">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More actions"
                  data-testid="more-actions"
                  className={cn(open && "bg-accent text-accent-foreground")}
                  {...props}
                >
                  <span className="relative">
                    <DotsThreeVertical weight="bold" className="size-4" />
                    {activityCount > 0 ? (
                      <span
                        aria-hidden
                        className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary"
                      />
                    ) : null}
                  </span>
                </Button>
              </Tooltip>
            )}
          >
            <MenuItem
              icon={<UploadSimple />}
              aria-label="Upload data"
              onSelect={() => fileRef.current?.click()}
            >
              Upload CSV / Parquet
            </MenuItem>
            <MenuItem
              icon={<SquaresFour />}
              aria-label="Manage dashboards"
              data-testid="open-manager"
              onSelect={() => setManagerOpen(true)}
            >
              Manage dashboards
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Play />}
              shortcut="F"
              aria-label="Presentation mode"
              data-testid="enter-presentation"
              onSelect={() => withViewTransition(() => setPresentation(true))}
            >
              Presentation mode
            </MenuItem>
            <MenuItem
              icon={mode === "dark" ? <Sun /> : <Moon />}
              aria-label="Toggle theme"
              onSelect={toggleTheme}
            >
              {mode === "dark" ? "Light mode" : "Dark mode"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<ClockCounterClockwise />}
              aria-label="Toggle activity feed"
              onSelect={onToggleActivity}
            >
              <span className="flex items-center gap-2">
                Activity feed
                {activityCount > 0 ? (
                  <span
                    className={cn(
                      "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground",
                      activityOpen && "bg-muted text-muted-foreground",
                    )}
                  >
                    {activityCount > 99 ? "99+" : activityCount}
                  </span>
                ) : null}
              </span>
            </MenuItem>
          </Menu>

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
        </div>
      </div>
    </header>
  );
}
