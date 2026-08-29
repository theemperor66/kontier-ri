"use client";

/**
 * Dashboard manager: list / create / duplicate / rename / delete named
 * dashboards persisted in localStorage, plus JSON import/export.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  DownloadSimple,
  Layout,
  PencilSimple,
  PlusCircle,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/chrome/modal";
import { useUiState } from "@/lib/ui-state";
import {
  createDashboard,
  currentDashboardId,
  deleteDashboard,
  duplicateDashboard,
  exportDashboardJSON,
  importDashboardJSON,
  listDashboards,
  renameDashboard,
  switchDashboard,
  type DashboardEntry,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";

function timeAgo(at: number): string {
  const s = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function DashboardManager() {
  const open = useUiState((s) => s.managerOpen);
  const setOpen = useUiState((s) => s.setManagerOpen);
  const setTemplatesOpen = useUiState((s) => s.setTemplatesOpen);
  const [entries, setEntries] = useState<DashboardEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const refresh = useCallback(() => {
    setEntries(listDashboards());
    setCurrentId(currentDashboardId());
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const commitRename = (id: string) => {
    if (draft.trim()) {
      renameDashboard(id, draft);
    }
    setRenamingId(null);
    refresh();
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const doc = await importDashboardJSON(file);
        toast.success(`Imported dashboard "${doc.title}".`);
        refresh();
      } catch (err) {
        toast.error(
          `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    input.click();
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Dashboards"
      testId="dashboard-manager"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <Button
          size="sm"
          data-testid="manager-new-dashboard"
          onClick={() => {
            createDashboard();
            refresh();
            setOpen(false);
          }}
        >
          <PlusCircle className="size-4" /> New dashboard
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setTemplatesOpen(true);
          }}
        >
          <Layout className="size-4" /> From template
        </Button>
        <Button variant="outline" size="sm" onClick={handleImport}>
          <UploadSimple className="size-4" /> Import JSON
        </Button>
      </div>
      <ul className="divide-y divide-border/60" data-testid="dashboard-list">
        {entries.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted-foreground">
            No saved dashboards yet.
          </li>
        ) : null}
        {entries.map((e) => (
          <li
            key={e.id}
            className={cn(
              "group flex items-center gap-2 px-4 py-2.5",
              e.id === currentId && "bg-accent/40",
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 cursor-pointer text-left"
              onClick={() => {
                if (renamingId === e.id) return;
                if (switchDashboard(e.id)) {
                  setOpen(false);
                } else {
                  toast.error("Could not load that dashboard.");
                  refresh();
                }
              }}
            >
              {renamingId === e.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(ev) => setDraft(ev.target.value)}
                  onBlur={() => commitRename(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") commitRename(e.id);
                    if (ev.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(ev) => ev.stopPropagation()}
                  className="h-7 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                  aria-label="Dashboard name"
                />
              ) : (
                <>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{e.name}</span>
                    {e.id === currentId ? (
                      <Check className="size-3.5 shrink-0 text-agent" aria-label="Current dashboard" />
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.tileCount} tile{e.tileCount === 1 ? "" : "s"} · updated {timeAgo(e.updatedAt)}
                  </span>
                </>
              )}
            </button>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Rename ${e.name}`}
                onClick={() => {
                  setRenamingId(e.id);
                  setDraft(e.name);
                }}
              >
                <PencilSimple className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Duplicate ${e.name}`}
                onClick={() => {
                  duplicateDashboard(e.id);
                  refresh();
                }}
              >
                <Copy className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Export ${e.name} as JSON`}
                onClick={() => exportDashboardJSON(e.id)}
              >
                <DownloadSimple className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${e.name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (!window.confirm(`Delete dashboard "${e.name}"? This cannot be undone.`)) return;
                  deleteDashboard(e.id);
                  toast(`Deleted "${e.name}".`);
                  refresh();
                }}
              >
                <Trash className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
