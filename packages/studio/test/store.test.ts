import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_SCOPE,
  HUMAN_EDIT_WINDOW_MS,
  MAX_ACTIVITY,
  useDashboardStore,
} from "../src/store";
import type { ActionMeta, AddTileInput } from "../src/types";

const human: ActionMeta = { origin: "human", label: "human edit" };
const agent: ActionMeta = { origin: "agent", label: "agent edit" };

const kpiInput: AddTileInput = {
  type: "kpi",
  title: "MRR",
  spec: { dataset: "invoices", measure: "amount", agg: "sum", format: "currency" },
};

const s = () => useDashboardStore.getState();

function addTile(meta: ActionMeta = human): string {
  const res = s().addTile(kpiInput, meta);
  if (!res.ok || !res.tileId) throw new Error("addTile failed");
  return res.tileId;
}

beforeEach(() => {
  s().resetDashboard();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("commands + attribution", () => {
  it("addTile places the tile, logs activity, pushes undo", () => {
    const tileId = addTile();
    expect(s().doc.tiles).toHaveLength(1);
    expect(s().doc.tiles[0]!.id).toBe(tileId);
    expect(s().doc.tiles[0]!.layout).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(s().undoStack).toHaveLength(1);
    expect(s().activityLog[0]).toMatchObject({
      by: "human",
      label: "human edit",
      undone: false,
    });
  });

  it("auto-layout places the second tile beside the first", () => {
    addTile();
    addTile();
    expect(s().doc.tiles[1]!.layout).toEqual({ x: 3, y: 0, w: 3, h: 2 });
  });

  it("agent mutations set agentPulse; human mutations do not", () => {
    const humanTile = addTile(human);
    const agentTile = addTile(agent);
    expect(s().agentPulse[agentTile]).toBeTypeOf("number");
    expect(s().agentPulse[humanTile]).toBeUndefined();
    s().clearAgentPulse(agentTile);
    expect(s().agentPulse[agentTile]).toBeUndefined();
  });

  it("activity log is capped at 100, newest first", () => {
    for (let i = 0; i < MAX_ACTIVITY + 5; i++) {
      s().setTitle(`t${i}`, { origin: "human", label: `cmd ${i}` });
    }
    expect(s().activityLog).toHaveLength(MAX_ACTIVITY);
    expect(s().activityLog[0]!.label).toBe(`cmd ${MAX_ACTIVITY + 4}`);
  });

  it("updateTile merges spec shallowly and reports unknown tiles", () => {
    const tileId = addTile();
    const ok = s().updateTile(tileId, { spec: { format: "number" } }, human);
    expect(ok.ok).toBe(true);
    expect(s().doc.tiles[0]!.spec).toMatchObject({
      measure: "amount",
      format: "number",
    });
    const missing = s().updateTile("nope", { title: "x" }, human);
    expect(missing.ok).toBe(false);
  });

  it("moveTile validates grid bounds", () => {
    const tileId = addTile();
    const bad = s().moveTile(tileId, { x: 8, y: 0, w: 6, h: 2 }, human);
    expect(bad).toMatchObject({ ok: false });
    const good = s().moveTile(tileId, { x: 6, y: 0, w: 6, h: 2 }, human);
    expect(good.ok).toBe(true);
  });

  it("setFilter upserts per column", () => {
    s().setFilter({ column: "plan", op: "eq", value: "pro" }, human);
    s().setFilter({ column: "plan", op: "in", value: ["pro", "team"] }, human);
    expect(s().doc.filters.filters).toHaveLength(1);
    expect(s().doc.filters.filters[0]!.op).toBe("in");
  });
});

describe("undo / redo", () => {
  it("undo restores the previous doc and marks the activity entry", () => {
    const tileId = addTile(agent);
    expect(s().doc.tiles).toHaveLength(1);
    expect(s().undo()).toMatchObject({ ok: true });
    expect(s().doc.tiles).toHaveLength(0);
    expect(s().activityLog[0]!.undone).toBe(true);
    expect(s().redoStack).toHaveLength(1);

    expect(s().redo()).toMatchObject({ ok: true });
    expect(s().doc.tiles[0]!.id).toBe(tileId);
    expect(s().activityLog[0]!.undone).toBe(false);
  });

  it("remove_tile is fully undoable (soft delete)", () => {
    const tileId = addTile();
    s().removeTile(tileId, agent);
    expect(s().doc.tiles).toHaveLength(0);
    s().undo();
    expect(s().doc.tiles.map((t) => t.id)).toEqual([tileId]);
  });

  it("a new command clears the redo stack", () => {
    addTile();
    s().undo();
    expect(s().redoStack).toHaveLength(1);
    addTile();
    expect(s().redoStack).toHaveLength(0);
  });

  it("undo with empty stack fails gracefully", () => {
    expect(s().undo()).toMatchObject({ ok: false });
    expect(s().redo()).toMatchObject({ ok: false });
  });

  it("undoing a tile removal keeps selection consistent", () => {
    const tileId = addTile();
    s().selectTile(tileId);
    s().removeTile(tileId, human);
    expect(s().selectedTileId).toBeNull();
  });
});

describe("conflict rule (10-minute human-edit window)", () => {
  it("agent overwrite of a fresh human edit returns a conflict", () => {
    const tileId = addTile();
    s().updateTile(tileId, { title: "Human title" }, human);
    const res = s().updateTile(tileId, { title: "Agent title" }, agent);
    expect(res).toMatchObject({
      ok: false,
      conflict: true,
      tileId,
      properties: ["title"],
    });
    expect(s().doc.tiles[0]!.title).toBe("Human title");
  });

  it("force: true overrides the conflict", () => {
    const tileId = addTile();
    s().updateTile(tileId, { title: "Human title" }, human);
    const res = s().updateTile(tileId, { title: "Agent title" }, {
      ...agent,
      force: true,
    });
    expect(res.ok).toBe(true);
    expect(s().doc.tiles[0]!.title).toBe("Agent title");
  });

  it("conflicts are per property: agent may edit untouched properties", () => {
    const tileId = addTile();
    s().updateTile(tileId, { title: "Human title" }, human);
    const res = s().updateTile(tileId, { spec: { format: "percent" } }, agent);
    expect(res.ok).toBe(true);
  });

  it("human -> human never conflicts; agent edits are not protected", () => {
    const tileId = addTile();
    s().updateTile(tileId, { title: "A" }, agent);
    expect(s().updateTile(tileId, { title: "B" }, agent).ok).toBe(true);
    expect(s().updateTile(tileId, { title: "C" }, human).ok).toBe(true);
  });

  it("moveTile conflicts after a human move", () => {
    const tileId = addTile();
    s().moveTile(tileId, { x: 1, y: 0, w: 3, h: 2 }, human);
    const res = s().moveTile(tileId, { x: 5, y: 0, w: 3, h: 2 }, agent);
    expect(res).toMatchObject({ ok: false, conflict: true, properties: ["layout"] });
  });

  it("dashboard-scoped conflicts: title, theme, dateRange, filter:<col>", () => {
    s().setTitle("Human title", human);
    expect(s().setTitle("Agent title", agent)).toMatchObject({ conflict: true });

    s().setTheme({ mode: "light" }, human);
    expect(s().setTheme({ mode: "dark" }, agent)).toMatchObject({ conflict: true });

    s().setDateRange({ from: "2025-01-01", to: "2025-02-01" }, human);
    expect(
      s().setDateRange({ from: "2025-03-01", to: "2025-04-01" }, agent),
    ).toMatchObject({ conflict: true });

    s().setFilter({ column: "plan", op: "eq", value: "pro" }, human);
    expect(
      s().setFilter({ column: "plan", op: "eq", value: "free" }, agent),
    ).toMatchObject({ conflict: true });
    // different column is fine
    expect(
      s().setFilter({ column: "region", op: "eq", value: "eu" }, agent).ok,
    ).toBe(true);
  });
});

describe("recentHumanEdits window", () => {
  it("records human edits with tile/dashboard scope", () => {
    const tileId = addTile();
    s().updateTile(tileId, { title: "T", spec: { format: "number" } }, human);
    s().setTitle("Dash", human);
    const props = s().recentHumanEdits.map((e) => `${e.tileId}:${e.property}`);
    expect(props).toContain(`${tileId}:title`);
    expect(props).toContain(`${tileId}:spec.format`);
    expect(props).toContain(`${DASHBOARD_SCOPE}:title`);
  });

  it("expires entries after 10 minutes (agent may edit again)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const tileId = addTile();
    s().updateTile(tileId, { title: "Human title" }, human);
    expect(s().updateTile(tileId, { title: "Agent" }, agent)).toMatchObject({
      conflict: true,
    });

    vi.setSystemTime(new Date("2026-01-01T12:09:59Z"));
    expect(s().updateTile(tileId, { title: "Agent" }, agent)).toMatchObject({
      conflict: true,
    });

    vi.setSystemTime(new Date("2026-01-01T12:10:01Z"));
    const res = s().updateTile(tileId, { title: "Agent title" }, agent);
    expect(res.ok).toBe(true);
    // pruned on commit
    expect(
      s().recentHumanEdits.filter(
        (e) => Date.now() - e.at >= HUMAN_EDIT_WINDOW_MS,
      ),
    ).toHaveLength(0);
  });

  it("re-editing refreshes the window instead of duplicating entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
    const tileId = addTile();
    s().updateTile(tileId, { title: "A" }, human);
    vi.setSystemTime(new Date("2026-01-01T12:05:00Z"));
    s().updateTile(tileId, { title: "B" }, human);
    const entries = s().recentHumanEdits.filter(
      (e) => e.tileId === tileId && e.property === "title",
    );
    expect(entries).toHaveLength(1);
    // window counts from the second edit
    vi.setSystemTime(new Date("2026-01-01T12:12:00Z"));
    expect(s().updateTile(tileId, { title: "C" }, agent)).toMatchObject({
      conflict: true,
    });
  });
});

describe("selection state", () => {
  it("tracks select/hover/brush and clears on tile removal", () => {
    const tileId = addTile();
    s().selectTile(tileId);
    s().setHoveredTile(tileId);
    s().setBrushedRange({ tileId, from: "2025-01-01", to: "2025-02-01" });
    expect(s().selectedTileId).toBe(tileId);
    expect(s().brushedRange?.from).toBe("2025-01-01");
    s().removeTile(tileId, human);
    expect(s().selectedTileId).toBeNull();
    expect(s().hoveredTileId).toBeNull();
    expect(s().brushedRange).toBeNull();
  });
});

describe("tidyLayout", () => {
  it("packs the active page upward in ONE undoable command", () => {
    const top = addTile();
    const stranded = s().addTile(
      { ...kpiInput, title: "Stranded", layout: { x: 0, y: 6, w: 3, h: 2 } },
      human,
    );
    if (!stranded.ok || !stranded.tileId) throw new Error("addTile failed");
    const undoDepth = s().undoStack.length;

    expect(s().tidyLayout({ origin: "human", label: "Tidied the layout" })).toMatchObject({
      ok: true,
    });
    const byId = new Map(s().doc.tiles.map((tile) => [tile.id, tile]));
    expect(byId.get(top)!.layout.y).toBe(0);
    // The stranded tile falls to the first free row under the top tile.
    expect(byId.get(stranded.tileId)!.layout.y).toBe(2);
    expect(s().undoStack).toHaveLength(undoDepth + 1);
    expect(s().activityLog[0]).toMatchObject({
      by: "human",
      label: "Tidied the layout",
    });

    // One undo restores every moved tile.
    s().undo();
    expect(
      s().doc.tiles.find((tile) => tile.id === stranded.tileId)!.layout.y,
    ).toBe(6);
  });

  it("refuses when the layout is already packed or the page is empty", () => {
    expect(s().tidyLayout(human)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no visuals"),
    });
    addTile();
    expect(s().tidyLayout(human)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already tidy"),
    });
  });
});
