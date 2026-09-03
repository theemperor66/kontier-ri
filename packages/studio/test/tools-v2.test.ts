import { beforeEach, describe, expect, it } from "vitest";
import {
  assertReadOnly,
  assertSelectOnly,
  type ColumnMeta,
  type ColumnProfile,
  type DataSource,
  type DatasetMeta,
  type QueryResult,
} from "@kontier-ri/datasource";
import { useDashboardStore } from "../src/store";
import {
  buildStaticTools,
  csvCell,
  toCSV,
  STATIC_TOOL_NAMES,
  type ToolDefinition,
} from "../src/webmcp/tools";
import type { AddTileInput } from "../src/types";

class FakeDataSource implements DataSource {
  queries: string[] = [];
  views = new Map<string, string>();
  failNextQuery = false;

  listDatasets(): Promise<DatasetMeta[]> {
    return Promise.resolve([
      {
        name: "invoices",
        group: "saas_billing",
        rowCount: 1200,
        columns: [
          { name: "month", type: "VARCHAR", nullable: false },
          { name: "plan", type: "VARCHAR", nullable: false },
          { name: "revenue", type: "DOUBLE", nullable: false },
        ],
      },
      ...[...this.views.keys()].map((name) => ({
        name,
        group: "views",
        rowCount: 5,
        columns: [] as ColumnMeta[],
      })),
    ]);
  }

  getSchema(): Promise<ColumnMeta[]> {
    return Promise.resolve([
      { name: "month", type: "VARCHAR", nullable: false },
      { name: "plan", type: "VARCHAR", nullable: false },
      { name: "revenue", type: "DOUBLE", nullable: false },
    ]);
  }

  runQuery(sql: string): Promise<QueryResult> {
    assertReadOnly(sql);
    this.queries.push(sql);
    if (this.failNextQuery) {
      this.failNextQuery = false;
      return Promise.reject(new Error("Binder Error: column not found"));
    }
    return Promise.resolve({
      columns: [
        { name: "plan", type: "VARCHAR", nullable: false },
        { name: "revenue", type: "DOUBLE", nullable: false },
      ],
      rows: [
        ["pro", 100],
        ['we,ird "plan"', 250.5],
      ],
      rowCount: 2,
      truncated: false,
    });
  }

  profileColumn(): Promise<ColumnProfile> {
    throw new Error("not used");
  }

  createView(name: string, sql: string): Promise<DatasetMeta> {
    assertSelectOnly(sql);
    if (/does_not_exist/.test(sql)) {
      return Promise.reject(new Error("Catalog Error: no such table"));
    }
    this.views.set(name, sql);
    return Promise.resolve({
      name,
      group: "views",
      rowCount: 5,
      columns: [{ name: "month", type: "VARCHAR", nullable: false }],
    });
  }

  dropView(name: string): Promise<void> {
    this.views.delete(name);
    return Promise.resolve();
  }
}

let ds: FakeDataSource;
let tools: Map<string, ToolDefinition>;
const s = () => useDashboardStore.getState();
const signal = new AbortController().signal;

const run = (name: string, input: unknown): Promise<unknown> => {
  const def = tools.get(name);
  if (!def) throw new Error(`no tool ${name}`);
  const parsed = def.inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(`invalid test input for ${name}`);
  return Promise.resolve(def.execute(parsed.data, signal));
};

const chartInput: AddTileInput = {
  type: "chart",
  title: "Revenue by plan",
  spec: {
    dataset: "invoices",
    query: { dims: ["plan"], measures: [{ col: "revenue", agg: "sum" }] },
    chartType: "bar",
    xKey: "plan",
  },
};

beforeEach(() => {
  s().resetDashboard();
  ds = new FakeDataSource();
  tools = new Map(
    buildStaticTools({ dataSource: ds as DataSource }).map((d) => [d.name, d]),
  );
});

describe("v2 tool inventory", () => {
  it("registers 40 static tools incl. v2, presence, and collaboration tools", () => {
    expect([...tools.keys()]).toEqual([...STATIC_TOOL_NAMES]);
    expect(tools.size).toBe(40);
    for (const name of [
      "set_tile_filters",
      "set_cross_filter",
      "clear_cross_filter",
      "add_page",
      "rename_page",
      "remove_page",
      "switch_page",
      "create_calculated_field",
      "list_calculated_fields",
      "remove_calculated_field",
      "create_view",
      "remove_view",
      "export_tile_data",
    ]) {
      expect(tools.has(name), name).toBe(true);
    }
  });
});

describe("page tools", () => {
  it("add/rename/switch/remove pages end to end", async () => {
    const added = (await run("add_page", { name: "Churn" })) as {
      ok?: boolean;
      pageId?: string;
    };
    expect(added.ok).toBe(true);
    const pageId = added.pageId!;
    expect(s().doc.activePageId).toBe(pageId);

    expect(
      await run("rename_page", { pageId, name: "Churn & retention" }),
    ).toMatchObject({ ok: true });
    expect(s().doc.pages[1]!.name).toBe("Churn & retention");

    const first = s().doc.pages[0]!.id;
    expect(await run("switch_page", { pageId: first })).toMatchObject({
      ok: true,
    });
    expect(s().doc.activePageId).toBe(first);

    expect(await run("remove_page", { pageId })).toMatchObject({ ok: true });
    expect(s().doc.pages).toHaveLength(1);
    expect(
      await run("remove_page", { pageId: first }),
    ).toMatchObject({ error: expect.stringContaining("last page") });
    expect(await run("switch_page", { pageId: "nope" })).toMatchObject({
      error: expect.stringContaining("nope"),
    });
  });

  it("get_dashboard_state is page- and crossFilter-aware", async () => {
    s().addTile(chartInput, { origin: "human", label: "add" });
    await run("add_page", { name: "Two" });
    await run("set_cross_filter", { column: "plan", value: "pro" });
    const state = (await run("get_dashboard_state", {})) as Record<
      string,
      unknown
    >;
    expect(state["activePageId"]).toBe(s().doc.activePageId);
    expect(state["pages"]).toEqual([
      expect.objectContaining({ name: "Overview", tileCount: 1 }),
      expect.objectContaining({ name: "Two", tileCount: 0, active: true }),
    ]);
    expect(state["crossFilter"]).toEqual({ column: "plan", value: "pro" });
    // tiles reflect the ACTIVE page (empty page Two).
    expect(state["tiles"]).toEqual([]);
  });

  it("get_user_focus reports the active page and cross-filter", async () => {
    await run("set_cross_filter", { column: "plan", value: "pro", sourceTileId: "t9" });
    const focus = (await run("get_user_focus", {})) as Record<string, unknown>;
    expect(focus["crossFilter"]).toEqual({
      column: "plan",
      value: "pro",
      sourceTileId: "t9",
    });
    expect(focus["activePage"]).toEqual(
      expect.objectContaining({ name: "Overview" }),
    );
  });
});

describe("cross-filter + tile-filter tools", () => {
  it("set/clear cross filter round-trips and logs activity", async () => {
    expect(
      await run("set_cross_filter", { column: "plan", value: "pro" }),
    ).toMatchObject({ ok: true });
    expect(s().doc.crossFilter).toEqual({ column: "plan", value: "pro" });
    expect(s().activityLog[0]!.by).toBe("agent");
    expect(await run("clear_cross_filter", {})).toMatchObject({ ok: true });
    expect(s().doc.crossFilter).toBeNull();
    expect(await run("clear_cross_filter", {})).toMatchObject({
      error: expect.any(String),
    });
  });

  it("set_tile_filters validates the tile and respects conflicts", async () => {
    const added = s().addTile(chartInput, { origin: "human", label: "add" });
    if (!added.ok || !added.tileId) throw new Error("addTile failed");
    const tileId = added.tileId;
    expect(
      await run("set_tile_filters", {
        tileId,
        filters: [{ column: "plan", op: "eq", value: "pro" }],
      }),
    ).toMatchObject({ ok: true });
    expect(
      (s().doc.tiles[0]!.spec as { filters?: unknown[] }).filters,
    ).toHaveLength(1);

    // Human just set the tile's filters -> agent write conflicts w/o force.
    s().setTileFilters(tileId, [], { origin: "human", label: "clear" });
    expect(
      await run("set_tile_filters", {
        tileId,
        filters: [{ column: "plan", op: "eq", value: "x" }],
      }),
    ).toMatchObject({ conflict: true });
    expect(
      await run("set_tile_filters", {
        tileId,
        filters: [{ column: "plan", op: "eq", value: "x" }],
        force: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await run("set_tile_filters", { tileId: "nope", filters: [] }),
    ).toMatchObject({ error: expect.stringContaining("nope") });
  });
});

describe("calculated field tools", () => {
  it("probes the expression, saves with kind, lists and removes", async () => {
    const res = (await run("create_calculated_field", {
      name: "arpu",
      dataset: "invoices",
      expression: "sum(revenue) / count(DISTINCT plan)",
    })) as Record<string, unknown>;
    expect(res["ok"]).toBe(true);
    expect(res["kind"]).toBe("aggregate");
    // The probe query ran against the dataset.
    expect(ds.queries.some((q) => q.includes("sum(revenue)"))).toBe(true);

    expect(await run("list_calculated_fields", {})).toEqual([
      expect.objectContaining({ name: "arpu", kind: "aggregate" }),
    ]);
    expect(await run("remove_calculated_field", { name: "arpu" })).toMatchObject(
      { ok: true },
    );
    expect(await run("list_calculated_fields", {})).toEqual([]);
  });

  it("rejects expressions that fail against the dataset", async () => {
    ds.failNextQuery = true;
    const res = (await run("create_calculated_field", {
      name: "bad",
      dataset: "invoices",
      expression: "sum(does_not_exist)",
    })) as Record<string, unknown>;
    expect(res["error"]).toContain("Binder Error");
    expect(s().doc.calculatedFields).toHaveLength(0);
  });
});

describe("view tools", () => {
  it("creates a namespaced view in the engine AND the doc registry", async () => {
    const res = (await run("create_view", {
      name: "mrr",
      sql: "SELECT month, sum(revenue) AS mrr FROM invoices GROUP BY 1",
    })) as Record<string, unknown>;
    expect(res["ok"]).toBe(true);
    expect(res["name"]).toBe("view_mrr");
    expect(ds.views.has("view_mrr")).toBe(true);
    expect(s().doc.views[0]).toMatchObject({ name: "view_mrr" });

    // Duplicate rejected before touching the engine.
    expect(
      await run("create_view", { name: "view_mrr", sql: "SELECT 1" }),
    ).toMatchObject({ error: expect.stringContaining("already exists") });

    expect(await run("remove_view", { name: "mrr" })).toMatchObject({
      ok: true,
      removed: true,
    });
    expect(ds.views.has("view_mrr")).toBe(false);
    expect(s().doc.views).toHaveLength(0);
  });

  it("propagates engine errors and blocks non-SELECT bodies", async () => {
    expect(
      await run("create_view", { name: "x", sql: "DROP TABLE invoices" }),
    ).toMatchObject({ error: expect.stringContaining("read-only") });
    expect(
      await run("create_view", {
        name: "y",
        sql: "SELECT * FROM does_not_exist",
      }),
    ).toMatchObject({ error: expect.stringContaining("Catalog Error") });
    expect(s().doc.views).toHaveLength(0);
  });
});

describe("export_tile_data", () => {
  it("returns CSV with proper quoting and the doc's filters applied", async () => {
    const added = s().addTile(chartInput, { origin: "human", label: "add" });
    if (!added.ok || !added.tileId) throw new Error("addTile failed");
    s().setFilter(
      { column: "plan", op: "eq", value: "pro" },
      { origin: "human", label: "filter" },
    );
    const res = (await run("export_tile_data", {
      tileId: added.tileId,
    })) as Record<string, unknown>;
    expect(res["csv"]).toBe(
      'plan,revenue\npro,100\n"we,ird ""plan""",250.5',
    );
    expect(res["rowCount"]).toBe(2);
    // The executed SQL respected the global filter (schema-verified).
    expect(ds.queries.at(-1)).toContain(`"plan" = 'pro'`);
  });

  it("errors on markdown tiles and unknown tiles", async () => {
    const md = s().addTile(
      { type: "markdown", title: "n", spec: { content: "hi" } },
      { origin: "human", label: "add" },
    );
    if (!md.ok || !md.tileId) throw new Error("addTile failed");
    expect(await run("export_tile_data", { tileId: md.tileId })).toMatchObject({
      error: expect.stringContaining("no data"),
    });
    expect(await run("export_tile_data", { tileId: "nope" })).toMatchObject({
      error: expect.stringContaining("nope"),
    });
  });
});

describe("csv helpers", () => {
  it("csvCell quotes commas/quotes/newlines and passes plain values", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(1.5)).toBe("1.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("toCSV joins header + rows", () => {
    expect(
      toCSV([{ name: "a" }, { name: "b" }], [[1, "x"], [2, "y"]]),
    ).toBe("a,b\n1,x\n2,y");
  });
});
