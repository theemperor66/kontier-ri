import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import {
  assertReadOnly,
  type ColumnMeta,
  type ColumnProfile,
  type DataSource,
  type DatasetMeta,
  type QueryResult,
} from "@kontier-ri/datasource";
import { MAX_INSIGHTS, useDashboardStore } from "../src/store";
import {
  clearPlanInput,
  presentPlanInput,
  proposeInsightInput,
  suggestedActionSchema,
  updatePlanStepInput,
} from "../src/schemas";
import { buildStaticTools, type ToolDefinition } from "../src/webmcp/tools";
import type { ActionMeta, AddTileInput, ProposeInsightInput } from "../src/types";

const human: ActionMeta = { origin: "human", label: "human edit" };

const kpiInput: AddTileInput = {
  type: "kpi",
  title: "MRR",
  spec: { dataset: "invoices", measure: "amount", agg: "sum", format: "currency" },
};

const s = () => useDashboardStore.getState();

function addTile(): string {
  const res = s().addTile(kpiInput, human);
  if (!res.ok || !res.tileId) throw new Error("addTile failed");
  return res.tileId;
}

function propose(overrides: Partial<ProposeInsightInput> = {}): string {
  const res = s().proposeInsight({
    title: "Churn spike",
    body: "Churn doubled in March.",
    severity: "warn",
    ...overrides,
  });
  if (!res.ok || !res.insightId) throw new Error("proposeInsight failed");
  return res.insightId;
}

beforeEach(() => {
  s().resetDashboard();
});

// ---------------------------------------------------------------------------
// Plan lifecycle
// ---------------------------------------------------------------------------

describe("presence: plan", () => {
  it("presentPlan upserts the plan, defaults steps to pending, logs activity", () => {
    const res = s().presentPlan({
      title: "Build revenue view",
      steps: [{ label: "Scan data" }, { label: "Add tiles", status: "active" }],
    });
    expect(res).toMatchObject({ ok: true });
    const plan = s().presence.plan!;
    expect(plan.title).toBe("Build revenue view");
    expect(plan.steps).toEqual([
      { label: "Scan data", status: "pending" },
      { label: "Add tiles", status: "active" },
    ]);
    expect(plan.updatedAt).toBeTypeOf("number");
    expect(s().activityLog[0]).toMatchObject({
      by: "agent",
      label: "Agent shared a plan: “Build revenue view”",
    });

    // Upsert: a second call REPLACES the plan.
    s().presentPlan({ steps: [{ label: "Only step" }] });
    expect(s().presence.plan!.steps).toHaveLength(1);
    expect(s().presence.plan!.title).toBeUndefined();
    expect(s().activityLog[0]!.label).toBe("Agent shared a plan");
  });

  it("plan changes are ephemeral: no undo entries, undo() skips them", () => {
    addTile();
    expect(s().undoStack).toHaveLength(1);
    s().presentPlan({ steps: [{ label: "a" }] });
    s().updatePlanStep(0, "done");
    expect(s().undoStack).toHaveLength(1); // unchanged
    s().undo(); // undoes the tile add, NOT the plan
    expect(s().doc.tiles).toHaveLength(0);
    expect(s().presence.plan).not.toBeNull();
  });

  it("updatePlanStep updates one step and validates index / missing plan", () => {
    expect(s().updatePlanStep(0, "done")).toMatchObject({
      ok: false,
      error: expect.stringContaining("No plan"),
    });
    s().presentPlan({ steps: [{ label: "a" }, { label: "b" }] });
    expect(s().updatePlanStep(1, "failed")).toMatchObject({ ok: true });
    expect(s().presence.plan!.steps[1]).toEqual({ label: "b", status: "failed" });
    expect(s().presence.plan!.steps[0]!.status).toBe("pending");
    expect(s().updatePlanStep(2, "done")).toMatchObject({
      ok: false,
      error: expect.stringContaining("out of range"),
    });
  });

  it("clearPlan removes the plan; erroring when none is shared", () => {
    expect(s().clearPlan()).toMatchObject({ ok: false });
    s().presentPlan({ steps: [{ label: "a" }] });
    expect(s().clearPlan()).toMatchObject({ ok: true });
    expect(s().presence.plan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Insight lifecycle
// ---------------------------------------------------------------------------

describe("presence: insights", () => {
  it("proposeInsight adds a proposed insight and logs activity", () => {
    const id = propose();
    const insight = s().presence.insights[0]!;
    expect(insight).toMatchObject({
      id,
      title: "Churn spike",
      severity: "warn",
      state: "proposed",
    });
    expect(s().activityLog[0]!.label).toContain("Insight proposed");
    expect(s().undoStack).toHaveLength(0); // ephemeral
  });

  it("severity defaults to info; unknown tileId is rejected", () => {
    const ok = s().proposeInsight({ title: "t", body: "b" });
    expect(ok.ok).toBe(true);
    expect(s().presence.insights[0]!.severity).toBe("info");
    const bad = s().proposeInsight({ title: "t", body: "b", tileId: "nope" });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("nope") });
  });

  it("insights are capped at MAX_INSIGHTS (oldest dropped)", () => {
    for (let i = 0; i < MAX_INSIGHTS + 3; i++) {
      s().proposeInsight({ title: `i${i}`, body: "b" });
    }
    expect(s().presence.insights).toHaveLength(MAX_INSIGHTS);
    expect(s().presence.insights[0]!.title).toBe("i3");
  });

  it("dismiss flips state, logs, and double-dismiss errors", () => {
    const id = propose();
    expect(s().dismissInsight(id)).toMatchObject({ ok: true });
    expect(s().presence.insights[0]!.state).toBe("dismissed");
    expect(s().activityLog[0]!.label).toContain("Insight dismissed");
    expect(s().dismissInsight(id)).toMatchObject({ ok: false });
    expect(s().acceptInsight(id)).toMatchObject({ ok: false });
  });

  it("accept without suggestedAction just marks accepted (no undo entry)", () => {
    const id = propose();
    expect(s().acceptInsight(id)).toMatchObject({ ok: true, insightId: id });
    expect(s().presence.insights[0]!.state).toBe("accepted");
    expect(s().activityLog[0]!.label).toContain("Insight accepted");
    expect(s().undoStack).toHaveLength(0);
  });

  it("accept add_annotation executes through the command layer: agent-attributed, undoable, pulses", () => {
    const tileId = addTile();
    const id = propose({
      tileId,
      suggestedAction: {
        kind: "add_annotation",
        payload: { tileId, text: "Look here" },
      },
    });
    const res = s().acceptInsight(id);
    expect(res).toMatchObject({ ok: true, tileId, insightId: id });
    const tile = s().doc.tiles[0]!;
    expect(tile.annotations).toHaveLength(1);
    expect(tile.annotations[0]).toMatchObject({ text: "Look here", by: "agent" });
    expect(s().agentPulse[tileId]).toBeTypeOf("number");
    expect(s().presence.insights[0]!.state).toBe("accepted");

    // The applied action (NOT the accept itself) is undoable.
    expect(s().undo()).toMatchObject({ ok: true });
    expect(s().doc.tiles[0]!.annotations).toHaveLength(0);
    expect(s().presence.insights[0]!.state).toBe("accepted"); // state stays
  });

  it("accept add_tile and set_filter run the existing store actions", () => {
    const tileCountBefore = s().doc.tiles.length;
    const addId = propose({
      suggestedAction: { kind: "add_tile", payload: kpiInput },
    });
    const addRes = s().acceptInsight(addId);
    expect(addRes.ok).toBe(true);
    expect(s().doc.tiles).toHaveLength(tileCountBefore + 1);

    const filterId = propose({
      suggestedAction: {
        kind: "set_filter",
        payload: { column: "plan", op: "eq", value: "pro" },
      },
    });
    expect(s().acceptInsight(filterId).ok).toBe(true);
    expect(s().doc.filters.filters).toEqual([
      { column: "plan", op: "eq", value: "pro" },
    ]);
  });

  it("accept keeps the insight proposed when the suggested action fails", () => {
    const tileId = addTile();
    const id = propose({
      suggestedAction: {
        kind: "add_annotation",
        payload: { tileId, text: "Look here" },
      },
    });
    s().removeTile(tileId, human); // target vanishes before accept
    const res = s().acceptInsight(id);
    expect(res.ok).toBe(false);
    expect(s().presence.insights[0]!.state).toBe("proposed");
  });

  it("proposeInsight validates suggestedAction strictly (store-level guard)", () => {
    const bad = s().proposeInsight({
      title: "t",
      body: "b",
      suggestedAction: {
        kind: "remove_tile",
        payload: { tileId: "x" },
      } as never,
    });
    expect(bad).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid suggestedAction"),
    });
    const badAnnotationTarget = s().proposeInsight({
      title: "t",
      body: "b",
      suggestedAction: {
        kind: "add_annotation",
        payload: { tileId: "ghost", text: "x" },
      },
    });
    expect(badAnnotationTarget.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Doc-switch clearing
// ---------------------------------------------------------------------------

describe("presence: lifecycle boundaries", () => {
  it("resetDashboard (doc switch/load) clears plan and insights", () => {
    s().presentPlan({ steps: [{ label: "a" }] });
    propose();
    s().resetDashboard({
      title: "Other doc",
      theme: { mode: "dark" },
      filters: { filters: [], dateRange: null },
      tiles: [],
    });
    expect(s().presence).toEqual({
      session: null,
      plan: null,
      insights: [],
      decisions: [],
      changeSets: [],
    });
  });
});

// ---------------------------------------------------------------------------
// Schema strictness
// ---------------------------------------------------------------------------

describe("presence tool schemas", () => {
  it("present_plan: strict, 1..12 steps, valid statuses only", () => {
    expect(
      presentPlanInput.safeParse({ steps: [{ label: "a" }] }).success,
    ).toBe(true);
    expect(presentPlanInput.safeParse({ steps: [] }).success).toBe(false);
    expect(
      presentPlanInput.safeParse({ steps: [{ label: "a" }], extra: 1 }).success,
    ).toBe(false);
    expect(
      presentPlanInput.safeParse({ steps: [{ label: "a", status: "doing" }] })
        .success,
    ).toBe(false);
    expect(
      presentPlanInput.safeParse({
        steps: Array.from({ length: 13 }, (_, i) => ({ label: `s${i}` })),
      }).success,
    ).toBe(false);
  });

  it("update_plan_step / clear_plan: strict", () => {
    expect(updatePlanStepInput.safeParse({ index: 0, status: "done" }).success).toBe(true);
    expect(updatePlanStepInput.safeParse({ index: -1, status: "done" }).success).toBe(false);
    expect(updatePlanStepInput.safeParse({ index: 0 }).success).toBe(false);
    expect(clearPlanInput.safeParse({}).success).toBe(true);
    expect(clearPlanInput.safeParse({ anything: 1 }).success).toBe(false);
  });

  it("propose_insight: strict + severity default", () => {
    const parsed = proposeInsightInput.parse({ title: "t", body: "b" });
    expect(parsed.severity).toBe("info");
    expect(
      proposeInsightInput.safeParse({ title: "t", body: "b", severity: "fatal" })
        .success,
    ).toBe(false);
    expect(
      proposeInsightInput.safeParse({ title: "t", body: "b", surprise: true })
        .success,
    ).toBe(false);
  });

  it("suggestedAction: discriminated, strict payload per kind", () => {
    const ann = suggestedActionSchema.safeParse({
      kind: "add_annotation",
      payload: { tileId: "t1", text: "hi" },
    });
    expect(ann.success).toBe(true);
    expect(
      suggestedActionSchema.safeParse({
        kind: "add_annotation",
        payload: { tileId: "t1" }, // missing text
      }).success,
    ).toBe(false);
    expect(
      suggestedActionSchema.safeParse({
        kind: "set_theme", // not an allowed kind
        payload: { mode: "dark" },
      }).success,
    ).toBe(false);
    expect(
      suggestedActionSchema.safeParse({
        kind: "set_filter",
        payload: { column: "plan", op: "eq", value: "pro", force: true },
      }).success,
    ).toBe(false); // unknown payload key rejected
    // add_tile payload reuses the full add_tile input schema.
    expect(
      suggestedActionSchema.safeParse({
        kind: "add_tile",
        payload: kpiInput,
      }).success,
    ).toBe(true);
    expect(
      suggestedActionSchema.safeParse({
        kind: "add_tile",
        payload: { ...kpiInput, spec: { bogus: true } },
      }).success,
    ).toBe(false);
  });

  it("all four inputs convert to JSON Schema for registerTool", () => {
    for (const schema of [
      presentPlanInput,
      updatePlanStepInput,
      proposeInsightInput,
      clearPlanInput,
    ]) {
      expect(() => z.toJSONSchema(schema)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Tools (execute contract, via buildStaticTools)
// ---------------------------------------------------------------------------

class FakeDataSource implements DataSource {
  listDatasets(): Promise<DatasetMeta[]> {
    return Promise.resolve([]);
  }
  getSchema(): Promise<ColumnMeta[]> {
    return Promise.resolve([]);
  }
  runQuery(sql: string): Promise<QueryResult> {
    assertReadOnly(sql);
    return Promise.resolve({ columns: [], rows: [], rowCount: 0, truncated: false });
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

describe("presence tools", () => {
  let tools: Map<string, ToolDefinition>;
  const signal = new AbortController().signal;

  const run = (name: string, input: unknown): Promise<unknown> => {
    const def = tools.get(name);
    if (!def) throw new Error(`no tool ${name}`);
    const parsed = def.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error(`invalid test input for ${name}`);
    return Promise.resolve(def.execute(parsed.data, signal));
  };

  beforeEach(() => {
    tools = new Map(
      buildStaticTools({ dataSource: new FakeDataSource() }).map((d) => [d.name, d]),
    );
  });

  it("the existing 4 presence tools remain in the static surface (40 total)", () => {
    for (const name of ["present_plan", "update_plan_step", "propose_insight", "clear_plan"]) {
      expect(tools.has(name)).toBe(true);
    }
    expect(tools.size).toBe(40);
  });

  it("present_plan / update_plan_step / clear_plan acks are compact", async () => {
    expect(
      await run("present_plan", { title: "Plan", steps: [{ label: "a" }] }),
    ).toEqual({ ok: true, steps: 1 });
    expect(await run("update_plan_step", { index: 0, status: "done" })).toEqual({
      ok: true,
      index: 0,
      status: "done",
    });
    expect(await run("clear_plan", {})).toEqual({ ok: true });
    expect(await run("clear_plan", {})).toMatchObject({ error: expect.any(String) });
  });

  it("propose_insight returns {ok, insightId, state: proposed}", async () => {
    const res = (await run("propose_insight", {
      title: "Refunds up",
      body: "Refund rate rose 3pp week-over-week.",
      severity: "critical",
    })) as { ok: boolean; insightId: string; state: string };
    expect(res.ok).toBe(true);
    expect(res.insightId).toMatch(/^ins_/);
    expect(res.state).toBe("proposed");
    expect(s().presence.insights.at(-1)!.severity).toBe("critical");
  });
});
