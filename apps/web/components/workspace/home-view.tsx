"use client";

/**
 * Home — the workspace landing surface from the product design, filled with
 * facts this build can actually prove: live engine state, the real approval
 * queue, the real work session and the real command log. No invented KPIs.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ClockCounterClockwise,
  Function as FunctionIcon,
  SquaresFour,
  StackSimple,
} from "@phosphor-icons/react";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { DashboardEntry } from "@/lib/dashboards";
import { currentDashboardId, listDashboards } from "@/lib/dashboards";
import { formatAgo } from "@/lib/format";
import { useUiState } from "@/lib/ui-state";
import { clearInvestigations, useInvestigations } from "@/lib/investigations";
import { useLiveDatasets, totalRows } from "@/lib/workspace-data";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  Card,
  CardTitle,
  PageHeader,
  Pill,
  StatCard,
  StatusDot,
  WorkspacePage,
} from "./primitives";

const PHASE_LABEL: Record<string, string> = {
  ready: "Brief ready",
  planning: "Planning",
  working: "Investigating",
  review: "Needs review",
  complete: "Complete",
  paused: "Paused",
};

function HeroCard({
  tint,
  label,
  value,
  valueClass,
  note,
  footer,
}: {
  tint: "mint" | "peach" | "lav";
  label: string;
  value: string;
  valueClass?: string;
  note?: string;
  footer?: React.ReactNode;
}) {
  const bg =
    tint === "mint" ? "bg-mint" : tint === "peach" ? "bg-peach" : "bg-lav";
  return (
    <div
      className={cn(
        "flex min-h-[200px] flex-col rounded-xl px-6 py-[22px]",
        bg,
      )}
    >
      <span className="text-[15px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "mt-2 text-[36px] font-semibold leading-[1.05] tracking-[-0.03em]",
          valueClass,
        )}
      >
        {value}
      </span>
      {note ? (
        <span className="mt-1.5 text-[13.5px] leading-[1.45] text-muted-foreground">
          {note}
        </span>
      ) : null}
      <div className="flex-1" />
      {footer ? (
        <span className="text-[14px] text-muted-foreground">{footer}</span>
      ) : null}
    </div>
  );
}

export function HomeView() {
  const setView = useUiState((s) => s.setView);
  const doc = useDashboardStore((s) => s.doc);
  const activityLog = useDashboardStore((s) => s.activityLog);
  const insights = useDashboardStore((s) => s.presence.insights);
  const decisions = useDashboardStore((s) => s.presence.decisions);
  const session = useDashboardStore((s) => s.presence.session);
  const { datasets, status, statusDetail } = useLiveDatasets(doc.views.length);

  const [now, setNow] = useState<number | null>(null);
  const [saved, setSaved] = useState<DashboardEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  // localStorage + clock read after mount only (static export / hydration).
  useEffect(() => {
    setNow(Date.now());
    setSaved(listDashboards());
    setCurrentId(currentDashboardId());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [activityLog.length, doc.title]);

  const proposed = useMemo(
    () => insights.filter((i) => i.state === "proposed"),
    [insights],
  );
  const pendingDecisions = useMemo(
    () => decisions.filter((d) => d.status === "pending"),
    [decisions],
  );
  const pending = proposed.length + pendingDecisions.length;

  const agentChanges = activityLog.filter((e) => e.by === "agent").length;
  const tileCount = doc.pages.reduce((sum, page) => sum + page.tiles.length, 0);
  const columnCount = datasets.reduce((sum, d) => sum + d.columns.length, 0);
  const rows = totalRows(datasets);

  const subtitle =
    activityLog.length === 0
      ? `No changes logged on “${doc.title}” yet · ${pending === 0 ? "nothing awaiting approval" : `${pending} awaiting your approval`}`
      : `Agents made ${agentChanges} of ${activityLog.length} logged ${activityLog.length === 1 ? "change" : "changes"} on “${doc.title}” · ${pending === 0 ? "nothing awaiting approval" : `${pending} awaiting your approval`}`;

  const engine =
    status === "ready"
      ? {
          value: `${datasets.length} ${datasets.length === 1 ? "dataset" : "datasets"}`,
          note: undefined,
          tone: undefined,
        }
      : status === "booting"
        ? { value: "Loading…", note: statusDetail, tone: undefined }
        : { value: "Engine error", note: statusDetail, tone: "text-danger" };

  return (
    <WorkspacePage label="Home" testId="home-view">
      <PageHeader title="Welcome to Kontier RI" subtitle={subtitle} />

      <div className="grid gap-3.5 md:grid-cols-3">
        <HeroCard
          tint="mint"
          label="Data engine"
          value={engine.value}
          valueClass={cn(
            engine.tone,
            status !== "ready" && "text-[28px] tracking-[-0.02em]",
          )}
          note={engine.note}
          footer={
            status === "ready" ? (
              <>
                Rows: <span className="text-foreground">{rows.toLocaleString("en-US")}</span>
                &nbsp;&nbsp; Columns:{" "}
                <span className="text-foreground">{columnCount}</span>
              </>
            ) : (
              "DuckDB-WASM runs inside this tab; raw rows never leave it."
            )
          }
        />
        <HeroCard
          tint="peach"
          label="Awaiting your approval"
          value={pending === 0 ? "Nothing waiting" : String(pending)}
          valueClass={
            pending === 0 ? "text-[28px] tracking-[-0.02em]" : "text-warn"
          }
          note={
            pending === 0
              ? "Agent proposals land here first. Nothing is applied until you approve it."
              : undefined
          }
          footer={
            pending === 0 ? undefined : (
              <>
                Proposals:{" "}
                <span className="text-foreground">{proposed.length}</span>
                &nbsp;&nbsp; Decisions:{" "}
                <span className="text-foreground">
                  {pendingDecisions.length}
                </span>
              </>
            )
          }
        />
        <HeroCard
          tint="lav"
          label="Work session"
          value={
            session ? (PHASE_LABEL[session.phase] ?? session.phase) : "No brief yet"
          }
          valueClass="text-[28px] tracking-[-0.02em]"
          note={session ? session.objective : undefined}
          footer={
            session
              ? now == null
                ? "Started in this tab"
                : `Updated ${formatAgo(session.updatedAt, now)}`
              : "Write a brief in the agent panel so a connected agent knows the goal."
          }
        />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<SquaresFour className="size-[18px]" weight="bold" />}
          label={tileCount === 1 ? "Tile" : "Tiles"}
          value={tileCount}
        />
        <StatCard
          icon={<StackSimple className="size-[18px]" weight="bold" />}
          label={doc.pages.length === 1 ? "Page" : "Pages"}
          value={doc.pages.length}
          tone="ok"
        />
        <StatCard
          icon={<FunctionIcon className="size-[18px]" weight="bold" />}
          label="Measures & views"
          value={`${doc.calculatedFields.length} · ${doc.views.length}`}
          tone="warn"
        />
        <StatCard
          icon={<ClockCounterClockwise className="size-[18px]" weight="bold" />}
          label="Logged changes"
          value={activityLog.length}
          tone="neutral"
        />
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 px-[22px] py-5">
          <CardTitle
            size="lg"
            sub={
              saved.length > 0
                ? "Saved in this browser."
                : "Pages in the dashboard you have open."
            }
          >
            Recent dashboards
          </CardTitle>
          <ul className="flex flex-col">
            {saved.length > 0
              ? saved.slice(0, 5).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-2.5 border-b border-line py-1.5 text-[14px] last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {entry.name}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {now == null ? "" : `edited ${formatAgo(entry.updatedAt, now)}`}
                    </span>
                    <Pill tone={entry.id === currentId ? "accent" : "neutral"}>
                      {entry.id === currentId
                        ? "open"
                        : `${entry.tileCount} ${entry.tileCount === 1 ? "tile" : "tiles"}`}
                    </Pill>
                  </li>
                ))
              : doc.pages.map((page) => (
                  <li
                    key={page.id}
                    className="flex items-center gap-2.5 border-b border-line py-1.5 text-[14px] last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {page.name}
                    </span>
                    <Pill tone={page.id === doc.activePageId ? "accent" : "neutral"}>
                      {page.id === doc.activePageId
                        ? "active page"
                        : `${page.tiles.length} ${page.tiles.length === 1 ? "tile" : "tiles"}`}
                    </Pill>
                  </li>
                ))}
          </ul>
          <ActionButton
            className="self-start"
            onClick={() => setView("canvas")}
            data-testid="home-open-canvas"
          >
            Open “{doc.title}”
          </ActionButton>
        </Card>

        <Card className="flex flex-col gap-3 px-[22px] py-5">
          <CardTitle
            size="lg"
            sub="Real propose_insight and request_decision calls. Nothing applies itself."
          >
            Awaiting approval
          </CardTitle>
          {pending === 0 ? (
            <p className="py-1 text-[14px] leading-relaxed text-muted-foreground">
              Nothing waiting. Agents connected over WebMCP file proposals and
              decisions here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {proposed.slice(0, 4).map((insight) => (
                <li
                  key={insight.id}
                  className="flex items-center gap-2.5 border-b border-line py-1.5 text-[14px] last:border-b-0"
                >
                  <StatusDot
                    tone={
                      insight.severity === "critical"
                        ? "danger"
                        : insight.severity === "warn"
                          ? "warn"
                          : "accent"
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {insight.title}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {doc.tiles.find((t) => t.id === insight.tileId)?.title ??
                      "Dashboard"}
                  </span>
                </li>
              ))}
              {pendingDecisions.slice(0, 4).map((decision) => (
                <li
                  key={decision.id}
                  className="flex items-center gap-2.5 border-b border-line py-1.5 text-[14px] last:border-b-0"
                >
                  <StatusDot tone="accent" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {decision.question}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    Decision
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ActionButton
            variant="primary"
            className="self-start"
            onClick={() => setView("approvals")}
            data-testid="home-open-approvals"
          >
            {pending === 0 ? "Open approvals" : `Review all (${pending})`}
          </ActionButton>
        </Card>
      </div>

      <PastInvestigations />
    </WorkspacePage>
  );
}

/**
 * Completed work sessions kept in this browser: the brief, what the agent
 * concluded, and the decisions the human actually made.
 */
function PastInvestigations() {
  const records = useInvestigations();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [records.length]);
  if (records.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 px-[22px] py-5" data-testid="past-investigations">
      <CardTitle
        size="lg"
        sub="Completed work sessions kept in this browser, with the decisions you made."
      >
        Past investigations
      </CardTitle>
      <ul className="flex flex-col gap-3.5">
        {records.slice(0, 5).map((record) => (
          <li key={record.id} className="border-b border-line pb-3.5 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-[14px] font-medium">{record.objective}</span>
              <span className="text-[12px] text-muted-foreground">
                {record.dashboardTitle}
                {now == null ? "" : ` · ${formatAgo(record.completedAt, now)}`}
              </span>
            </div>
            {record.summary ? (
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
                {record.summary}
              </p>
            ) : null}
            {record.outcomes.length > 0 ? (
              <ul className="mt-1.5 flex flex-col gap-1">
                {record.outcomes.map((outcome) => (
                  <li key={outcome} className="text-[13px] text-muted-foreground">
                    · {outcome}
                  </li>
                ))}
              </ul>
            ) : null}
            {record.approvedChanges > 0 ? (
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {record.approvedChanges} approved{" "}
                {record.approvedChanges === 1 ? "change" : "changes"}
              </p>
            ) : null}
            {record.decisions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {record.decisions.map((decision) => (
                  <Pill key={decision.question} tone="accent">
                    {decision.answer}
                  </Pill>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => clearInvestigations()}
        className="self-start text-[12px] text-muted-foreground underline decoration-line-2 underline-offset-4 transition-colors hover:text-foreground"
      >
        Clear history
      </button>
    </Card>
  );
}
