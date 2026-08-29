"use client";

import { useEffect, useState } from "react";
import {
  ArrowCounterClockwise,
  Robot,
  User,
  X,
} from "@phosphor-icons/react";
import { useDashboardStore } from "@/lib/dashboard-store";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ActivityFeed({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const activity = useDashboardStore((s) => s.activity);
  const past = useDashboardStore((s) => s._past);
  const undoActivity = useDashboardStore((s) => s.undoActivity);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [open]);

  const undoableId = past[past.length - 1]?.activityId;

  return (
    <aside
      data-testid="activity-feed"
      aria-hidden={!open}
      className={cn(
        "fixed right-0 top-14 z-30 flex h-[calc(100dvh-3.5rem)] w-80 flex-col border-l border-border/70 bg-background/95 backdrop-blur-md transition-transform duration-300 ease-out",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Activity</h2>
          <p className="text-[11px] text-muted-foreground">
            Every change, human or agent, is undoable.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close activity feed" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {activity.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No changes yet. Drag a tile or ask your agent to build something.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {activity.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "group/entry flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50",
                  entry.undone && "opacity-45",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                    entry.by === "agent"
                      ? "bg-violet-500/15 text-violet-500 dark:text-violet-300"
                      : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {entry.by === "agent" ? (
                    <Robot weight="fill" className="size-3.5" />
                  ) : (
                    <User weight="fill" className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-xs leading-snug",
                      entry.undone && "line-through",
                    )}
                  >
                    {entry.label}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {entry.by === "agent" ? "Agent" : "You"} ·{" "}
                    {formatAgo(entry.at, now)}
                  </p>
                </div>
                {entry.id === undoableId && !entry.undone ? (
                  <Tooltip content="Undo this change" side="top">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Undo: ${entry.label}`}
                      className="opacity-0 transition-opacity group-hover/entry:opacity-100"
                      onClick={() => undoActivity(entry.id)}
                    >
                      <ArrowCounterClockwise className="size-3.5" />
                    </Button>
                  </Tooltip>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
