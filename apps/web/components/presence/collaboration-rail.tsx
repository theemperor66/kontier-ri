"use client";

/**
 * Agent panel (product design: 340px right column). Two tabs — Suggestions
 * (the shared brief, the live plan, and everything awaiting your decision)
 * and Activity (the real command log with undo). Nothing renders here unless
 * a real WebMCP call or a human action produced it.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ClipboardText,
  Compass,
  Pause,
  Play,
  Scan,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useDashboardStore } from "@/lib/dashboard-store";
import { ChangeSetQueue } from "@/components/presence/change-set-card";
import { useUiState } from "@/lib/ui-state";
import { useWebMCPRegistry } from "@/lib/webmcp-registry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatAgo } from "@/lib/format";

const STARTERS = [
  "Explain the March churn spike and show the evidence.",
  "Find the biggest preventable revenue leak this quarter.",
  "Review this dashboard and flag decisions that need my judgment.",
] as const;

const PICKUP_PROMPT =
  "Pick up the active brief in Kontier RI. Read get_work_context first, share a plan, and use request_decision when my judgment is needed.";

function phaseLabel(phase: string): string {
  switch (phase) {
    case "ready":
      return "Brief ready";
    case "planning":
      return "Planning";
    case "working":
      return "Investigating";
    case "review":
      return "Needs review";
    case "complete":
      return "Complete";
    case "paused":
      return "Paused";
    default:
      return phase;
  }
}

function SectionCard({
  children,
  tone = "line",
  testId,
}: {
  children: React.ReactNode;
  tone?: "line" | "accent";
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-[10px] border px-3.5 py-3",
        tone === "accent" ? "border-accent-mid bg-accent/60" : "border-line bg-card",
      )}
    >
      {children}
    </div>
  );
}

function BriefBlock() {
  const session = useDashboardStore((s) => s.presence.session);
  const startWorkSession = useDashboardStore((s) => s.startWorkSession);
  const pauseWorkSession = useDashboardStore((s) => s.pauseWorkSession);
  const resumeWorkSession = useDashboardStore((s) => s.resumeWorkSession);
  const [draft, setDraft] = useState<string>(STARTERS[0]);
  const [reopen, setReopen] = useState(false);

  const start = (objective: string) => {
    const trimmed = objective.trim();
    if (!trimmed) return;
    const result = startWorkSession(trimmed);
    if (!result.ok) {
      toast.error(result.conflict ? result.hint : result.error);
      return;
    }
    setReopen(false);
    toast.success("Brief shared with your browser agent.");
  };

  const copyPickup = () => {
    void navigator.clipboard
      .writeText(PICKUP_PROMPT)
      .then(() => toast.success("Handoff prompt copied."))
      .catch(() => toast.error("Could not access the clipboard."));
  };

  if (!session || reopen) {
    return (
      <SectionCard>
        <h3 className="text-sm font-semibold">Give the work a finish line</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Your agent reads this brief, the live selection and your recent edits
          through <code className="font-mono text-[11px]">get_work_context</code>.
        </p>
        <textarea
          data-testid="work-brief-input"
          aria-label="Investigation brief"
          value={draft}
          rows={3}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          className="mt-3 w-full resize-none rounded-lg border border-line bg-background px-2.5 py-2 text-[13px] leading-relaxed outline-none transition-colors focus:border-accent-mid focus:ring-2 focus:ring-ring/20"
          placeholder="What should the agent resolve?"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            className="h-[30px] flex-1 justify-between"
            data-testid="start-work-session"
            disabled={!draft.trim()}
            onClick={() => start(draft)}
          >
            Share brief
            <ArrowRight className="size-3.5" />
          </Button>
          {session ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-[30px]"
              onClick={() => setReopen(false)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        {!session ? (
          <div className="mt-3 space-y-0.5 border-t border-line pt-2.5">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => setDraft(starter)}
                className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {starter}
              </button>
            ))}
          </div>
        ) : null}
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
          <span className="status-pulse size-1.5 rounded-full bg-accent-strong" />
          {phaseLabel(session.phase)}
        </span>
        {session.phase !== "complete" ? (
          <button
            type="button"
            onClick={() =>
              session.phase === "paused" ? resumeWorkSession() : pauseWorkSession()
            }
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {session.phase === "paused" ? (
              <>
                <Play className="size-3" /> Resume
              </>
            ) : (
              <>
                <Pause className="size-3" /> Pause
              </>
            )}
          </button>
        ) : null}
      </div>
      <h3
        data-testid="active-work-objective"
        className="mt-2.5 text-sm font-semibold leading-snug"
      >
        {session.objective}
      </h3>
      {session.phase === "complete" && session.summary ? (
        <>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {session.summary}
          </p>
          {session.outcomes.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {session.outcomes.map((outcome) => (
                <li key={outcome} className="flex items-start gap-2 text-[13px]">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  <span>{outcome}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-[30px] flex-1 justify-between text-[12.5px]"
          data-testid="copy-handoff-prompt"
          onClick={copyPickup}
        >
          Copy handoff prompt
          <ClipboardText className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-[30px] text-[12.5px]"
          onClick={() => {
            setDraft(session.phase === "complete" ? "" : session.objective);
            setReopen(true);
          }}
        >
          {session.phase === "complete" ? "New brief" : "Edit"}
        </Button>
      </div>
    </SectionCard>
  );
}

function FocusBlock() {
  const selectedTitle = useDashboardStore((s) =>
    s.doc.tiles.find((tile) => tile.id === s.selectedTileId)?.title,
  );
  const brushed = useDashboardStore((s) => s.brushedRange);
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);
  const activePage = useDashboardStore((s) =>
    s.doc.pages.find((page) => page.id === s.doc.activePageId)?.name,
  );
  const protectedEdits = useDashboardStore((s) => s.recentHumanEdits.length);

  const focus = brushed
    ? `${brushed.from} → ${brushed.to}`
    : selectedTitle
      ? `“${selectedTitle}”`
      : crossFilter
        ? `${crossFilter.column} = ${String(crossFilter.value)}`
        : "No mark or tile selected";

  return (
    <SectionCard>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">What the agent sees</h3>
        <span className="text-[11px] text-faint">{activePage}</span>
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
          {brushed ? <Scan className="size-3" /> : <Compass className="size-3" />}
        </span>
        <div className="min-w-0">
          <p data-testid="agent-focus-summary" className="truncate text-[13px] font-medium">
            {focus}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {protectedEdits > 0
              ? `${protectedEdits} recent ${protectedEdits === 1 ? "edit" : "edits"} protected from overwrite`
              : "Live page context"}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

function PlanBlock() {
  const plan = useDashboardStore((s) => s.presence.plan);
  if (!plan) return null;
  const done = plan.steps.filter((step) => step.status === "done").length;
  return (
    <SectionCard testId="rail-plan">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">{plan.title ?? "Working plan"}</h3>
        <span className="font-mono text-[10px] text-faint">
          {done} of {plan.steps.length} complete
        </span>
      </div>
      <ol className="mt-2.5 space-y-2">
        {plan.steps.map((step, index) => (
          <li key={`${step.label}-${index}`} className="flex items-start gap-2.5">
            <span
              className={cn(
                "mt-px grid size-4 shrink-0 place-items-center rounded-full border",
                step.status === "done"
                  ? "border-accent-mid bg-accent text-accent-foreground"
                  : step.status === "active"
                    ? "border-accent-strong text-accent-strong"
                    : step.status === "failed"
                      ? "border-danger text-danger"
                      : "border-line-2 text-faint",
              )}
            >
              {step.status === "done" ? (
                <Check weight="bold" className="size-2.5" />
              ) : step.status === "active" ? (
                <span className="status-pulse size-1.5 rounded-full bg-accent-strong" />
              ) : step.status === "failed" ? (
                <X className="size-2.5" />
              ) : null}
            </span>
            <span
              className={cn(
                "text-[13px] leading-snug",
                step.status === "active"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function DecisionBlock() {
  const decisions = useDashboardStore((s) => s.presence.decisions);
  const answerDecision = useDashboardStore((s) => s.answerDecision);
  const dismissDecision = useDashboardStore((s) => s.dismissDecision);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = decisions.filter((decision) => decision.status === "pending");
  if (pending.length === 0) return null;

  return (
    <div data-testid="decision-queue" className="flex flex-col gap-2.5">
      <h3 className="px-0.5 text-xs font-semibold">Your judgment is needed</h3>
      {pending.map((decision) => (
        <SectionCard key={decision.id} tone="accent" testId="decision-request">
          <h4 className="text-sm font-semibold leading-snug">{decision.question}</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {decision.context}
          </p>
          <div className="mt-2.5 space-y-1.5">
            {decision.options.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`decision-option-${option.id}`}
                onClick={() => {
                  const result = answerDecision(
                    decision.id,
                    option.id,
                    notes[decision.id]?.trim() || undefined,
                  );
                  if (!result.ok) {
                    toast.error(result.conflict ? result.hint : result.error);
                  }
                }}
                className="flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2 text-left transition-colors hover:border-accent-mid hover:bg-accent/40"
              >
                <span>
                  <span className="block text-[13px] font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {decision.recommendedOptionId === option.id ? (
                  <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">
                    Agent pick
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <input
            value={notes[decision.id] ?? ""}
            onChange={(event) =>
              setNotes((current) => ({ ...current, [decision.id]: event.target.value }))
            }
            maxLength={300}
            placeholder="Optional note for the agent"
            aria-label={`Note for decision: ${decision.question}`}
            className="mt-2 h-8 w-full rounded-lg border border-line bg-card px-2.5 text-xs outline-none focus:border-accent-mid focus:ring-2 focus:ring-ring/20"
          />
          <button
            type="button"
            onClick={() => dismissDecision(decision.id)}
            className="mt-2 cursor-pointer text-[11.5px] text-muted-foreground underline decoration-line-2 underline-offset-4 transition-colors hover:text-foreground"
          >
            Dismiss this question
          </button>
        </SectionCard>
      ))}
    </div>
  );
}

function ProposalBlock() {
  const insights = useDashboardStore((s) => s.presence.insights);
  const acceptInsight = useDashboardStore((s) => s.acceptInsight);
  const dismissInsight = useDashboardStore((s) => s.dismissInsight);
  const undo = useDashboardStore((s) => s.undo);
  const proposed = insights.filter((insight) => insight.state === "proposed");
  if (proposed.length === 0) return null;

  return (
    <div data-testid="proposal-queue" className="flex flex-col gap-2.5">
      <h3 className="px-0.5 text-xs font-semibold">Proposed changes</h3>
      {proposed.map((insight) => (
        <SectionCard key={insight.id}>
          <div className="flex items-center gap-2">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-[10.5px] font-semibold text-accent-foreground">
              AI
            </span>
            <span className="flex-1 truncate text-[12.5px] text-muted-foreground">
              Browser agent
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px]",
                insight.severity === "critical"
                  ? "bg-danger-soft text-danger"
                  : insight.severity === "warn"
                    ? "bg-warn-soft text-warn"
                    : "bg-surface-2 text-muted-foreground",
              )}
            >
              {insight.suggestedAction ? "Canvas" : "Note"}
            </span>
          </div>
          <h4 className="mt-2 text-sm font-semibold leading-snug">{insight.title}</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {insight.body}
          </p>
          <div className="mt-2.5 flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-[30px] text-[12.5px]"
              data-testid="accept-rail-proposal"
              onClick={() => {
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
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-[30px] text-[12.5px]"
              onClick={() => dismissInsight(insight.id)}
            >
              Reject
            </Button>
            <span className="ml-auto text-[11.5px] text-faint">
              {new Date(insight.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

function AnsweredBlock() {
  const decisions = useDashboardStore((s) => s.presence.decisions);
  const answered = decisions
    .filter((decision) => decision.status === "answered")
    .slice(-3)
    .reverse();
  if (answered.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 px-0.5">
      <h3 className="text-xs font-semibold">Decisions you made</h3>
      <ul className="space-y-2">
        {answered.map((decision) => {
          const option = decision.options.find(
            (candidate) => candidate.id === decision.answer?.optionId,
          );
          return (
            <li key={decision.id} className="flex items-start gap-2 text-[12.5px]">
              <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
              <span className="min-w-0">
                <span className="block truncate text-muted-foreground">
                  {decision.question}
                </span>
                <span className="font-medium">
                  {option?.label ?? decision.answer?.optionId}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActivityTab() {
  const activity = useDashboardStore((s) => s.activityLog);
  const undoStack = useDashboardStore((s) => s.undoStack);
  const undo = useDashboardStore((s) => s.undo);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const undoableId = undoStack[undoStack.length - 1]?.id;

  if (activity.length === 0) {
    return (
      <p className="rounded-[10px] border border-dashed border-line-2 px-4 py-7 text-center text-[13px] leading-relaxed text-muted-foreground">
        No changes yet. Move a tile or hand your agent the brief.
      </p>
    );
  }

  return (
    <ul>
      {activity.map((entry) => (
        <li
          key={entry.id}
          className={cn(
            "flex gap-2.5 border-b border-line py-2.5",
            entry.undone && "opacity-50",
          )}
        >
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-[7px] text-[10.5px] font-semibold",
              entry.by === "agent"
                ? "bg-accent text-accent-foreground"
                : "bg-surface-2 text-muted-foreground",
            )}
          >
            {entry.by === "agent" ? "AI" : "You"}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("text-[13.5px] leading-snug", entry.undone && "line-through")}>
              {entry.label}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
              <span>{formatAgo(entry.at, now)}</span>
              <span>·</span>
              <span>{entry.by === "agent" ? "Web MCP" : "Kontier RI"}</span>
              {entry.undone ? <span className="text-warn">· undone</span> : null}
            </p>
          </div>
          {entry.id === undoableId && !entry.undone ? (
            <Button
              size="sm"
              variant="outline"
              className="h-[26px] shrink-0 self-start text-[12px]"
              aria-label={`Undo: ${entry.label}`}
              onClick={() => undo()}
            >
              Undo
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function PanelFooter() {
  const { runtimeAvailable, readyCount, failedTools } = useWebMCPRegistry();
  const failed = failedTools.length > 0;
  const connected = runtimeAvailable && readyCount > 0 && !failed;
  return (
    <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "size-[7px] shrink-0 rounded-full",
          failed ? "bg-danger" : connected ? "bg-ok" : "bg-faint",
        )}
      />
      <span className="truncate">
        {failed
          ? `Web MCP · ${failedTools.length} tool ${failedTools.length === 1 ? "error" : "errors"}`
          : connected
            ? `Web MCP · ${readyCount} tools ready · approval required`
            : "Web MCP · no agent connected · approval required"}
      </span>
    </div>
  );
}

export function CollaborationRail({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const tab = useUiState((s) => s.agentPanelTab);
  const setTab = useUiState((s) => s.setAgentPanelTab);
  const pendingCount = useDashboardStore(
    (s) =>
      s.presence.decisions.filter((decision) => decision.status === "pending").length +
      s.presence.insights.filter((insight) => insight.state === "proposed").length +
      s.presence.changeSets.filter((set) => set.status === "proposed").length,
  );
  const planUpdatedAt = useDashboardStore((s) => s.presence.plan?.updatedAt ?? 0);
  const sessionUpdatedAt = useDashboardStore((s) => s.presence.session?.updatedAt ?? 0);
  const signal = Math.max(planUpdatedAt, sessionUpdatedAt);
  const previousSignal = useRef(signal);

  // Agent work reveals the panel; the parent owns the open state so idle
  // timers can never fake activity here.
  useEffect(() => {
    if (signal > previousSignal.current || pendingCount > 0) {
      window.dispatchEvent(new CustomEvent("kontier:agent-work"));
    }
    previousSignal.current = signal;
  }, [pendingCount, signal]);

  useEffect(() => {
    if (pendingCount > 0) setTab("suggestions");
  }, [pendingCount, setTab]);

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close agent workspace"
          className="fixed inset-0 z-40 bg-nav/50 lg:hidden"
          onClick={onClose}
        />
      ) : null}
      <aside
        data-testid="collaboration-rail"
        aria-label="Agent workspace"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(24rem,100vw)] flex-col border border-line bg-card transition-transform duration-200 ease-out",
          "lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:rounded-t-xl lg:border-b-0",
          open ? "translate-x-0" : "translate-x-full lg:hidden",
        )}
      >
        <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
          <button
            type="button"
            data-testid="rail-tab-suggestions"
            onClick={() => setTab("suggestions")}
            className={cn(
              "-mb-px flex h-9 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
              tab === "suggestions"
                ? "border-accent-strong text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Suggestions
            {pendingCount > 0 ? (
              <span className="rounded-full bg-primary px-[7px] py-px text-[11px] font-semibold text-primary-foreground">
                {pendingCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            data-testid="rail-tab-activity"
            onClick={() => setTab("activity")}
            className={cn(
              "-mb-px flex h-9 cursor-pointer items-center border-b-2 px-3 text-sm font-medium transition-colors",
              tab === "activity"
                ? "border-accent-strong text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Activity
          </button>
          <button
            type="button"
            aria-label="Close agent workspace"
            onClick={onClose}
            className="ml-auto grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain p-3.5">
          {tab === "suggestions" ? (
            <>
              <BriefBlock />
              <DecisionBlock />
              <ChangeSetQueue />
              <ProposalBlock />
              <PlanBlock />
              <FocusBlock />
              <AnsweredBlock />
              <div className="mt-auto flex items-start gap-2 pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" />
                <span>
                  Raw rows stay in this tab. Agent edits are attributed and
                  undoable, and your last edits are protected from overwrite.
                </span>
              </div>
            </>
          ) : (
            <div data-testid="activity-feed">
              <ActivityTab />
            </div>
          )}
        </div>
        <PanelFooter />
      </aside>
    </>
  );
}
