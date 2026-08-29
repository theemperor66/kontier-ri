"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ChartLineUp,
  ClockCounterClockwise,
  Moon,
  Sun,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { WebMCPStatus } from "./webmcp-status";
import { cn } from "@/lib/utils";

export function TopBar({
  onToggleActivity,
  activityOpen,
}: {
  onToggleActivity: () => void;
  activityOpen: boolean;
}) {
  const title = useDashboardStore((s) => s.doc.title);
  const theme = useDashboardStore((s) => s.doc.theme);
  const setTitle = useDashboardStore((s) => s.setTitle);
  const setTheme = useDashboardStore((s) => s.setTheme);
  const undo = useDashboardStore((s) => s.undo);
  const redo = useDashboardStore((s) => s.redo);
  const canUndo = useDashboardStore((s) => s._past.length > 0);
  const canRedo = useDashboardStore((s) => s._future.length > 0);
  const activityCount = useDashboardStore((s) => s.activity.length);
  const { importFiles, status, statusDetail } = useDataSource();
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

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChartLineUp weight="bold" className="size-4" />
          </span>
          <div className="hidden flex-col leading-none sm:flex">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Kontier RI
            </span>
          </div>
        </div>
        <div className="mx-2 h-5 w-px bg-border" />
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
          className="h-8 w-full max-w-72 rounded-md bg-transparent px-2 text-sm font-medium outline-none transition-colors hover:bg-accent/60 focus:bg-accent/60 focus:ring-2 focus:ring-ring/50"
        />
        {status === "booting" ? (
          <span className="hidden animate-pulse whitespace-nowrap text-xs text-muted-foreground md:inline">
            {statusDetail}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <WebMCPStatus />
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
          <Tooltip content="Upload CSV or Parquet — data stays in your browser">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Upload data"
              onClick={() => fileRef.current?.click()}
            >
              <UploadSimple className="size-4" />
            </Button>
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
          <Tooltip content="Activity feed">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle activity feed"
              className={cn(activityOpen && "bg-accent")}
              onClick={onToggleActivity}
            >
              <span className="relative">
                <ClockCounterClockwise className="size-4" />
                {activityCount > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                    {activityCount > 9 ? "9+" : activityCount}
                  </span>
                ) : null}
              </span>
            </Button>
          </Tooltip>
          <Tooltip content={theme === "dark" ? "Light mode" : "Dark mode"}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() =>
                setTheme(theme === "dark" ? "light" : "dark", {
                  origin: "human",
                  label: `Switched to ${theme === "dark" ? "light" : "dark"} mode`,
                })
              }
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
