import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import type {
  ColumnMeta,
  ColumnProfile,
  DataSource,
  DatasetMeta,
  QueryResult,
} from "@kontier-ri/datasource";
import {
  completeWorkInput,
  getWorkContextInput,
  requestDecisionInput,
} from "../src/schemas";
import { useDashboardStore } from "../src/store";
import { buildStaticTools, type ToolDefinition } from "../src/webmcp/tools";
import type { AddTileInput, RequestDecisionInput } from "../src/types";

const s = () => useDashboardStore.getState();
const signal = new AbortController().signal;

const decisionInput: RequestDecisionInput = {
  question: "Which segment should anchor the finding?",
  context: "Enterprise grew fastest, while self-serve represents more accounts.",
  options: [
    {
      id: "enterprise",
      label: "Enterprise",
      description: "Lead with the largest revenue movement.",
    },
    { id: "self_serve", label: "Self-serve" },
  ],
  recommendedOptionId: "enterprise",
};

const kpiInput: AddTileInput = {
  type: "kpi",
  title: "MRR",
  spec: {
    dataset: "invoices",
    measure: "amount",
    agg: "sum",
    format: "currency",
  },
};

class FakeDataSource implements DataSource {
  listDatasets(): Promise<DatasetMeta[]> {
    return Promise.resolve([]);
  }
  getSchema(): Promise<ColumnMeta[]> {
    return Promise.resolve([]);
  }
  runQuery(): Promise<QueryResult> {
    return Promise.resolve({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  }
  profileColumn(dataset: string, column: string): Promise<ColumnProfile> {
    return Promise.resolve({
      dataset,
      column,
      type: "VARCHAR",
      count: 0,
      nulls: 0,
      distinct: 0,
      min: null,
      max: null,
      topValues: [],
    });
  }
}

beforeEach(() => {
  s().resetDashboard();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("work-session lifecycle", () => {
  it("moves through honest phases and remains ephemeral/non-undoable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:00:00Z"));

    const started = s().startWorkSession("Explain the March revenue dip");
    expect(started).toMatchObject({ ok: true, sessionId: expect.any(String) });
    const sessionId = started.ok ? started.sessionId! : "";
    const createdAt = s().presence.session!.createdAt;
    expect(s().presence.session).toMatchObject({
      id: sessionId,
      objective: "Explain the March revenue dip",
      phase: "ready",
      outcomes: [],
      createdAt,
      updatedAt: createdAt,
    });
    expect(s().activityLog[0]).toMatchObject({ by: "human" });
    expect(s().undoStack).toHaveLength(0);

    vi.setSystemTime(new Date("2026-08-30T10:01:00Z"));
    expect(s().startWorkSession("Explain and annotate the March dip")).toEqual({
      ok: true,
      sessionId,
    });
    expect(s().presence.session).toMatchObject({
      id: sessionId,
      objective: "Explain and annotate the March dip",
      createdAt,
    });

    s().presentPlan({ steps: [{ label: "Profile cohorts" }] });
    expect(s().presence.session!.phase).toBe("planning");
    s().updatePlanStep(0, "active");
    expect(s().presence.session!.phase).toBe("working");

    const requested = s().requestDecision(decisionInput);
    expect(requested).toMatchObject({
      ok: true,
      decisionId: expect.stringMatching(/^decision_/),
    });
    expect(s().presence.session!.phase).toBe("review");
    const decisionId = requested.ok ? requested.decisionId! : "";
    expect(s().answerDecision(decisionId, "enterprise", "Use revenue impact.")).toEqual({
      ok: true,
      decisionId,
    });
    expect(s().presence.session!.phase).toBe("working");
    expect(s().presence.decisions[0]).toMatchObject({
      status: "answered",
      answer: { optionId: "enterprise", note: "Use revenue impact." },
    });

    s().updatePlanStep(0, "done");
    expect(s().presence.session!.phase).toBe("review");
    vi.setSystemTime(new Date("2026-08-30T10:05:00Z"));
    expect(
      s().completeWork("The dip is isolated to enterprise renewals.", [
        "Added a reviewed annotation.",
        "Recorded the chosen segment.",
      ]),
    ).toEqual({ ok: true, sessionId });
    expect(s().presence.session).toMatchObject({
      phase: "complete",
      summary: "The dip is isolated to enterprise renewals.",
      outcomes: ["Added a reviewed annotation.", "Recorded the chosen segment."],
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(s().undoStack).toHaveLength(0);
    expect(s().activityLog[0]).toMatchObject({ by: "agent" });
  });

  it("pauses and resumes to the phase implied by current work", () => {
    s().startWorkSession("Investigate churn");
    s().presentPlan({ steps: [{ label: "Profile churn", status: "active" }] });
    expect(s().pauseWorkSession()).toMatchObject({ ok: true });
    expect(s().presence.session!.phase).toBe("paused");
    expect(s().resumeWorkSession()).toMatchObject({ ok: true });
    expect(s().presence.session!.phase).toBe("working");
    expect(s().resumeWorkSession()).toMatchObject({ ok: false });
  });

  it("moves into review for a proposed insight and resumes after dismissal", () => {
    s().startWorkSession("Investigate churn");
    s().presentPlan({ steps: [{ label: "Profile churn", status: "active" }] });
    const proposed = s().proposeInsight({
      title: "Review this evidence",
      body: "The enterprise segment explains most of the movement.",
    });
    expect(s().presence.session!.phase).toBe("review");
    const insightId = proposed.ok ? proposed.insightId! : "";
    expect(s().dismissInsight(insightId)).toMatchObject({ ok: true });
    expect(s().presence.session!.phase).toBe("working");
  });

  it("starts a fresh collaboration context after a completed session", () => {
    s().startWorkSession("First brief");
    s().presentPlan({ steps: [{ label: "Work" }] });
    s().requestDecision(decisionInput);
    s().proposeInsight({ title: "Review", body: "Please review." });
    s().completeWork("Done.", []);
    const oldId = s().presence.session!.id;

    const next = s().startWorkSession("Second brief");
    expect(next).toMatchObject({ ok: true, sessionId: expect.any(String) });
    expect(next.ok && next.sessionId).not.toBe(oldId);
    expect(s().presence).toMatchObject({
      plan: null,
      insights: [],
      decisions: [],
      session: { objective: "Second brief", phase: "ready" },
    });
  });
});

describe("decision boundary validation", () => {
  it("rejects too few, duplicate, unknown recommendation, and extra fields", () => {
    expect(
      s().requestDecision({ ...decisionInput, options: [decisionInput.options[0]!] }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Invalid") });
    expect(
      s().requestDecision({
        ...decisionInput,
        options: [
          { id: "same", label: "One" },
          { id: "same", label: "Two" },
        ],
        recommendedOptionId: "same",
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Duplicate") });
    expect(
      s().requestDecision({
        ...decisionInput,
        recommendedOptionId: "not-an-option",
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("recommendedOptionId"),
    });
    expect(
      s().requestDecision({ ...decisionInput, surprise: true } as never),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Unrecognized") });
    expect(s().presence.decisions).toEqual([]);
  });

  it("validates the decision target and answer option, then prevents repeats", () => {
    expect(s().answerDecision("missing", "enterprise")).toMatchObject({
      ok: false,
      error: expect.stringContaining("missing"),
    });
    const requested = s().requestDecision(decisionInput);
    const id = requested.ok ? requested.decisionId! : "";
    expect(s().answerDecision(id, "missing-option")).toMatchObject({
      ok: false,
      error: expect.stringContaining("does not belong"),
    });
    expect(s().presence.decisions[0]!.status).toBe("pending");
    expect(s().answerDecision(id, "enterprise")).toMatchObject({ ok: true });
    expect(s().answerDecision(id, "self_serve")).toMatchObject({ ok: false });
    expect(s().dismissDecision(id)).toMatchObject({ ok: false });

    const second = s().requestDecision({
      ...decisionInput,
      question: "Keep the annotation?",
    });
    const secondId = second.ok ? second.decisionId! : "";
    expect(s().dismissDecision(secondId)).toEqual({
      ok: true,
      decisionId: secondId,
    });
    expect(s().presence.decisions[1]!.status).toBe("dismissed");
  });
});

describe("collaboration schemas", () => {
  it("request_decision is strict at every object level and enforces 2..5 options", () => {
    expect(requestDecisionInput.safeParse(decisionInput).success).toBe(true);
    expect(
      requestDecisionInput.safeParse({ ...decisionInput, unexpected: true }).success,
    ).toBe(false);
    expect(
      requestDecisionInput.safeParse({
        ...decisionInput,
        options: [
          { id: "a", label: "A", unexpected: true },
          { id: "b", label: "B" },
        ],
      }).success,
    ).toBe(false);
    expect(
      requestDecisionInput.safeParse({
        ...decisionInput,
        options: Array.from({ length: 6 }, (_, index) => ({
          id: `o${index}`,
          label: `Option ${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it("complete_work and get_work_context are strict and JSON-schema compatible", () => {
    expect(
      completeWorkInput.safeParse({ summary: "Done.", outcomes: [] }).success,
    ).toBe(true);
    expect(
      completeWorkInput.safeParse({ summary: "Done.", outcomes: [], extra: 1 })
        .success,
    ).toBe(false);
    expect(
      completeWorkInput.safeParse({ summary: "Done.", outcomes: [""] }).success,
    ).toBe(false);
    expect(getWorkContextInput.safeParse({}).success).toBe(true);
    expect(getWorkContextInput.safeParse({ extra: 1 }).success).toBe(false);
    for (const schema of [
      getWorkContextInput,
      requestDecisionInput,
      completeWorkInput,
    ]) {
      expect(() => z.toJSONSchema(schema)).not.toThrow();
    }
  });
});

describe("collaboration tools", () => {
  let tools: Map<string, ToolDefinition>;

  const run = (name: string, input: unknown): Promise<unknown> => {
    const def = tools.get(name);
    if (!def) throw new Error(`No tool named ${name}`);
    const parsed = def.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error(`Invalid test input for ${name}`);
    return Promise.resolve(def.execute(parsed.data, signal));
  };

  beforeEach(() => {
    tools = new Map(
      buildStaticTools({ dataSource: new FakeDataSource() }).map((definition) => [
        definition.name,
        definition,
      ]),
    );
  });

  it("appends the collaboration tools, marks context read-only, and teaches the sequence", () => {
    expect([...tools.keys()].slice(-4)).toEqual([
      "get_work_context",
      "request_decision",
      "complete_work",
      "propose_change_set",
    ]);
    const context = tools.get("get_work_context")!;
    expect(context.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(context.description).toContain("FIRST");
    expect(context.description).toContain("Publish a plan");
    expect(context.description).toContain("material ambiguity");
    expect(context.description).toContain("complete_work");
  });

  it("returns compact mutation acknowledgements", async () => {
    const started = s().startWorkSession("Find the revenue dip");
    const sessionId = started.ok ? started.sessionId! : "";
    const requested = (await run("request_decision", decisionInput)) as {
      decisionId: string;
    };
    expect(requested).toEqual({
      ok: true,
      decisionId: requested.decisionId,
      status: "pending",
    });
    expect(Object.keys(requested).sort()).toEqual([
      "decisionId",
      "ok",
      "status",
    ]);

    expect(
      await run("complete_work", {
        summary: "Found and documented the dip.",
        outcomes: ["Annotated March."],
      }),
    ).toEqual({ ok: true, sessionId, phase: "complete" });
  });

  it("reports the data-rail hovered field in both focus payloads", async () => {
    s().setHoveredField({ dataset: "invoices", column: "amount_eur", type: "DOUBLE" });
    const focus = (await run("get_user_focus", {})) as Record<string, unknown>;
    expect(focus["hoveredField"]).toEqual({
      dataset: "invoices",
      column: "amount_eur",
      type: "DOUBLE",
    });

    const context = (await run("get_work_context", {})) as {
      focus: { hoveredField: unknown };
    };
    expect(context.focus.hoveredField).toEqual({
      dataset: "invoices",
      column: "amount_eur",
      type: "DOUBLE",
    });

    // Pure UI state: never undoable, never logged, cleared on a doc switch.
    expect(s().undoStack).toHaveLength(0);
    expect(s().activityLog).toHaveLength(0);
    s().setHoveredField(null);
    expect(s().hoveredField).toBeNull();
    s().setHoveredField({ dataset: "invoices", column: "month" });
    s().resetDashboard();
    expect(s().hoveredField).toBeNull();
  });

  it("returns the full shared context, answered decisions, focus, and agreement", async () => {
    s().startWorkSession("Explain the March revenue dip");
    s().presentPlan({
      title: "Revenue investigation",
      steps: [{ label: "Profile cohorts", status: "active" }],
    });
    const added = s().addTile(kpiInput, { origin: "human", label: "Added MRR" });
    if (!added.ok || !added.tileId) throw new Error("addTile failed");
    const tileId = added.tileId;
    s().selectTile(tileId);
    s().setHoveredTile(tileId);
    s().setBrushedRange({
      tileId,
      from: "2026-03-01",
      to: "2026-03-31",
    });
    s().setCrossFilter(
      { column: "plan", value: "enterprise", sourceTileId: tileId },
      { origin: "human", label: "Focused enterprise" },
    );
    s().updateTile(
      tileId,
      { title: "Human-renamed MRR" },
      { origin: "human", label: "Renamed MRR" },
    );
    s().proposeInsight({
      title: "March anomaly",
      body: "Enterprise renewals explain most of the dip.",
      tileId,
    });
    const requested = s().requestDecision(decisionInput);
    const decisionId = requested.ok ? requested.decisionId! : "";
    s().answerDecision(decisionId, "enterprise", "Lead with revenue impact.");

    const result = (await run("get_work_context", {})) as Record<string, any>;
    expect(result.session).toMatchObject({
      objective: "Explain the March revenue dip",
      phase: "review",
    });
    expect(result.plan).toMatchObject({ title: "Revenue investigation" });
    expect(result.pendingReviews).toEqual([
      expect.objectContaining({
        title: "March anomaly",
        tileId,
        severity: "info",
      }),
    ]);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        id: decisionId,
        status: "answered",
        answer: {
          optionId: "enterprise",
          note: "Lead with revenue impact.",
        },
      }),
    ]);
    expect(result.focus).toMatchObject({
      activePage: { pageId: s().doc.activePageId, name: "Overview" },
      selectedTileId: tileId,
      hoveredTileId: tileId,
      crossFilter: {
        column: "plan",
        value: "enterprise",
        sourceTileId: tileId,
      },
      brushedRange: { tileId, from: "2026-03-01", to: "2026-03-31" },
      recentHumanEdits: [
        { tileId, property: "title", at: expect.any(String) },
      ],
    });
    expect(result.workingAgreement).toEqual({
      agentEdits: expect.stringContaining("attributed and undoable"),
      recentHumanEdits: expect.stringContaining("last 10 minutes"),
      rawData: expect.stringContaining("stays local"),
      uncertainOrHighImpactChanges: expect.stringContaining(
        "request_decision or propose_insight",
      ),
    });
  });
});

describe("collaboration reset boundary", () => {
  it("resetDashboard clears the session, decisions, plan, and insights", () => {
    s().startWorkSession("Investigate churn");
    s().presentPlan({ steps: [{ label: "Profile" }] });
    s().requestDecision(decisionInput);
    s().proposeInsight({ title: "Finding", body: "Churn moved." });
    s().resetDashboard();
    expect(s().presence).toEqual({
      session: null,
      plan: null,
      insights: [],
      decisions: [],
      changeSets: [],
    });
  });
});
