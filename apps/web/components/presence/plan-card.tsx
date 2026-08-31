"use client";

/**
 * Floating agent plan card (E2): renders the plan shared via the
 * `present_plan` WebMCP tool — nothing renders unless the agent actually
 * called it. Steps tick as `update_plan_step` lands; once ALL steps are
 * done the card lingers 10s, then fades out (fade only — no fake activity).
 */

import { useEffect, useState } from "react";
import { Check, Robot, X } from "@phosphor-icons/react";
import { useDashboardStore } from "@/lib/dashboard-store";
import { cn } from "@/lib/utils";

const FADE_AFTER_ALL_DONE_MS = 10_000;

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-agent/15 text-agent">
          <Check weight="bold" className="presence-tick size-2.5" />
        </span>
      );
    case "failed":
      return (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <X weight="bold" className="presence-tick size-2.5" />
        </span>
      );
    case "active":
      return (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] border-agent/60">
          <span className="status-pulse size-1.5 rounded-full bg-agent" />
        </span>
      );
    default:
      return (
        <span className="size-4 shrink-0 rounded-full border-[1.5px] border-muted-foreground/35" />
      );
  }
}

export function PlanCard() {
  const plan = useDashboardStore((s) => s.presence.plan);
  const [fading, setFading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const updatedAt = plan?.updatedAt;
  const allDone =
    !!plan && plan.steps.length > 0 && plan.steps.every((st) => st.status === "done");

  // Any plan change (present_plan / update_plan_step) re-arms the card.
  useEffect(() => {
    setFading(false);
    setHidden(false);
  }, [updatedAt]);

  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => setFading(true), FADE_AFTER_ALL_DONE_MS);
    return () => clearTimeout(t);
  }, [allDone, updatedAt]);

  if (!plan || hidden) return null;
  const done = plan.steps.filter((st) => st.status === "done").length;

  return (
    <aside
      data-testid="plan-card"
      aria-label="Agent plan"
      onTransitionEnd={() => {
        if (fading) setHidden(true);
      }}
      className={cn(
        "presence-card-enter fixed right-4 top-[4.25rem] z-[29] w-72 rounded-xl border border-agent/25 bg-card/95 shadow-lg shadow-agent/5 backdrop-blur-md",
        "transition-[opacity,transform] duration-500",
        fading && "translate-y-1 opacity-0",
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border/60 px-3.5 py-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-agent/15 text-agent ring-1 ring-agent/25">
          <Robot weight="fill" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight">
            Kai
            <span className="ml-1.5 font-normal text-muted-foreground">
              · agent
            </span>
          </p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            {plan.title ?? "Working plan"}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] font-medium text-muted-foreground">
          {done}/{plan.steps.length}
        </span>
      </div>
      <ol className="space-y-1.5 px-3.5 py-2.5">
        {plan.steps.map((st, i) => (
          <li
            key={i}
            data-testid={`plan-step-${i}`}
            data-status={st.status}
            className="flex items-center gap-2"
          >
            <StepIcon status={st.status} />
            <span
              className={cn(
                "min-w-0 truncate text-xs leading-snug",
                st.status === "active"
                  ? "font-medium text-foreground"
                  : st.status === "pending"
                    ? "text-muted-foreground"
                    : st.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground",
              )}
            >
              {st.label}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
