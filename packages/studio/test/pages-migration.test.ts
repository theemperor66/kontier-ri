import { beforeEach, describe, expect, it } from "vitest";
import { migrateDoc, V1_PAGE_ID, withActivePageMirror } from "../src/migrate";
import { useDashboardStore } from "../src/store";
import type {
  ActionMeta,
  AddTileInput,
  DashboardDocInput,
  Tile,
} from "../src/types";
import { DOC_VERSION } from "../src/types";

const human: ActionMeta = { origin: "human", label: "human edit" };
const agent: ActionMeta = { origin: "agent", label: "agent edit" };

const s = () => useDashboardStore.getState();

const kpiInput: AddTileInput = {
  type: "kpi",
  title: "MRR",
  spec: { dataset: "invoices", measure: "amount", agg: "sum", format: "currency" },
};

function addTile(meta: ActionMeta = human): string {
  const res = s().addTile(kpiInput, meta);
  if (!res.ok || !res.tileId) throw new Error("addTile failed");
  return res.tileId;
}

function v1Tile(id: string): Tile {
  return {
    id,
    type: "kpi",
    title: id,
    layout: { x: 0, y: 0, w: 3, h: 2 },
    spec: { dataset: "invoices", measure: "amount", agg: "sum", format: "currency" },
    annotations: [],
  };
}

/** A doc exactly as v1 shipped it (share URLs / localStorage). */
function v1Doc(): DashboardDocInput {
  return {
    title: "Old dashboard",
    theme: { mode: "dark" },
    filters: {
      filters: [{ column: "plan", op: "eq", value: "pro" }],
      dateRange: { from: "2025-01-01", to: "2025-06-30" },
    },
    tiles: [v1Tile("t1"), v1Tile("t2")],
  };
}

beforeEach(() => {
  s().resetDashboard();
});

describe("migrateDoc (v1 -> v2)", () => {
  it("loads a v1 doc as a single Overview page", () => {
    const doc = migrateDoc(v1Doc());
    expect(doc.version).toBe(DOC_VERSION);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]).toMatchObject({ id: V1_PAGE_ID, name: "Overview" });
    expect(doc.pages[0]!.tiles.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(doc.activePageId).toBe(V1_PAGE_ID);
    // Mirror invariant: doc.tiles IS the active page's tiles.
    expect(doc.tiles).toBe(doc.pages[0]!.tiles);
    // v1 payload preserved.
    expect(doc.title).toBe("Old dashboard");
    expect(doc.filters.filters).toHaveLength(1);
    expect(doc.filters.dateRange).toEqual({ from: "2025-01-01", to: "2025-06-30" });
    // v2 registries initialized empty.
    expect(doc.crossFilter).toBeNull();
    expect(doc.calculatedFields).toEqual([]);
    expect(doc.views).toEqual([]);
  });

  it("is idempotent on v2 docs and repairs a broken activePageId", () => {
    const once = migrateDoc(v1Doc());
    const twice = migrateDoc({ ...once, activePageId: "gone" });
    expect(twice.pages).toHaveLength(1);
    expect(twice.activePageId).toBe(V1_PAGE_ID);
    expect(twice.tiles).toBe(twice.pages[0]!.tiles);
  });

  it("resetDashboard migrates v1 docs (old share-URL path)", () => {
    s().resetDashboard(v1Doc());
    const doc = s().doc;
    expect(doc.pages).toHaveLength(1);
    expect(doc.tiles).toHaveLength(2);
    expect(doc.activePageId).toBe(V1_PAGE_ID);
  });

  it("withActivePageMirror re-points tiles at the active page", () => {
    const doc = migrateDoc(v1Doc());
    const moved = withActivePageMirror({
      ...doc,
      pages: [...doc.pages, { id: "p2", name: "Two", tiles: [] }],
      activePageId: "p2",
    });
    expect(moved.tiles).toBe(moved.pages[1]!.tiles);
  });
});

describe("pages CRUD", () => {
  it("addPage creates, activates and returns pageId; undo restores", () => {
    addTile();
    const before = s().doc.activePageId;
    const res = s().addPage("Retention", agent);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pageId).toBeTruthy();
    expect(s().doc.pages).toHaveLength(2);
    expect(s().doc.activePageId).toBe(res.pageId);
    expect(s().doc.tiles).toHaveLength(0); // mirror now shows the empty page
    expect(s().activityLog[0]!.by).toBe("agent");
    s().undo();
    expect(s().doc.pages).toHaveLength(1);
    expect(s().doc.activePageId).toBe(before);
    expect(s().doc.tiles).toHaveLength(1);
  });

  it("tiles added after a page switch land on the active page", () => {
    addTile();
    const res = s().addPage("Two", human);
    if (!res.ok) throw new Error("addPage failed");
    addTile();
    const doc = s().doc;
    expect(doc.pages[0]!.tiles).toHaveLength(1);
    expect(doc.pages[1]!.tiles).toHaveLength(1);
    expect(doc.tiles).toBe(doc.pages[1]!.tiles);
  });

  it("renamePage renames; removePage refuses on the last page", () => {
    const res = s().addPage("Tmp", human);
    if (!res.ok || !res.pageId) throw new Error("addPage failed");
    expect(s().renamePage(res.pageId, "Renamed", human).ok).toBe(true);
    expect(s().doc.pages[1]!.name).toBe("Renamed");
    expect(s().renamePage("nope", "x", human).ok).toBe(false);
    expect(s().removePage(res.pageId, human).ok).toBe(true);
    expect(s().doc.pages).toHaveLength(1);
    const last = s().removePage(s().doc.pages[0]!.id, human);
    expect(last).toMatchObject({ ok: false });
  });

  it("removing the active page activates the first remaining page", () => {
    const res = s().addPage("Two", human);
    if (!res.ok || !res.pageId) throw new Error("addPage failed");
    expect(s().doc.activePageId).toBe(res.pageId);
    s().removePage(res.pageId, human);
    expect(s().doc.activePageId).toBe(s().doc.pages[0]!.id);
  });

  it("switchPage switches the mirror and clears stale selection", () => {
    const tileId = addTile();
    s().selectTile(tileId);
    const res = s().addPage("Two", human);
    if (!res.ok || !res.pageId) throw new Error("addPage failed");
    // addPage already activated page 2; selection referenced page 1 tile.
    expect(s().selectedTileId).toBeNull();
    const first = s().doc.pages[0]!.id;
    expect(s().switchPage(first, human).ok).toBe(true);
    expect(s().doc.tiles).toHaveLength(1);
    const noop = s().switchPage(first, human);
    expect(noop).toMatchObject({ ok: false });
    expect(s().switchPage("nope", human).ok).toBe(false);
  });

  it("tile commands reach tiles on inactive pages", () => {
    const tileId = addTile();
    s().addPage("Two", human);
    // t1 lives on page 1, which is now inactive.
    const res = s().updateTile(tileId, { title: "renamed" }, human);
    expect(res.ok).toBe(true);
    expect(s().doc.pages[0]!.tiles[0]!.title).toBe("renamed");
    expect(s().removeTile(tileId, human).ok).toBe(true);
    expect(s().doc.pages[0]!.tiles).toHaveLength(0);
  });
});

describe("cross-filter state", () => {
  it("setCrossFilter stores it in the doc, undoable + activity-logged", () => {
    const res = s().setCrossFilter(
      { column: "plan", value: "pro", sourceTileId: "t1" },
      agent,
    );
    expect(res.ok).toBe(true);
    expect(s().doc.crossFilter).toEqual({
      column: "plan",
      value: "pro",
      sourceTileId: "t1",
    });
    expect(s().activityLog[0]!.by).toBe("agent");
    s().undo();
    expect(s().doc.crossFilter).toBeNull();
    s().redo();
    expect(s().doc.crossFilter).toMatchObject({ column: "plan" });
  });

  it("clearCrossFilter clears; errors when none active", () => {
    expect(s().clearCrossFilter(human).ok).toBe(false);
    s().setCrossFilter({ column: "plan", value: "pro" }, human);
    expect(s().clearCrossFilter(human).ok).toBe(true);
    expect(s().doc.crossFilter).toBeNull();
  });

  it("setTileIgnoreCrossFilter toggles the per-tile opt-out", () => {
    const tileId = addTile();
    expect(s().setTileIgnoreCrossFilter(tileId, true, human).ok).toBe(true);
    expect(s().doc.tiles[0]!.ignoreCrossFilter).toBe(true);
    expect(s().setTileIgnoreCrossFilter("nope", true, human).ok).toBe(false);
  });
});

describe("tile filters", () => {
  it("setTileFilters sets spec.filters and rejects markdown tiles", () => {
    const tileId = addTile();
    const res = s().setTileFilters(
      tileId,
      [{ column: "region", op: "eq", value: "EU" }],
      agent,
    );
    expect(res.ok).toBe(true);
    expect((s().doc.tiles[0]!.spec as { filters?: unknown }).filters).toEqual([
      { column: "region", op: "eq", value: "EU" },
    ]);
    const md = s().addTile(
      { type: "markdown", title: "Note", spec: { content: "hi" } },
      human,
    );
    if (!md.ok || !md.tileId) throw new Error("markdown addTile failed");
    expect(s().setTileFilters(md.tileId, [], human).ok).toBe(false);
  });
});

describe("calculated fields registry", () => {
  it("adds with auto-detected kind, rejects duplicates + bad names", () => {
    const res = s().addCalculatedField(
      {
        name: "arpu",
        dataset: "invoices",
        expression: "sum(amount) / count(DISTINCT customer_id)",
      },
      agent,
    );
    expect(res.ok).toBe(true);
    expect(s().doc.calculatedFields[0]).toMatchObject({
      name: "arpu",
      kind: "aggregate",
    });
    const rowKind = s().addCalculatedField(
      { name: "net", dataset: "invoices", expression: "amount - tax" },
      human,
    );
    expect(rowKind.ok).toBe(true);
    expect(s().doc.calculatedFields[1]!.kind).toBe("row");
    expect(
      s().addCalculatedField(
        { name: "arpu", dataset: "x", expression: "1" },
        human,
      ).ok,
    ).toBe(false);
    expect(
      s().addCalculatedField(
        { name: "bad name!", dataset: "x", expression: "1" },
        human,
      ).ok,
    ).toBe(false);
  });

  it("rejects side effects in expressions; remove + undo round-trips", () => {
    expect(
      s().addCalculatedField(
        { name: "evil", dataset: "x", expression: "1; DROP TABLE t" },
        agent,
      ).ok,
    ).toBe(false);
    expect(
      s().addCalculatedField(
        { name: "evil2", dataset: "x", expression: "delete from t" },
        agent,
      ).ok,
    ).toBe(false);
    s().addCalculatedField(
      { name: "net", dataset: "invoices", expression: "amount - tax" },
      human,
    );
    expect(s().removeCalculatedField("net", human).ok).toBe(true);
    expect(s().doc.calculatedFields).toHaveLength(0);
    expect(s().removeCalculatedField("net", human).ok).toBe(false);
    s().undo();
    expect(s().doc.calculatedFields).toHaveLength(1);
  });
});

describe("views registry", () => {
  it("namespaces names with view_ and guards the SELECT body", () => {
    const res = s().addView(
      { name: "monthly_mrr", sql: "SELECT month, sum(amount) FROM invoices GROUP BY 1" },
      agent,
    );
    expect(res.ok).toBe(true);
    expect(s().doc.views[0]!.name).toBe("view_monthly_mrr");
    // Already-prefixed names are not double-prefixed.
    const pre = s().addView({ name: "view_x", sql: "SELECT 1" }, human);
    expect(pre.ok).toBe(true);
    expect(s().doc.views[1]!.name).toBe("view_x");
    // Non-SELECT bodies are rejected.
    expect(
      s().addView({ name: "evil", sql: "DROP TABLE invoices" }, agent).ok,
    ).toBe(false);
    expect(
      s().addView({ name: "evil2", sql: "DESCRIBE invoices" }, agent).ok,
    ).toBe(false);
    expect(
      s().addView(
        { name: "evil3", sql: "SELECT 1; DROP TABLE invoices" },
        agent,
      ).ok,
    ).toBe(false);
    // Duplicate names are rejected.
    expect(s().addView({ name: "monthly_mrr", sql: "SELECT 2" }, human).ok).toBe(
      false,
    );
  });

  it("removeView accepts unprefixed names; undo restores", () => {
    s().addView({ name: "v1", sql: "SELECT 1" }, human);
    expect(s().removeView("v1", human).ok).toBe(true);
    expect(s().doc.views).toHaveLength(0);
    s().undo();
    expect(s().doc.views).toHaveLength(1);
    expect(s().removeView("nope", human).ok).toBe(false);
  });
});
