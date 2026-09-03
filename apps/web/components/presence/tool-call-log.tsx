"use client";

/**
 * Tool call ledger, rendered.
 *
 * The activity log above it answers "what changed in this document". This
 * answers a different question: "what did the agent actually call". They are
 * not the same list — a read tool changes nothing and still proves the
 * integration is alive, and a rejected proposal is a real call with no
 * document change behind it.
 */

import { useEffect, useState } from "react";
import { ArrowsClockwise, Lightning } from "@phosphor-icons/react";
import {
  getToolCalls,
  subscribeToolCalls,
  type ToolCallRecord,
} from "@kontier-ri/studio";
import { cn } from "@/lib/utils";

/** Subscribe to the ledger without pulling it into a store. */
function useToolCalls(): readonly ToolCallRecord[] {
  const [entries, setEntries] = useState<readonly ToolCallRecord[]>(() =>
    getToolCalls(),
  );
  useEffect(() => {
    setEntries(getToolCalls());
    return subscribeToolCalls(setEntries);
  }, []);
  return entries;
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function ToolCallLog() {
  const entries = useToolCalls();

  if (entries.length === 0) {
    return (
      <div
        data-testid="tool-call-log-empty"
        className="rounded-[10px] border border-dashed border-line-2 px-4 py-7 text-center text-[13px] leading-relaxed text-muted-foreground"
      >
        No tool calls yet. Every WebMCP call your agent makes is listed here
        with its arguments and how long it took.
      </div>
    );
  }

  // Newest first: the last call is the one being debugged.
  const newestFirst = [...entries].reverse();
  const failures = entries.filter((entry) => !entry.ok).length;

  return (
    <div data-testid="tool-call-log">
      <div className="flex items-baseline justify-between gap-3 pb-1.5">
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Lightning weight="fill" className="size-3 text-accent" />
          Tool calls
        </span>
        <span
          className="text-[11.5px] tabular-nums text-faint"
          data-testid="tool-call-count"
        >
          {entries.length}
          {failures > 0 ? (
            <span className="text-destructive"> · {failures} failed</span>
          ) : null}
        </span>
      </div>
      <ul>
        {newestFirst.map((entry) => (
          <li
            key={entry.seq}
            data-testid="tool-call-row"
            data-tool-name={entry.name}
            className="flex gap-2.5 border-b border-line py-2 last:border-0"
          >
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-[7px] shrink-0 rounded-full",
                entry.ok ? "bg-ok" : entry.rejected ? "bg-warn" : "bg-destructive",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-1.5">
                <code className="min-w-0 truncate font-mono text-[12px] font-medium text-foreground">
                  {entry.name}
                </code>
                {entry.rejected ? (
                  <span className="shrink-0 rounded-full bg-warn-soft px-1.5 text-[10px] font-medium text-warn">
                    rejected
                  </span>
                ) : entry.readOnly === true ? (
                  <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] font-medium text-muted-foreground">
                    read
                  </span>
                ) : entry.readOnly === false ? (
                  <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10px] font-medium text-accent-strong">
                    writes
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-faint">
                  {formatDuration(entry.durationMs)}
                </span>
              </p>
              <p className="mt-0.5 truncate font-mono text-[10.5px] leading-4 text-faint">
                {entry.argsPreview}
              </p>
              {entry.error ? (
                <p className="mt-0.5 text-[11.5px] leading-4 text-destructive">
                  {entry.error}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 pt-2 text-[11px] text-faint">
        <ArrowsClockwise className="size-3" />
        Kept in this page only, newest first, capped at 200 calls.
      </p>
    </div>
  );
}
