import { beforeEach, describe, expect, it } from "vitest";
import {
  assertReadOnly,
  type ColumnMeta,
  type ColumnProfile,
  type DataSource,
  type DatasetMeta,
  type QueryResult,
} from "@kontier-ri/datasource";
import {
  MAX_CHANGE_SETS,
  useDashboardStore,
} from "../src/store";
import {
  applyChangeSetInput,
  changeActionSchema,
  proposeChangeSetInput,
  reviseChangeSetInput,
} from "../src/schemas";
import {
  buildDecisionTools,
  buildProposalTools,
  buildSelectedTileTools,
  buildStaticTools,
  DECISION_TOOL_NAMES,
  PROPOSAL_TOOL_NAMES,
  STATIC_TOOL_NAMES,
  type ToolDefinition,
} from "../src/webmcp/tools";
import type {
  ActionMeta,
  AddTileInput,
  ChangeAction,
  ProposeChangeSetInput,
} from "../src/types";

const human: ActionMeta = { origin: "human", label: "human edit" };

const kpiInput: AddTileInput = {
  type: "kpi",
  title: "MRR",
  spec: { dataset: "invoices", measure: "amount", agg: "sum", format: "currency" },
};

const chartAction = (title = "Revenue by month"): ChangeAction => ({
  kind: "add_tile",
  payload: {
    type: "chart",
    title,
    spec: {
      dataset: "invoices",
      query: { dims: ["month"], measures: [{ col: "amount", agg: "sum" }] },
      chartType: "line",
      xKey: "month",
    },
  },
  note: "Shows the trend behind the KPI.",
});

const s = () => useDashboardStore.getState();

function addTile(title = "MRR"): string {
  const res = s().addTile({ ...kpiInput, title }, human);
  if (!res.ok || !res.tileId) throw new Error("addTile failed");
  return res.tileId;
}

function propose(
  overrides: Partial<ProposeChangeSetInput> = {},
): { id: string; input: ProposeChangeSetInput } {
  const input: ProposeChangeSetInput = {
    title: "Explain the Q3 dip",
    rationale: "Group the three edits that make the dip readable.",
    actions: [chartAction()],
    ...overrides,
  };
  const res = s().proposeChangeSet(input);
  if (!res.ok || !res.changeSetId) {
    throw new Error(`proposeChangeSet failed: ${JSON.stringify(res)}`);
  }
  return { id: res.changeSetId, input };
}

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

beforeEach(() => {
  s().resetDashboard();
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe("change-set schemas", () => {
  it("accepts every action kind and its note", () => {
    const actions: unknown[] = [
      chartAction(),
      { kind: "update_tile", payload: { tileId: "t1", patch: { title: "New" } } },
      { kind: "remove_tile", payload: { tileId: "t1" }, note: "Superseded." },
      { kind: "add_annotation", payload: { tileId: "t1", text: "Dip here" } },
      { kind: "set_filter", payload: { column: "plan", op: "eq", value: "pro" } },
      {
        kind: "set_tile_filters",
        payload: {
          tileId: "t1",
          filters: [{ column: "plan", op: "eq", value: "pro" }],
        },
      },
    ];
    for (const action of actions) {
      expect(changeActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("is strict: unknown keys, bad kinds and long notes are rejected", () => {
    expect(
      changeActionSchema.safeParse({
        kind: "remove_tile",
        payload: { tileId: "t1" },
        extra: 1,
      }).success,
    ).toBe(false);
    expect(
      changeActionSchema.safeParse({ kind: "nuke_tile", payload: { tileId: "t1" } })
        .success,
    ).toBe(false);
    expect(
      changeActionSchema.safeParse({
        kind: "remove_tile",
        payload: { tileId: "t1" },
        note: "x".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      proposeChangeSetInput.safeParse({
        title: "t",
        rationale: "r",
        actions: [chartAction()],
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      applyChangeSetInput.safeParse({ changeSetId: "cs_1", skipIndexes: [0, 2] })
        .success,
    ).toBe(true);
    expect(
      applyChangeSetInput.safeParse({ changeSetId: "cs_1", skipIndexes: [1.5] })
        .success,
    ).toBe(false);
    expect(reviseChangeSetInput.safeParse({ changeSetId: "cs_1" }).success).toBe(
      false,
    );
  });

  it("bounds the action list to 1..8 and rejects empty patches", () => {
    const many = Array.from({ length: 9 }, (_, i) => chartAction(`Chart ${i}`));
    expect(
      proposeChangeSetInput.safeParse({ title: "t", rationale: "r", actions: [] })
        .success,
    ).toBe(false);
    expect(
      proposeChangeSetInput.safeParse({ title: "t", rationale: "r", actions: many })
        .success,
    ).toBe(false);
    expect(
      proposeChangeSetInput.safeParse({
        title: "t",
        rationale: "r",
        actions: many.slice(0, 8),
      }).success,
    ).toBe(true);
    expect(
      changeActionSchema.safeParse({
        kind: "update_tile",
        payload: { tileId: "t1", patch: {} },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// proposeChangeSet
// ---------------------------------------------------------------------------

describe("proposeChangeSet", () => {
  it("stages the set, logs activity and moves the session to review", () => {
    s().startWorkSession("Explain the Q3 dip");
    const tileId = addTile();
    const { id } = propose({
      actions: [
        chartAction(),
        {
          kind: "add_annotation",
          payload: { tileId, text: "Dip starts here" },
          note: "Marks the drop.",
        },
      ],
    });
    const changeSet = s().presence.changeSets[0]!;
    expect(changeSet.id).toBe(id);
    expect(changeSet.status).toBe("proposed");
    expect(changeSet.actions).toHaveLength(2);
    expect(changeSet.appliedActionIndexes).toBeUndefined();
    expect(changeSet.createdAt).toBeTypeOf("number");
    expect(s().presence.session!.phase).toBe("review");
    expect(s().activityLog[0]).toMatchObject({
      by: "agent",
      label: "Change set proposed: “Explain the Q3 dip” (2 changes)",
    });
    // Staging alone changes NOTHING in the document.
    expect(s().doc.tiles).toHaveLength(1);
    expect(s().undoStack).toHaveLength(1);
  });

  it("rejects bad kinds, empty/oversized lists and duplicate actions", () => {
    const tileId = addTile();
    const bad = (actions: unknown[]): string => {
      const res = s().proposeChangeSet({
        title: "t",
        rationale: "r",
        actions: actions as ChangeAction[],
      });
      expect(res.ok).toBe(false);
      return (res as { error: string }).error;
    };
    expect(bad([{ kind: "nuke_tile", payload: { tileId } }])).toContain(
      "Invalid change set",
    );
    expect(bad([])).toContain("Invalid change set");
    expect(bad(Array.from({ length: 9 }, (_, i) => chartAction(`c${i}`)))).toContain(
      "Invalid change set",
    );
    expect(
      bad([
        { kind: "remove_tile", payload: { tileId } },
        { kind: "remove_tile", payload: { tileId } },
      ]),
    ).toContain("Duplicate action");
    // An edit after a removal in the SAME set can never be reviewed honestly.
    expect(
      bad([
        { kind: "remove_tile", payload: { tileId } },
        { kind: "add_annotation", payload: { tileId, text: "note" } },
      ]),
    ).toContain("removes");
    expect(s().presence.changeSets).toHaveLength(0);
  });

  it("verifies referenced tiles exist NOW and that patches fit the tile type", () => {
    const tileId = addTile();
    const missing = s().proposeChangeSet({
      title: "t",
      rationale: "r",
      actions: [{ kind: "remove_tile", payload: { tileId: "tile_gone" } }],
    });
    expect(missing).toMatchObject({ ok: false });
    expect((missing as { error: string }).error).toContain("tile_gone");

    const badPatch = s().proposeChangeSet({
      title: "t",
      rationale: "r",
      actions: [
        {
          kind: "update_tile",
          payload: { tileId, patch: { spec: { chartType: "bar" } } },
        },
      ],
    });
    expect(badPatch).toMatchObject({ ok: false });
    expect((badPatch as { error: string }).error).toContain("kpi tile spec");

    // A tile deleted AFTER the propose-time check fails at apply, not here.
    const { id } = propose({
      actions: [{ kind: "update_tile", payload: { tileId, patch: { title: "New" } } }],
    });
    expect(s().presence.changeSets.find((c) => c.id === id)!.status).toBe(
      "proposed",
    );
  });

  it("caps the queue at MAX_CHANGE_SETS, dropping the oldest", () => {
    for (let i = 0; i < MAX_CHANGE_SETS + 1; i++) {
      propose({ title: `Set ${i}` });
    }
    expect(s().presence.changeSets).toHaveLength(MAX_CHANGE_SETS);
    expect(s().presence.changeSets[0]!.title).toBe("Set 1");
    expect(s().presence.changeSets.at(-1)!.title).toBe(
      `Set ${MAX_CHANGE_SETS}`,
    );
  });

  it("is ephemeral: resetDashboard clears the queue", () => {
    propose();
    expect(s().presence.changeSets).toHaveLength(1);
    s().resetDashboard();
    expect(s().presence.changeSets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyChangeSet
// ---------------------------------------------------------------------------

describe("applyChangeSet", () => {
  it("applies every action as ONE undo step and ONE activity entry", () => {
    const tileId = addTile();
    const { id } = propose({
      actions: [
        chartAction(),
        { kind: "add_annotation", payload: { tileId, text: "Dip starts here" } },
        { kind: "set_filter", payload: { column: "plan", op: "eq", value: "pro" } },
      ],
    });
    const docBefore = s().doc;
    const undoBefore = s().undoStack.length;
    const activityBefore = s().activityLog.length;

    expect(s().applyChangeSet(id)).toMatchObject({ ok: true, changeSetId: id });

    expect(s().doc.tiles).toHaveLength(2);
    expect(s().doc.tiles.find((t) => t.id === tileId)!.annotations).toHaveLength(1);
    expect(s().doc.filters.filters).toEqual([
      { column: "plan", op: "eq", value: "pro" },
    ]);
    // Collapsed: 3 commands, 1 undo entry, 1 activity line.
    expect(s().undoStack).toHaveLength(undoBefore + 1);
    expect(s().activityLog).toHaveLength(activityBefore + 1);
    expect(s().activityLog[0]).toMatchObject({
      by: "agent",
      label: "Applied change set: “Explain the Q3 dip” (3 changes)",
      undone: false,
    });
    const changeSet = s().presence.changeSets[0]!;
    expect(changeSet.status).toBe("applied");
    expect(changeSet.appliedActionIndexes).toEqual([0, 1, 2]);

    // ONE Cmd+Z reverts the whole set, exactly.
    expect(s().undo()).toMatchObject({ ok: true });
    expect(s().doc).toBe(docBefore);
    expect(s().doc.tiles).toHaveLength(1);
    expect(s().doc.tiles[0]!.annotations).toEqual([]);
    expect(s().doc.filters.filters).toEqual([]);
    expect(s().undoStack).toHaveLength(undoBefore);
    expect(s().activityLog[0]!.undone).toBe(true);

    // Redo re-applies the whole set in one step.
    expect(s().redo()).toMatchObject({ ok: true });
    expect(s().doc.tiles).toHaveLength(2);
    expect(s().activityLog[0]!.undone).toBe(false);
  });

  it("skipIndexes applies the rest and marks the set partially_applied", () => {
    const tileId = addTile();
    const { id } = propose({
      actions: [
        chartAction(),
        { kind: "add_annotation", payload: { tileId, text: "skip me" } },
        { kind: "set_filter", payload: { column: "plan", op: "eq", value: "pro" } },
      ],
    });
    expect(s().applyChangeSet(id, { skipIndexes: [1] })).toMatchObject({
      ok: true,
    });
    expect(s().doc.tiles).toHaveLength(2);
    expect(s().doc.tiles.find((t) => t.id === tileId)!.annotations).toEqual([]);
    expect(s().doc.filters.filters).toHaveLength(1);
    const changeSet = s().presence.changeSets[0]!;
    expect(changeSet.status).toBe("partially_applied");
    expect(changeSet.appliedActionIndexes).toEqual([0, 2]);
    expect(s().activityLog[0]!.label).toBe(
      "Applied change set: “Explain the Q3 dip” (2 changes)",
    );
    expect(s().undoStack.at(-1)!.label).toBe(s().activityLog[0]!.label);
  });

  it("rejects out-of-range skips and a fully skipped set", () => {
    const { id } = propose({ actions: [chartAction()] });
    expect(s().applyChangeSet(id, { skipIndexes: [3] })).toMatchObject({
      ok: false,
    });
    expect(s().applyChangeSet(id, { skipIndexes: [0] })).toMatchObject({
      ok: false,
    });
    expect(s().presence.changeSets[0]!.status).toBe("proposed");
    expect(s().doc.tiles).toHaveLength(0);
  });

  it("a failing action restores the document AND the history exactly", () => {
    const keep = addTile("Keep");
    const doomed = addTile("Doomed");
    const { id } = propose({
      actions: [
        { kind: "add_annotation", payload: { tileId: keep, text: "applied first" } },
        {
          kind: "update_tile",
          payload: { tileId: doomed, patch: { title: "Never" } },
        },
      ],
    });
    // The human deletes the second tile after the set was staged, then
    // undoes an unrelated command so redoStack is non-empty too.
    s().removeTile(doomed, human);
    addTile("Scratch");
    s().undo();

    const before = {
      doc: s().doc,
      undoStack: s().undoStack,
      redoStack: s().redoStack,
      activityLog: s().activityLog,
      agentPulse: s().agentPulse,
    };
    const res = s().applyChangeSet(id);
    expect(res).toMatchObject({ ok: false });
    const error = (res as { error: string }).error;
    expect(error).toContain("action 1");
    expect(error).toContain("update_tile");
    expect(error).toContain("Nothing was applied");

    expect(s().doc).toBe(before.doc);
    expect(s().doc.tiles.find((t) => t.id === keep)!.annotations).toEqual([]);
    expect(s().undoStack).toEqual(before.undoStack);
    expect(s().redoStack).toEqual(before.redoStack);
    expect(s().redoStack).toHaveLength(1);
    expect(s().activityLog).toEqual(before.activityLog);
    expect(s().agentPulse).toEqual(before.agentPulse);
    // Still reviewable: the human can drop the broken row and apply the rest.
    expect(s().presence.changeSets[0]!.status).toBe("proposed");
    expect(s().applyChangeSet(id, { skipIndexes: [1] })).toMatchObject({
      ok: true,
    });
    expect(s().presence.changeSets[0]!.status).toBe("partially_applied");
  });

  it("applies over protected human edits (the human approved the set)", () => {
    const tileId = addTile();
    s().updateTile(tileId, { title: "Human title" }, human);
    const { id } = propose({
      actions: [
        { kind: "update_tile", payload: { tileId, patch: { title: "Agent title" } } },
      ],
    });
    expect(s().applyChangeSet(id)).toMatchObject({ ok: true });
    expect(s().doc.tiles[0]!.title).toBe("Agent title");
  });

  it("recomputes the session phase once the review queue empties", () => {
    s().startWorkSession("Explain the Q3 dip");
    s().presentPlan({ steps: [{ label: "Scan", status: "active" }] });
    const { id } = propose();
    expect(s().presence.session!.phase).toBe("review");
    expect(s().applyChangeSet(id)).toMatchObject({ ok: true });
    expect(s().presence.session!.phase).toBe("working");
  });

  it("cannot be applied twice and reports unknown ids", () => {
    const { id } = propose();
    expect(s().applyChangeSet(id)).toMatchObject({ ok: true });
    expect(s().applyChangeSet(id)).toMatchObject({ ok: false });
    expect((s().applyChangeSet("cs_nope") as { error: string }).error).toContain(
      "cs_nope",
    );
  });
});

// ---------------------------------------------------------------------------
// reject / revise / withdraw
// ---------------------------------------------------------------------------

describe("rejectChangeSet / reviseChangeSet / withdrawChangeSet", () => {
  it("reject marks the set rejected, logs it and touches no document", () => {
    s().startWorkSession("Explain the Q3 dip");
    const { id } = propose();
    const undoBefore = s().undoStack.length;
    expect(s().rejectChangeSet(id)).toMatchObject({ ok: true, changeSetId: id });
    expect(s().presence.changeSets[0]!.status).toBe("rejected");
    expect(s().activityLog[0]).toMatchObject({
      by: "human",
      label: "Change set rejected: “Explain the Q3 dip”",
    });
    expect(s().undoStack).toHaveLength(undoBefore);
    expect(s().doc.tiles).toHaveLength(0);
    expect(s().presence.session!.phase).toBe("ready");
    expect(s().rejectChangeSet(id)).toMatchObject({ ok: false });
  });

  it("revise replaces content only while the set is proposed", () => {
    const { id } = propose();
    expect(
      s().reviseChangeSet(id, {
        title: "Explain the Q3 dip (v2)",
        actions: [chartAction("Revenue by plan")],
      }),
    ).toMatchObject({ ok: true });
    const changeSet = s().presence.changeSets[0]!;
    expect(changeSet.title).toBe("Explain the Q3 dip (v2)");
    expect(changeSet.actions).toHaveLength(1);
    expect(
      (changeSet.actions[0] as { payload: { title: string } }).payload.title,
    ).toBe("Revenue by plan");
    expect(changeSet.updatedAt).toBeGreaterThanOrEqual(changeSet.createdAt);
    expect(s().reviseChangeSet(id, {})).toMatchObject({ ok: false });

    s().rejectChangeSet(id);
    expect(s().reviseChangeSet(id, { title: "too late" })).toMatchObject({
      ok: false,
    });
  });

  it("withdraw removes a pending set; a decided set stays", () => {
    s().startWorkSession("Explain the Q3 dip");
    const { id } = propose();
    expect(s().withdrawChangeSet(id)).toMatchObject({ ok: true });
    expect(s().presence.changeSets).toEqual([]);
    expect(s().activityLog[0]!.label).toBe(
      "Change set withdrawn: “Explain the Q3 dip”",
    );
    expect(s().presence.session!.phase).toBe("ready");

    const second = propose({ title: "Second" });
    s().applyChangeSet(second.id);
    expect(s().withdrawChangeSet(second.id)).toMatchObject({ ok: false });
    expect(s().presence.changeSets).toHaveLength(1);
  });

  it("withdrawDecision retracts only an unanswered question", () => {
    s().startWorkSession("Explain the Q3 dip");
    const res = s().requestDecision({
      question: "Which cohort?",
      context: "Two cohorts fit the brief.",
      options: [
        { id: "a", label: "New logos" },
        { id: "b", label: "Expansion" },
      ],
    });
    const decisionId = (res as { decisionId: string }).decisionId;
    expect(s().presence.session!.phase).toBe("review");
    expect(s().withdrawDecision(decisionId)).toMatchObject({ ok: true });
    expect(s().presence.decisions).toEqual([]);
    expect(s().presence.session!.phase).toBe("ready");
    expect(s().withdrawDecision(decisionId)).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

describe("change-set tools", () => {
  let tools: Map<string, ToolDefinition>;
  const ctx = { dataSource: new FakeDataSource() as DataSource };
  const signal = new AbortController().signal;

  const run = (
    def: ToolDefinition | undefined,
    input: unknown,
  ): Promise<unknown> => {
    if (!def) throw new Error("missing tool");
    const parsed = def.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error(`invalid test input for ${def.name}`);
    return Promise.resolve(def.execute(parsed.data, signal));
  };

  beforeEach(() => {
    tools = new Map(buildStaticTools(ctx).map((d) => [d.name, d]));
  });

  it("inventory: 40 static, 3 selection, 2 proposal, 1 decision", () => {
    expect(tools.size).toBe(40);
    expect([...tools.keys()]).toEqual([...STATIC_TOOL_NAMES]);
    expect(STATIC_TOOL_NAMES).toHaveLength(40);
    expect(tools.has("propose_change_set")).toBe(true);
    expect(buildSelectedTileTools(ctx)).toHaveLength(3);

    // Phase-scoped bundles are EMPTY while nothing is pending.
    expect(buildProposalTools(ctx)).toEqual([]);
    expect(buildDecisionTools(ctx)).toEqual([]);

    propose();
    s().requestDecision({
      question: "Which cohort?",
      context: "Two cohorts fit the brief.",
      options: [
        { id: "a", label: "New logos" },
        { id: "b", label: "Expansion" },
      ],
    });
    expect(buildProposalTools(ctx).map((d) => d.name)).toEqual([
      ...PROPOSAL_TOOL_NAMES,
    ]);
    expect(buildDecisionTools(ctx).map((d) => d.name)).toEqual([
      ...DECISION_TOOL_NAMES,
    ]);
    expect(PROPOSAL_TOOL_NAMES).toHaveLength(2);
    expect(DECISION_TOOL_NAMES).toHaveLength(1);
  });

  it("propose_change_set returns a compact ack and stages nothing else", async () => {
    const tileId = addTile();
    const res = (await run(tools.get("propose_change_set"), {
      title: "Explain the Q3 dip",
      rationale: "Two edits make the dip readable.",
      actions: [
        chartAction(),
        {
          kind: "add_annotation",
          payload: { tileId, text: "Dip starts here" },
          note: "Marks the drop.",
        },
      ],
    })) as { ok: boolean; changeSetId: string; status: string; actions: number };
    expect(res).toEqual({
      ok: true,
      changeSetId: expect.stringMatching(/^cs_/),
      status: "proposed",
      actions: 2,
    });
    expect(s().doc.tiles).toHaveLength(1);
    expect(s().presence.changeSets).toHaveLength(1);
  });

  it("propose_change_set surfaces store errors instead of throwing", async () => {
    const res = (await run(tools.get("propose_change_set"), {
      title: "Explain the Q3 dip",
      rationale: "Reference a tile that does not exist.",
      actions: [{ kind: "remove_tile", payload: { tileId: "tile_gone" } }],
    })) as { error: string };
    expect(res.error).toContain("tile_gone");
    expect(s().presence.changeSets).toHaveLength(0);
  });

  it("get_work_context reports the queue and the human's verdict", async () => {
    s().startWorkSession("Explain the Q3 dip");
    const tileId = addTile();
    const { id } = propose({
      actions: [
        chartAction(),
        {
          kind: "add_annotation",
          payload: { tileId, text: "Dip starts here" },
          note: "Marks the drop.",
        },
      ],
    });
    const pending = (await run(tools.get("get_work_context"), {})) as {
      changeSets: {
        changeSetId: string;
        title: string;
        rationale: string;
        status: string;
        actions: { kind: string; note?: string }[];
        createdAt: string;
      }[];
    };
    expect(pending.changeSets).toEqual([
      {
        changeSetId: id,
        title: "Explain the Q3 dip",
        rationale: "Group the three edits that make the dip readable.",
        status: "proposed",
        actions: [
          { kind: "add_tile", note: "Shows the trend behind the KPI." },
          { kind: "add_annotation", note: "Marks the drop." },
        ],
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    ]);

    // After the human applies part of it, the next read shows the verdict.
    s().applyChangeSet(id, { skipIndexes: [1] });
    const after = (await run(tools.get("get_work_context"), {})) as {
      changeSets: { status: string; appliedActionIndexes: number[] }[];
    };
    expect(after.changeSets[0]).toMatchObject({
      status: "partially_applied",
      appliedActionIndexes: [0],
    });
  });

  it("get_work_context stays read-only and untrusted-hinted", () => {
    expect(tools.get("get_work_context")!.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(tools.get("propose_change_set")!.annotations).toBeUndefined();
  });

  it("revise_change_set / withdraw_change_set act on the pending set", async () => {
    const { id } = propose();
    const proposalTools = new Map(
      buildProposalTools(ctx).map((d) => [d.name, d]),
    );
    expect(proposalTools.get("revise_change_set")!.description).toContain(id);

    expect(
      await run(proposalTools.get("revise_change_set"), {
        changeSetId: id,
        rationale: "Sharper reason for the same edit.",
        actions: [chartAction("Revenue by plan")],
      }),
    ).toEqual({ ok: true, changeSetId: id, status: "proposed", actions: 1 });
    expect(s().presence.changeSets[0]!.rationale).toBe(
      "Sharper reason for the same edit.",
    );

    expect(
      await run(proposalTools.get("withdraw_change_set"), { changeSetId: id }),
    ).toEqual({ ok: true, changeSetId: id, status: "withdrawn" });
    expect(s().presence.changeSets).toEqual([]);
    // The bundle is gone with the queue.
    expect(buildProposalTools(ctx)).toEqual([]);
  });

  it("withdraw_decision unregisters with the queue", async () => {
    const res = s().requestDecision({
      question: "Which cohort?",
      context: "Two cohorts fit the brief.",
      options: [
        { id: "a", label: "New logos" },
        { id: "b", label: "Expansion" },
      ],
    });
    const decisionId = (res as { decisionId: string }).decisionId;
    const decisionTools = new Map(
      buildDecisionTools(ctx).map((d) => [d.name, d]),
    );
    expect(decisionTools.get("withdraw_decision")!.description).toContain(
      decisionId,
    );
    expect(
      await run(decisionTools.get("withdraw_decision"), { decisionId }),
    ).toEqual({ ok: true, decisionId, status: "withdrawn" });
    expect(buildDecisionTools(ctx)).toEqual([]);
  });
});
