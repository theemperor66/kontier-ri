"use client";

/**
 * Audit log — the real command log. Every entry was produced by an actual
 * store command, attributed to the agent or to you. The newest undoable
 * command carries an Undo button; older ones cannot be undone out of order.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwise, Robot, User } from "@phosphor-icons/react";
import { useDashboardStore } from "@/lib/dashboard-store";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  Card,
  EmptyPanel,
  PageHeader,
  WorkspacePage,
} from "./primitives";

type Scope = "all" | "agent" | "human";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "agent", label: "Agent" },
  { id: "human", label: "You" },
];

export function AuditLogView() {
  const activityLog = useDashboardStore((s) => s.activityLog);
  const undoStack = useDashboardStore((s) => s.undoStack);
  const undo = useDashboardStore((s) => s.undo);
  const title = useDashboardStore((s) => s.doc.title);
  const [scope, setScope] = useState<Scope>("all");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const undoableId = undoStack[undoStack.length - 1]?.id;
  const agentCount = activityLog.filter((e) => e.by === "agent").length;

  const entries = useMemo(
    () =>
      scope === "all"
        ? activityLog
        : activityLog.filter((entry) =>
            scope === "agent" ? entry.by === "agent" : entry.by === "human",
          ),
    [activityLog, scope],
  );

  return (
    <WorkspacePage label="Audit log" testId="audit-log-view" className="max-w-[980px]">
      <PageHeader
        title="Audit log"
        subtitle={
          activityLog.length === 0
            ? `Nothing logged yet on “${title}”. Every human and agent command lands here.`
            : `${activityLog.length} logged ${activityLog.length === 1 ? "command" : "commands"} on “${title}” · ${agentCount} from an agent`
        }
        actions={
          <div
            role="group"
            aria-label="Filter the audit log by who acted"
            className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1"
          >
            {SCOPES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={scope === item.id}
                onClick={() => setScope(item.id)}
                className={cn(
                  "h-[26px] cursor-pointer rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
                  scope === item.id
                    ? "bg-accent-soft text-accent-strong"
                    : "text-muted-foreground hover:bg-surface-2",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      {entries.length === 0 ? (
        <EmptyPanel>
          {activityLog.length === 0
            ? "No changes yet. Move a tile, or ask a connected agent to build something — both are logged and undoable."
            : `No ${scope === "agent" ? "agent" : "human"} commands in this log yet.`}
        </EmptyPanel>
      ) : (
        <Card className="px-[18px] py-1">
          <ul>
            {entries.map((entry) => {
              const canUndo = entry.id === undoableId && !entry.undone;
              return (
                <li
                  key={entry.id}
                  data-testid="audit-entry"
                  className={cn(
                    "flex items-start gap-2.5 border-b border-line py-2.5 last:border-b-0",
                    entry.undone && "opacity-60",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-px grid size-6 shrink-0 place-items-center rounded-[7px]",
                      entry.by === "agent"
                        ? "bg-accent-soft text-accent-strong"
                        : "bg-surface-2 text-muted-foreground",
                    )}
                  >
                    {entry.by === "agent" ? (
                      <Robot weight="fill" className="size-3.5" />
                    ) : (
                      <User weight="fill" className="size-3.5" />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span
                      className={cn(
                        "text-[13.5px] leading-[1.4]",
                        entry.undone && "line-through",
                      )}
                    >
                      <span className="font-semibold">
                        {entry.by === "agent" ? "Agent" : "You"}
                      </span>{" "}
                      · {entry.label}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
                      <span>{now == null ? "" : formatAgo(entry.at, now)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {entry.by === "agent"
                          ? "WebMCP tool call"
                          : "This browser tab"}
                      </span>
                      {entry.undone ? (
                        <span className="text-warn">· undone</span>
                      ) : null}
                    </span>
                  </div>
                  {canUndo ? (
                    <ActionButton
                      size="sm"
                      onClick={() => undo()}
                      aria-label={`Undo: ${entry.label}`}
                      data-testid="audit-undo"
                    >
                      <ArrowCounterClockwise aria-hidden className="size-3.5" />
                      Undo
                    </ActionButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <p className="text-[12.5px] leading-relaxed text-faint">
        Only the newest command can be undone; undoing walks the stack back one
        step at a time. Presence events (plans, proposals, decisions) are logged
        but change no document state, so they are not undoable.
      </p>
    </WorkspacePage>
  );
}
