"use client";

/**
 * WHAT: who else is in this workspace, and the link that puts them here.
 *
 * WHY it only ever shows real people: a peer appears in this list because the
 * server heard a heartbeat from them within its presence window. There is no
 * simulated colleague, no animated cursor for someone who is not there, and
 * no name this app invented. If the list is empty it says so.
 */

import { useState } from "react";
import { Check, Copy, LinkSimple, UsersThree, WifiSlash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-sync";
import { inviteUrl } from "@/lib/workspace-session";
import { cn } from "@/lib/utils";

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function WorkspacePeers() {
  const { session, state, error, others } = useWorkspace();
  const [copied, setCopied] = useState(false);

  if (!session) return null;

  const copy = () => {
    try {
      const url = inviteUrl(session);
      void navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        toast.success("Invite link copied. Anyone with it joins this workspace.");
        setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      toast.error("Could not read the clipboard in this browser.");
    }
  };

  return (
    <section
      data-testid="workspace-peers"
      className="rounded-[10px] border border-line bg-surface-2/60 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <UsersThree className="size-3.5" />
          In this workspace
        </span>
        <span
          data-testid="workspace-state"
          className={cn(
            "flex items-center gap-1.5 text-[11px]",
            state === "live" ? "text-ok" : state === "error" ? "text-destructive" : "text-faint",
          )}
        >
          {state === "error" ? <WifiSlash className="size-3" /> : null}
          <span
            className={cn(
              "size-[6px] rounded-full",
              state === "live" ? "status-pulse bg-ok" : state === "error" ? "bg-destructive" : "bg-faint",
            )}
          />
          {state === "live" ? "Live" : state === "connecting" ? "Connecting" : state === "error" ? "Offline" : "Local"}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span
          title="You"
          className="grid size-7 place-items-center rounded-full bg-accent text-[10.5px] font-semibold text-accent-foreground"
        >
          You
        </span>
        {others.map((peer) => (
          <span
            key={peer.actor}
            title={`${peer.label} — last seen just now`}
            data-testid="workspace-peer"
            className="grid size-7 place-items-center rounded-full bg-card text-[10.5px] font-semibold text-muted-foreground ring-1 ring-line"
          >
            {initials(peer.label)}
          </span>
        ))}
        {others.length === 0 ? (
          <span className="text-[12px] text-muted-foreground">
            Nobody else yet — send the link.
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[12px]"
          data-testid="copy-invite"
          onClick={copy}
        >
          {copied ? <Check className="size-3.5" /> : <LinkSimple className="size-3.5" />}
          {copied ? "Copied" : "Copy invite link"}
        </Button>
        <span className="min-w-0 truncate text-[11px] text-faint">
          {session.kind === "tenant" ? session.label : "Guest workspace"}
        </span>
      </div>

      {error && state === "error" ? (
        <p className="mt-2 text-[11.5px] leading-4 text-destructive">{error}</p>
      ) : null}
    </section>
  );
}
