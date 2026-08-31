"use client";

/**
 * Insight tray (E2): chips for insights the agent proposed via the
 * `propose_insight` WebMCP tool. Accept executes the insight's
 * suggestedAction through the EXISTING command layer (origin "agent",
 * undoable — the toast offers Undo); Dismiss just waves it away. Both are
 * activity-logged. Renders nothing unless the agent proposed something.
 */

import { Check, Info, Warning, WarningOctagon, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { Insight } from "@kontier-ri/studio";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SEVERITY: Record<
  Insight["severity"],
  { chip: string; icon: string; Icon: typeof Info }
> = {
  info: {
    chip: "border-agent/30 bg-agent/10",
    icon: "text-agent",
    Icon: Info,
  },
  warn: {
    chip: "border-amber-500/40 bg-amber-500/10",
    icon: "text-amber-600 dark:text-amber-300",
    Icon: Warning,
  },
  critical: {
    chip: "border-destructive/40 bg-destructive/10",
    icon: "text-destructive",
    Icon: WarningOctagon,
  },
};

export function InsightTray() {
  const insights = useDashboardStore((s) => s.presence.insights);
  const acceptInsight = useDashboardStore((s) => s.acceptInsight);
  const dismissInsight = useDashboardStore((s) => s.dismissInsight);
  const undo = useDashboardStore((s) => s.undo);

  const proposed = insights.filter((i) => i.state === "proposed");
  if (proposed.length === 0) return null;

  const onAccept = (insight: Insight) => {
    const res = acceptInsight(insight.id);
    if (!res.ok) {
      toast.error(res.conflict ? res.hint : res.error);
      return;
    }
    if (insight.suggestedAction) {
      toast(`Applied: “${insight.title}”`, {
        action: { label: "Undo", onClick: () => undo() },
        duration: 10_000,
      });
    } else {
      toast(`Noted: “${insight.title}”`);
    }
  };

  return (
    <div
      data-testid="insight-tray"
      className="flex flex-wrap items-center gap-1.5 px-4 pt-3"
    >
      {proposed.map((insight) => {
        const sev = SEVERITY[insight.severity];
        return (
          <span
            key={insight.id}
            data-testid="insight-chip"
            data-severity={insight.severity}
            className={cn(
              "presence-card-enter inline-flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-xs",
              sev.chip,
            )}
          >
            <sev.Icon weight="fill" className={cn("size-3.5 shrink-0", sev.icon)} />
            <Tooltip content={insight.body} className="min-w-0">
              <span className="truncate font-medium">{insight.title}</span>
            </Tooltip>
            <button
              type="button"
              data-testid="accept-insight"
              onClick={() => onAccept(insight)}
              className="inline-flex h-5.5 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-agent/90 px-2 text-[10px] font-semibold text-background transition-colors hover:bg-agent"
            >
              <Check weight="bold" className="size-2.5" />
              Accept
            </button>
            <button
              type="button"
              data-testid="dismiss-insight"
              aria-label={`Dismiss insight: ${insight.title}`}
              onClick={() => dismissInsight(insight.id)}
              className="inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
