"use client";

/**
 * Approvals — the full-page review queue. Everything on this page comes from a
 * real WebMCP call: `propose_insight` proposals and `request_decision`
 * questions. Approving runs the proposal's action through the normal command
 * layer (attributed to the agent, undoable). Nothing applies itself.
 */

import { useEffect, useMemo, useState } from "react";
import { Question, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ChangeSetCard } from "@/components/presence/change-set-card";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { DecisionRequest, Insight } from "@kontier-ri/studio";
import { formatAgo } from "@/lib/format";
import {
  ActionButton,
  Avatar,
  Card,
  EmptyPanel,
  PageHeader,
  Pill,
  WorkspacePage,
} from "./primitives";

const SEVERITY_TONE = {
  info: "accent",
  warn: "warn",
  critical: "danger",
} as const;

const ACTION_LABEL: Record<string, string> = {
  add_tile: "adds a tile",
  add_annotation: "adds an annotation",
  set_filter: "sets a dashboard filter",
};

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ProposalCard({ insight, now }: { insight: Insight; now: number | null }) {
  const acceptInsight = useDashboardStore((s) => s.acceptInsight);
  const dismissInsight = useDashboardStore((s) => s.dismissInsight);
  const undo = useDashboardStore((s) => s.undo);
  const scope = useDashboardStore(
    (s) => s.doc.tiles.find((t) => t.id === insight.tileId)?.title,
  );

  const approve = () => {
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
    } else {
      toast(`Accepted: “${insight.title}”`);
    }
  };

  const effect = insight.suggestedAction
    ? `Approving ${ACTION_LABEL[insight.suggestedAction.kind] ?? insight.suggestedAction.kind} on this dashboard — attributed to the agent and undoable.`
    : "This proposal carries no change. Approving only records that you accepted it.";

  return (
    <Card
      className="flex items-start gap-4 px-5 py-[18px]"
      data-testid="approval-proposal"
    >
      <Avatar tone={SEVERITY_TONE[insight.severity]} label="Agent proposal">
        <Sparkle weight="fill" className="size-4" />
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-semibold leading-snug">
            {insight.title}
          </h2>
          <Pill>{scope ?? "Dashboard"}</Pill>
          {insight.severity === "info" ? null : (
            <Pill tone={SEVERITY_TONE[insight.severity]}>
              {insight.severity === "critical" ? "Critical" : "Warning"}
            </Pill>
          )}
        </div>
        <p className="text-[14px] leading-[1.5] text-muted-foreground">
          {insight.body}
        </p>
        <p className="text-[12.5px] leading-snug text-faint">
          Browser agent · propose_insight
          {now == null ? "" : ` · ${formatAgo(insight.at, now)}`} · {effect}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <ActionButton
          variant="primary"
          onClick={approve}
          data-testid="approve-proposal"
          aria-label={`Approve proposal: ${insight.title}`}
        >
          Approve
        </ActionButton>
        <ActionButton
          onClick={() => dismissInsight(insight.id)}
          data-testid="reject-proposal"
          aria-label={`Reject proposal: ${insight.title}`}
        >
          Reject
        </ActionButton>
      </div>
    </Card>
  );
}

function DecisionCard({
  decision,
  now,
}: {
  decision: DecisionRequest;
  now: number | null;
}) {
  const answerDecision = useDashboardStore((s) => s.answerDecision);
  const dismissDecision = useDashboardStore((s) => s.dismissDecision);
  const [note, setNote] = useState("");

  const answer = (optionId: string, label: string) => {
    const result = answerDecision(decision.id, optionId, note.trim() || undefined);
    if (!result.ok) {
      toast.error(result.conflict ? result.hint : result.error);
      return;
    }
    toast(`Answered: “${label}”`);
  };

  return (
    <Card
      className="flex items-start gap-4 px-5 py-[18px]"
      data-testid="approval-decision"
    >
      <Avatar label="Agent decision request">
        <Question weight="bold" className="size-4" />
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-semibold leading-snug">
            {decision.question}
          </h2>
          <Pill>Decision</Pill>
        </div>
        <p className="text-[14px] leading-[1.5] text-muted-foreground">
          {decision.context}
        </p>
        <p className="text-[12.5px] leading-snug text-faint">
          Browser agent · request_decision
          {now == null ? "" : ` · ${formatAgo(decision.createdAt, now)}`}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {decision.options.map((option) => (
            <ActionButton
              key={option.id}
              variant={
                decision.recommendedOptionId === option.id ? "primary" : "outline"
              }
              onClick={() => answer(option.id, option.label)}
              data-testid={`decision-option-${option.id}`}
              title={option.description}
              aria-label={`Answer “${decision.question}” with ${option.label}${
                decision.recommendedOptionId === option.id
                  ? " (the agent's recommendation)"
                  : ""
              }`}
            >
              {option.label}
              {decision.recommendedOptionId === option.id ? (
                <span className="text-[11.5px] opacity-80">· agent pick</span>
              ) : null}
            </ActionButton>
          ))}
        </div>
        {decision.options.some((option) => option.description) ? (
          <ul className="mt-1 flex flex-col gap-1">
            {decision.options
              .filter((option) => option.description)
              .map((option) => (
                <li key={option.id} className="text-[12.5px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {option.label}
                  </span>{" "}
                  — {option.description}
                </li>
              ))}
          </ul>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`note-${decision.id}`}>
            Optional note for the agent about “{decision.question}”
          </label>
          <input
            id={`note-${decision.id}`}
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional note for the agent"
            className="h-[34px] min-w-0 flex-1 rounded-lg border border-line-2 bg-surface px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent-mid"
          />
          <ActionButton
            onClick={() => dismissDecision(decision.id)}
            aria-label={`Dismiss decision: ${decision.question}`}
          >
            Dismiss
          </ActionButton>
        </div>
      </div>
    </Card>
  );
}

export function ApprovalsView() {
  const insights = useDashboardStore((s) => s.presence.insights);
  const decisions = useDashboardStore((s) => s.presence.decisions);
  const changeSets = useDashboardStore((s) => s.presence.changeSets);
  const now = useNow();

  const proposed = useMemo(
    () => insights.filter((i) => i.state === "proposed"),
    [insights],
  );
  const pendingDecisions = useMemo(
    () => decisions.filter((d) => d.status === "pending"),
    [decisions],
  );
  const resolved = useMemo(
    () => [
      ...insights
        .filter((i) => i.state !== "proposed")
        .map((i) => ({
          id: i.id,
          title: i.title,
          at: i.at,
          outcome: i.state === "accepted" ? "Approved" : "Rejected",
          ok: i.state === "accepted",
        })),
      ...decisions
        .filter((d) => d.status !== "pending")
        .map((d) => ({
          id: d.id,
          title: d.question,
          at: d.updatedAt,
          outcome:
            d.status === "answered"
              ? `Answered: ${
                  d.options.find((o) => o.id === d.answer?.optionId)?.label ??
                  d.answer?.optionId ??
                  "option"
                }`
              : "Dismissed",
          ok: d.status === "answered",
        })),
      ...changeSets
        .filter((set) => set.status !== "proposed")
        .map((set) => ({
          id: set.id,
          title: set.title,
          at: set.updatedAt,
          outcome:
            set.status === "rejected"
              ? "Rejected"
              : set.status === "partially_applied"
                ? `Applied ${set.appliedActionIndexes?.length ?? 0} of ${set.actions.length}`
                : `Applied ${set.actions.length} changes`,
          ok: set.status !== "rejected",
        })),
    ],
    [insights, decisions, changeSets],
  ).sort((a, b) => b.at - a.at);

  const pendingChangeSets = useMemo(
    () => changeSets.filter((set) => set.status === "proposed"),
    [changeSets],
  );
  const pending =
    proposed.length + pendingDecisions.length + pendingChangeSets.length;

  return (
    <WorkspacePage label="Approvals" testId="approvals-view" className="max-w-[980px]">
      <PageHeader
        title="Approvals"
        subtitle="Changes proposed by connected agents. Nothing here is applied until you approve it."
      />

      {pending === 0 ? (
        <EmptyPanel>
          Nothing waiting. Agents will file new proposals here.
        </EmptyPanel>
      ) : (
        <div className="flex flex-col gap-3.5">
          {pendingDecisions.map((decision) => (
            <DecisionCard key={decision.id} decision={decision} now={now} />
          ))}
          {pendingChangeSets.map((changeSet) => (
            <ChangeSetCard key={changeSet.id} changeSet={changeSet} variant="page" />
          ))}
          {proposed.map((insight) => (
            <ProposalCard key={insight.id} insight={insight} now={now} />
          ))}
        </div>
      )}

      {resolved.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[15px] font-semibold">Already decided</h2>
          <Card className="overflow-hidden">
            <ul>
              {resolved.slice(0, 12).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-b border-line px-[18px] py-2.5 text-[14px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-[12px] text-faint">
                    {now == null ? "" : formatAgo(item.at, now)}
                  </span>
                  <Pill tone={item.ok ? "ok" : "neutral"}>{item.outcome}</Pill>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </WorkspacePage>
  );
}
