"use client";

/**
 * Change-set review card: an agent's multi-action proposal, shown as a diff
 * the human can edit before it lands. Rows can be skipped; approving applies
 * the rest through the normal command layer as ONE undoable step.
 */

import { useMemo, useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { ChangeAction, ChangeSet } from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import { saveVersion } from "@/lib/versions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ChangeAction["kind"], string> = {
  add_tile: "Add",
  update_tile: "Edit",
  remove_tile: "Remove",
  add_annotation: "Annotate",
  set_filter: "Filter",
  set_tile_filters: "Scope",
};

const KIND_TONE: Record<ChangeAction["kind"], string> = {
  add_tile: "bg-ok-soft text-ok",
  update_tile: "bg-accent text-accent-foreground",
  remove_tile: "bg-danger-soft text-danger",
  add_annotation: "bg-warn-soft text-warn",
  set_filter: "bg-surface-2 text-muted-foreground",
  set_tile_filters: "bg-surface-2 text-muted-foreground",
};

function describe(action: ChangeAction, tileTitle: (id: string) => string): string {
  switch (action.kind) {
    case "add_tile":
      return `${action.payload.type} tile “${action.payload.title}”`;
    case "update_tile": {
      const keys = [
        ...(action.payload.patch.title !== undefined ? ["title"] : []),
        ...Object.keys(action.payload.patch.spec ?? {}),
      ];
      return `“${tileTitle(action.payload.tileId)}” · ${keys.join(", ") || "spec"}`;
    }
    case "remove_tile":
      return `“${tileTitle(action.payload.tileId)}”`;
    case "add_annotation":
      return `“${tileTitle(action.payload.tileId)}” · “${action.payload.text}”`;
    case "set_filter": {
      const value = Array.isArray(action.payload.value)
        ? action.payload.value.join(", ")
        : String(action.payload.value);
      return `${action.payload.column} ${action.payload.op} ${value}`;
    }
    case "set_tile_filters":
      return `“${tileTitle(action.payload.tileId)}” · ${action.payload.filters.length} filter${
        action.payload.filters.length === 1 ? "" : "s"
      }`;
  }
}

export function ChangeSetCard({
  changeSet,
  variant = "rail",
}: {
  changeSet: ChangeSet;
  variant?: "rail" | "page";
}) {
  const applyChangeSet = useDashboardStore((s) => s.applyChangeSet);
  const rejectChangeSet = useDashboardStore((s) => s.rejectChangeSet);
  const undo = useDashboardStore((s) => s.undo);
  const tiles = useDashboardStore((s) => s.doc.tiles);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  const tileTitle = (id: string) =>
    tiles.find((tile) => tile.id === id)?.title ?? id;
  const keptCount = changeSet.actions.length - skipped.size;

  const toggle = (index: number) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const apply = () => {
    // Agent work always gets a restore point, taken before anything runs.
    saveVersion(
      useDashboardStore.getState().doc,
      `Before “${changeSet.title}”`,
    );
    const result = applyChangeSet(changeSet.id, {
      skipIndexes: [...skipped],
    });
    if (!result.ok) {
      toast.error("error" in result ? result.error : "Could not apply the change set.");
      return;
    }
    toast(`Applied “${changeSet.title}” (${keptCount} change${keptCount === 1 ? "" : "s"})`, {
      action: { label: "Undo", onClick: () => undo() },
      duration: 10_000,
    });
  };

  return (
    <article
      data-testid="change-set-card"
      data-change-set={changeSet.id}
      className={cn(
        "rounded-[10px] border border-accent-mid bg-card",
        variant === "page" ? "px-5 py-4" : "px-3.5 py-3",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-[10.5px] font-semibold text-accent-foreground">
          AI
        </span>
        <span className="flex-1 truncate text-[12.5px] text-muted-foreground">
          Browser agent
        </span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
          {changeSet.actions.length} change{changeSet.actions.length === 1 ? "" : "s"}
        </span>
      </div>

      <h4
        className={cn(
          "mt-2 font-semibold leading-snug",
          variant === "page" ? "text-base" : "text-sm",
        )}
      >
        {changeSet.title}
      </h4>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        {changeSet.rationale}
      </p>

      <ul className="mt-3 flex flex-col gap-1">
        {changeSet.actions.map((action, index) => {
          const isSkipped = skipped.has(index);
          return (
            <li key={index}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-2.5 py-2 transition-colors hover:bg-surface-2",
                  isSkipped && "opacity-45",
                )}
              >
                <input
                  type="checkbox"
                  data-testid={`change-action-${index}`}
                  checked={!isSkipped}
                  onChange={() => toggle(index)}
                  aria-label={`Include change ${index + 1}: ${describe(action, tileTitle)}`}
                  className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent-strong)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-px text-[10.5px] font-medium",
                        KIND_TONE[action.kind],
                      )}
                    >
                      {KIND_LABEL[action.kind]}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 truncate text-[12.5px]",
                        isSkipped && "line-through",
                      )}
                    >
                      {describe(action, tileTitle)}
                    </span>
                  </span>
                  {action.note ? (
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                      {action.note}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-[30px] text-[12.5px]"
          data-testid="approve-change-set"
          disabled={keptCount === 0}
          onClick={apply}
        >
          <Check className="size-3.5" />
          Approve {keptCount === changeSet.actions.length ? "all" : `${keptCount}`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-[30px] text-[12.5px]"
          data-testid="reject-change-set"
          onClick={() => rejectChangeSet(changeSet.id)}
        >
          <X className="size-3.5" />
          Reject
        </Button>
        <span className="ml-auto text-[11.5px] text-faint">
          {skipped.size > 0
            ? `${skipped.size} skipped`
            : new Date(changeSet.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
        </span>
      </div>
    </article>
  );
}

/** All pending change sets, newest last (rail + approvals share this). */
export function ChangeSetQueue({ variant = "rail" }: { variant?: "rail" | "page" }) {
  // Select the stable array and filter in a memo: a selector that builds a
  // new array on every read re-renders forever under useSyncExternalStore.
  const all = useDashboardStore((s) => s.presence.changeSets);
  const changeSets = useMemo(
    () => all.filter((set) => set.status === "proposed"),
    [all],
  );
  if (changeSets.length === 0) return null;
  return (
    <div data-testid="change-set-queue" className="flex flex-col gap-2.5">
      <h3
        className={cn(
          "px-0.5 font-semibold",
          variant === "page" ? "text-[15px]" : "text-xs",
        )}
      >
        Staged change sets
      </h3>
      {changeSets.map((changeSet) => (
        <ChangeSetCard key={changeSet.id} changeSet={changeSet} variant={variant} />
      ))}
    </div>
  );
}
