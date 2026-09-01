"use client";

/**
 * Page tabs: pages are tabs INSIDE a dashboard (add / rename via
 * double-click / remove / switch). Rendered inline in the top bar as a
 * segmented control. Hidden while the teaching empty state is up (single
 * empty page); not mounted in presentation mode (top bar unmounts).
 */

import { useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function PageTabs() {
  const pages = useDashboardStore((s) => s.doc.pages);
  const activePageId = useDashboardStore((s) => s.doc.activePageId);
  const switchPage = useDashboardStore((s) => s.switchPage);
  const addPage = useDashboardStore((s) => s.addPage);
  const renamePage = useDashboardStore((s) => s.renamePage);
  const removePage = useDashboardStore((s) => s.removePage);
  const undo = useDashboardStore((s) => s.undo);
  const tileCount = useDashboardStore((s) => s.doc.tiles.length);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Teaching empty state: no tabs noise on a fresh single-page doc.
  if (pages.length <= 1 && tileCount === 0) return null;

  const commitRename = (pageId: string) => {
    const name = draft.trim();
    const page = pages.find((p) => p.id === pageId);
    if (name && page && name !== page.name) {
      renamePage(pageId, name, {
        origin: "human",
        label: `Renamed page to \u201c${name}\u201d`,
      });
    }
    setRenamingId(null);
  };

  const activate = (pageId: string, name: string) => {
    if (pageId !== activePageId && renamingId !== pageId) {
      switchPage(pageId, {
        origin: "human",
        label: `Switched to page \u201c${name}\u201d`,
      });
    }
  };

  return (
    <div
      data-testid="page-tabs"
      role="tablist"
      aria-label="Dashboard pages"
      className="flex items-center gap-0.5 overflow-x-auto py-1"
    >
      {pages.map((p) => {
        const active = p.id === activePageId;
        return (
          <div
            key={p.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            data-testid={`page-tab-${p.id}`}
            data-active={active || undefined}
            className={cn(
              "group/tab relative flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
            onClick={() => activate(p.id, p.name)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate(p.id, p.name);
              }
            }}
            onDoubleClick={() => {
              setRenamingId(p.id);
              setDraft(p.name);
            }}
          >
            {renamingId === p.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(p.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label="Page name"
                className="h-5 w-24 rounded border border-border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-ring/50"
              />
            ) : (
              <span className="max-w-40 truncate" title="Double-click to rename">
                {p.name}
              </span>
            )}
            {pages.length > 1 && renamingId !== p.id ? (
              <button
                aria-label={`Remove page ${p.name}`}
                className={cn(
                  "flex size-4 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus-visible:opacity-100",
                  "group-hover/tab:opacity-100",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  const result = removePage(p.id, {
                    origin: "human",
                    label: `Removed page \u201c${p.name}\u201d`,
                  });
                  if (result.ok) {
                    toast(`Removed page \u201c${p.name}\u201d`, {
                      action: { label: "Undo", onClick: () => undo() },
                      duration: 10000,
                    });
                  } else if ("error" in result) {
                    toast.error(result.error);
                  }
                }}
              >
                <X className="size-2.5" />
              </button>
            ) : null}
          </div>
        );
      })}
      <Tooltip content="Add page">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add page"
          data-testid="add-page"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            const name = `Page ${pages.length + 1}`;
            addPage(name, {
              origin: "human",
              label: `Added page \u201c${name}\u201d`,
            });
          }}
        >
          <Plus className="size-3.5" />
        </Button>
      </Tooltip>
    </div>
  );
}
