"use client";

/**
 * In-tile proposal strip (design device): a pending agent proposal lands on
 * the tile it would change, with Approve / Reject in place. The same object
 * also appears in the agent panel and in Approvals — this is the on-canvas
 * face of it, so a proposal is never only a message beside the work.
 */

import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";

export function TileProposalStrip({ tileId }: { tileId: string }) {
  const insight = useDashboardStore((s) =>
    s.presence.insights.find(
      (item) => item.state === "proposed" && item.tileId === tileId,
    ),
  );
  const acceptInsight = useDashboardStore((s) => s.acceptInsight);
  const dismissInsight = useDashboardStore((s) => s.dismissInsight);
  const undo = useDashboardStore((s) => s.undo);

  if (!insight) return null;

  return (
    <div
      data-testid="tile-proposal"
      // In flow, not overlaid: the tile the human must judge keeps its axis,
      // its baseline label and its brush while the strip is open.
      className="presence-card-enter mx-3 mb-2.5 flex shrink-0 items-center gap-2.5 rounded-[10px] border border-accent-mid bg-card px-3 py-2 shadow-card"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="size-2 shrink-0 rounded-full bg-accent-strong" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-[1.35]">
        <span className="font-medium text-accent-strong">Agent suggests: </span>
        <span className="text-foreground">{insight.title}</span>
        <span className="ml-1 hidden text-muted-foreground sm:inline">
          {insight.body}
        </span>
      </p>
      <button
        type="button"
        data-testid="tile-proposal-approve"
        onClick={(event) => {
          event.stopPropagation();
          const result = acceptInsight(insight.id);
          if (!result.ok) {
            toast.error(result.conflict ? result.hint : result.error);
            return;
          }
          if (insight.suggestedAction) {
            toast(`Applied: “${insight.title}”`, {
              action: { label: "Undo", onClick: () => undo() },
              duration: 10_000,
            });
          }
        }}
        className="h-[26px] shrink-0 cursor-pointer rounded-[7px] bg-primary px-[11px] text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Approve
      </button>
      <button
        type="button"
        data-testid="tile-proposal-reject"
        onClick={(event) => {
          event.stopPropagation();
          dismissInsight(insight.id);
        }}
        className="h-[26px] shrink-0 cursor-pointer rounded-[7px] border border-line-2 px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        Reject
      </button>
    </div>
  );
}
