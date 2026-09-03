"use client";

/**
 * The top-bar entry into shared work: invite people when this tab is already
 * in a workspace, or open the chooser when it is not.
 *
 * It shows the live peer count because that is the only honest advertisement
 * for collaboration — a number that is real, or nothing.
 */

import { UsersThree } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui/tooltip";
import { useUiState } from "@/lib/ui-state";
import { useWorkspace } from "@/lib/workspace-sync";
import { cn } from "@/lib/utils";

export function ShareWorkspaceButton() {
  const setSignInOpen = useUiState((s) => s.setSignInOpen);
  const setAgentPanelOpen = useUiState((s) => s.setAgentPanelOpen);
  const { session, others, state } = useWorkspace();

  const inWorkspace = session !== null;
  const label = inWorkspace
    ? others.length > 0
      ? `${others.length + 1} here`
      : "Invite"
    : "Share";

  return (
    <Tooltip
      content={
        inWorkspace
          ? "Copy the invite link, or see who is in this workspace."
          : "Work on this report with other people and their agents."
      }
    >
      <button
        type="button"
        data-testid="share-workspace"
        aria-label={inWorkspace ? "Workspace members" : "Share this workspace"}
        onClick={() => {
          if (inWorkspace) setAgentPanelOpen(true);
          else setSignInOpen(true);
        }}
        className={cn(
          "hidden h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors md:inline-flex",
          inWorkspace && state === "live"
            ? "border-ok/30 bg-ok-soft text-ok"
            : "border-line text-muted-foreground hover:border-line-2 hover:text-foreground",
        )}
      >
        <UsersThree className="size-3.5" />
        {label}
      </button>
    </Tooltip>
  );
}
