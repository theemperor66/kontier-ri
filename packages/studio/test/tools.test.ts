import { beforeEach, describe, expect, it } from "vitest";
import {
  assertReadOnly,
  type ColumnMeta,
  type ColumnProfile,
  type DataSource,
  type DatasetMeta,
  type QueryResult,
} from "@kontier-ri/datasource";
import { useDashboardStore } from "../src/store";
import {
  buildSelectedTileTools,
  buildStaticTools,
  compactValue,
  sanitizeMarkdown,
  STATIC_TOOL_NAMES,
  type ToolDefinition,
} from "../src/webmcp/tools";
import type { AddTileInput } from "../src/types";

// ---------------------------------------------------------------------------
// Fake DataSource: applies the real read-only guard like DuckDBDataSource.
// ---------------------------------------------------------------------------

class FakeDataSource implements DataSource {
  queries: string[] = [];
  /** Rows returned by the next runQuery calls (FIFO; last one sticks). */
  results: QueryResult[] = [];

  constructor(private readonly rowCount = 3) {}

  private makeResult(): QueryResult {
    if (this.results.length > 0) {
      return this.results.length > 1
        ? this.results.shift()!
        : this.results[0]!;
    }
    const columns: ColumnMeta[] = [
      { name: "month", type: "VARCHAR", nullable: false },
      { name: "revenue", type: "DOUBLE", nullable: false },
    ];
    const rows = Array.from({ length: this.rowCount }, (_, i) => [
      `2025-0${i + 1}`,
      (i + 1) * 100,
    ]);
    return { columns, rows, rowCount: rows.length, truncated: false };
  }

  listDatasets(): Promise<DatasetMeta[]> {
    return Promise.resolve([
      { name: "invoices", group: "saas_billing", rowCount: 1200, columns: [] },
      { name: "payments", rowCount: 800, columns: [] },
    ]);
  }

  getSchema(dataset: string): Promise<ColumnMeta[]> {
    if (dataset !== "invoices" && dataset !== "payments") {
      return Promise.reject(new Error(`Unknown dataset: ${dataset}`));
    }
    return Promise.resolve([
      { name: "month", type: "VARCHAR", nullable: false },
      { name: "plan", type: "VARCHAR", nullable: false },
      { name: "revenue", type: "DOUBLE", nullable: false },
    ]);
  }

  runQuery(sql: string): Promise<QueryResult> {
    assertReadOnly(sql); // same guard the real DuckDB datasource applies
    this.queries.push(sql);
    return Promise.resolve(this.makeResult());
  }

  profileColumn(dataset: string, column: string): Promise<ColumnProfile> {
    return Promise.resolve({
      dataset,
      column,
      type: column === "revenue" ? "DOUBLE" : "VARCHAR",
      count: 1200,
      nulls: 3,
      distinct: 42,
      min: 1,
      max: 999,
      topValues: Array.from({ length: 10 }, (_, i) => ({
        value: `v${i}`,
        count: 100 - i,
      })),
    });
  }
}

// ---------------------------------------------------------------------------

let ds: FakeDataSource;
let tools: Map<string, ToolDefinition>;
let dynamicTools: Map<string, ToolDefinition>;

const s = () => useDashboardStore.getState();
const signal = new AbortController().signal;

const run = (name: string, input: unknown): Promise<unknown> => {
  const def = tools.get(name) ?? dynamicTools.get(name);
  if (!def) throw new Error(`no tool ${name}`);
  const parsed = def.inputSchema.safeParse(input);
  if (!parsed.success) throw new Error(`invalid test input for ${name}`);
  return Promise.resolve(def.execute(parsed.data, signal));
};

const chartInput: AddTileInput = {
  type: "chart",
  title: "Revenue by month",
  spec: {
    dataset: "invoices",
    query: { dims: ["month"], measures: [{ col: "revenue", agg: "sum" }] },
    chartType: "line",
    xKey: "month",
  },
};

beforeEach(() => {
  s().resetDashboard();
  ds = new FakeDataSource();
  const ctx = { dataSource: ds as DataSource };
  tools = new Map(buildStaticTools(ctx).map((d) => [d.name, d]));
  dynamicTools = new Map(buildSelectedTileTools(ctx).map((d) => [d.name, d]));
});

describe("tool inventory", () => {
  it("registers exactly the 40 static + 3 dynamic tools", () => {
    expect([...tools.keys()]).toEqual([...STATIC_TOOL_NAMES]);
    expect(tools.size).toBe(40);
    expect([...dynamicTools.keys()]).toEqual([
      "edit_selected_tile",
      "restyle_selected_tile",
      "explain_selected_tile",
    ]);
  });
});

describe("data tools", () => {
  it("list_datasets returns name/rowCount/description", async () => {
    expect(await run("list_datasets", {})).toEqual([
      { name: "invoices", rowCount: 1200, description: "saas_billing dataset" },
      { name: "payments", rowCount: 800 },
    ]);
  });

  it("get_dataset_schema maps columns and reports unknown datasets", async () => {
    const cols = (await run("get_dataset_schema", { dataset: "invoices" })) as {
      column: string;
    }[];
    expect(cols.map((c) => c.column)).toEqual(["month", "plan", "revenue"]);
    expect(
      await run("get_dataset_schema", { dataset: "nope" }),
    ).toMatchObject({ error: expect.stringContaining("nope") });
  });

  it("profile_column caps topValues at 8 and adds mean/p50 for numerics", async () => {
    ds.results = [
      {
        columns: [
          { name: "mean", type: "DOUBLE", nullable: true },
          { name: "p50", type: "DOUBLE", nullable: true },
        ],
        rows: [[123.4, 99]],
        rowCount: 1,
        truncated: false,
      },
    ];
    const numeric = (await run("profile_column", {
      dataset: "invoices",
      column: "revenue",
    })) as Record<string, unknown>;
    expect((numeric["topValues"] as unknown[]).length).toBe(8);
    expect(numeric["mean"]).toBe(123.4);
    expect(numeric["p50"]).toBe(99);

    ds.queries = [];
    const text = (await run("profile_column", {
      dataset: "invoices",
      column: "plan",
    })) as Record<string, unknown>;
    expect(text["mean"]).toBeUndefined();
    expect(ds.queries).toHaveLength(0); // no stats query for VARCHAR
  });

  it("sample_rows truncates long values to 120 chars", async () => {
    ds.results = [
      {
        columns: [{ name: "notes", type: "VARCHAR", nullable: false }],
        rows: [["x".repeat(500)]],
        rowCount: 1,
        truncated: false,
      },
    ];
    const res = (await run("sample_rows", { dataset: "invoices" })) as {
      rows: string[][];
    };
    expect(res.rows[0]![0]!.length).toBe(120);
  });
});

describe("run_sql guard passthrough", () => {
  it("executes SELECTs through the datasource with a row cap", async () => {
    const res = (await run("run_sql", {
      sql: "SELECT month, sum(revenue) FROM invoices GROUP BY 1",
      limit: 5,
    })) as Record<string, unknown>;
    expect(res["error"]).toBeUndefined();
    expect(res["rowCount"]).toBe(3);
    expect(res["truncated"]).toBe(false);
    expect(ds.queries[0]).toContain("LIMIT 6"); // cap + 1 truncation probe
  });

  it("marks truncation when the cap is hit", async () => {
    ds.results = [
      {
        columns: [{ name: "n", type: "BIGINT", nullable: false }],
        rows: Array.from({ length: 3 }, (_, i) => [i]),
        rowCount: 3,
        truncated: false,
      },
    ];
    const res = (await run("run_sql", { sql: "SELECT 1", limit: 2 })) as {
      rowCount: number;
      truncated: boolean;
    };
    expect(res.rowCount).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it("rejects non-SELECT statements with {error, hint} and never hits the datasource", async () => {
    for (const sql of [
      "DROP TABLE invoices",
      "INSERT INTO invoices VALUES (1)",
      "PRAGMA version",
      "SELECT 1; SELECT 2",
      "ATTACH 'x.db'",
    ]) {
      const res = (await run("run_sql", { sql })) as Record<string, unknown>;
      expect(res["error"], sql).toBeTypeOf("string");
      expect(res["hint"], sql).toBeTypeOf("string");
    }
    expect(ds.queries).toHaveLength(0);
  });
});

describe("build tools", () => {
  it("add_tile creates an agent-attributed tile and returns its id", async () => {
    const res = (await run("add_tile", chartInput)) as { tileId: string };
    expect(res.tileId).toBeTypeOf("string");
    expect(s().doc.tiles[0]!.type).toBe("chart");
    expect(s().activityLog[0]).toMatchObject({
      by: "agent",
      label: 'Added chart tile "Revenue by month"',
    });
    expect(s().agentPulse[res.tileId]).toBeTypeOf("number");
  });

  it("add_tile rejects a spec that does not match the tile type", async () => {
    const res = (await run("add_tile", {
      type: "kpi",
      title: "Broken",
      spec: { content: "markdown spec on a kpi" },
    })) as Record<string, unknown>;
    expect(res["error"]).toContain('tile type "kpi"');
    expect(s().doc.tiles).toHaveLength(0);
  });

  it("add_tile strips raw HTML from markdown content", async () => {
    await run("add_tile", {
      type: "markdown",
      title: "Notes",
      spec: { content: "hello <script>alert(1)</script> world" },
    });
    const spec = s().doc.tiles[0]!.spec as { content: string };
    expect(spec.content).not.toContain("<script>");
    expect(spec.content).toContain("hello");
  });

  it("update_tile returns a conflict for fresh human edits; force overrides", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    s().updateTile(tileId, { title: "Human title" }, {
      origin: "human",
      label: "rename",
    });
    const conflicted = (await run("update_tile", {
      tileId,
      patch: { title: "Agent title" },
    })) as Record<string, unknown>;
    expect(conflicted).toMatchObject({
      conflict: true,
      properties: ["title"],
    });
    expect(conflicted["hint"]).toContain("force");
    expect(s().doc.tiles[0]!.title).toBe("Human title");

    const forced = (await run("update_tile", {
      tileId,
      patch: { title: "Agent title" },
      force: true,
    })) as Record<string, unknown>;
    expect(forced).toMatchObject({ ok: true });
    expect(s().doc.tiles[0]!.title).toBe("Agent title");
  });

  it("update_tile validates patch spec keys against the tile type", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    const res = (await run("update_tile", {
      tileId,
      patch: { spec: { bogusKey: 1 } },
    })) as Record<string, unknown>;
    expect(res["error"]).toContain("chart");
    const ok = (await run("update_tile", {
      tileId,
      patch: { spec: { chartType: "bar" } },
    })) as Record<string, unknown>;
    expect(ok).toMatchObject({ ok: true, updated: ["spec.chartType"] });
  });

  it("remove_tile responds with undoHint and store.undo() restores the tile", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    const res = (await run("remove_tile", { tileId })) as Record<string, unknown>;
    expect(res).toMatchObject({ ok: true, removed: true });
    expect(res["undoHint"]).toBeTypeOf("string");
    expect(s().doc.tiles).toHaveLength(0);
    expect(s().undo()).toMatchObject({ ok: true });
    expect(s().doc.tiles.map((t) => t.id)).toEqual([tileId]);
  });

  it("set_global_filter validates op/value combinations", async () => {
    expect(
      await run("set_global_filter", {
        column: "revenue",
        op: "between",
        value: "nope",
      }),
    ).toMatchObject({ error: expect.stringContaining("between") });
    expect(
      await run("set_global_filter", {
        column: "revenue",
        op: "between",
        value: [0, 100],
      }),
    ).toMatchObject({ ok: true });
  });

  it("set_date_range rejects inverted ranges", async () => {
    expect(
      await run("set_date_range", { from: "2025-06-01", to: "2025-01-01" }),
    ).toMatchObject({ error: expect.stringContaining("after") });
    expect(
      await run("set_date_range", { from: "2025-01-01", to: "2025-06-01" }),
    ).toMatchObject({ ok: true });
    expect(s().doc.filters.dateRange).toEqual({
      from: "2025-01-01",
      to: "2025-06-01",
    });
  });
});

describe("context tools", () => {
  it("get_dashboard_state returns a compact doc summary", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    await run("set_dashboard_title", { title: "Revenue 2025" });
    const state = (await run("get_dashboard_state", {})) as {
      title: string;
      tiles: Record<string, unknown>[];
    };
    expect(state.title).toBe("Revenue 2025");
    expect(state.tiles[0]).toMatchObject({
      tileId,
      type: "chart",
      specSummary: expect.stringContaining("line chart dataset=invoices"),
    });
  });

  it("get_user_focus reports selection, brush and recent human edits", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    s().selectTile(tileId);
    s().setBrushedRange({ tileId, from: "2025-02-01", to: "2025-03-01" });
    s().updateTile(tileId, { title: "Renamed" }, { origin: "human", label: "x" });
    const focus = (await run("get_user_focus", {})) as Record<string, unknown>;
    expect(focus["selectedTileId"]).toBe(tileId);
    expect(focus["brushedRange"]).toMatchObject({ from: "2025-02-01" });
    expect(focus["recentHumanEdits"]).toEqual([
      { tileId, property: "title", at: expect.any(String) },
    ]);
  });

  it("describe_tile includes a capped data summary", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    const desc = (await run("describe_tile", { tileId })) as {
      data: { rowCount: number };
      spec: unknown;
    };
    expect(desc.spec).toMatchObject({ chartType: "line" });
    expect(desc.data.rowCount).toBe(3);
    expect(ds.queries[0]).toContain('GROUP BY "month"');
  });

  it("get_activity_log lists newest first with undone flags", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    await run("remove_tile", { tileId });
    s().undo();
    const log = (await run("get_activity_log", {})) as Record<string, unknown>[];
    expect(log[0]).toMatchObject({
      by: "agent",
      label: 'Removed "Revenue by month"',
      undone: true,
    });
    expect(log[1]).toMatchObject({ by: "agent" });
  });
});

describe("dynamic selected-tile tools", () => {
  it("error out when nothing is selected", async () => {
    for (const name of [
      "edit_selected_tile",
      "restyle_selected_tile",
      "explain_selected_tile",
    ]) {
      const input = name === "edit_selected_tile" ? { patch: { title: "x" } } : {};
      expect(await run(name, input)).toMatchObject({
        error: expect.stringContaining("selected"),
      });
    }
  });

  it("edit_selected_tile patches the selected tile (conflict rule included)", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    s().selectTile(tileId);
    expect(
      await run("edit_selected_tile", { patch: { title: "Picked" } }),
    ).toMatchObject({ ok: true, tileId });
    expect(s().doc.tiles[0]!.title).toBe("Picked");

    s().updateTile(tileId, { title: "Mine" }, { origin: "human", label: "x" });
    expect(
      await run("edit_selected_tile", { patch: { title: "Agent" } }),
    ).toMatchObject({ conflict: true });
  });

  it("restyle_selected_tile only works on charts", async () => {
    const kpi = s().addTile(
      {
        type: "kpi",
        title: "MRR",
        spec: { dataset: "invoices", measure: "revenue", agg: "sum", format: "currency" },
      },
      { origin: "human", label: "add" },
    );
    s().selectTile(kpi.ok ? kpi.tileId! : null);
    expect(await run("restyle_selected_tile", { chartType: "bar" })).toMatchObject(
      { error: expect.stringContaining("kpi") },
    );

    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    s().selectTile(tileId);
    expect(
      await run("restyle_selected_tile", { chartType: "bar", color: "#f0f" }),
    ).toMatchObject({ ok: true });
    expect(s().doc.tiles[1]!.spec).toMatchObject({
      chartType: "bar",
      color: "#f0f",
    });
  });

  it("explain_selected_tile reports which global filters affect the tile", async () => {
    const { tileId } = (await run("add_tile", chartInput)) as { tileId: string };
    s().selectTile(tileId);
    await run("set_global_filter", { column: "plan", op: "eq", value: "pro" });
    await run("set_global_filter", { column: "not_a_column", op: "eq", value: 1 });
    await run("set_date_range", { from: "2025-01-01", to: "2025-06-30" });
    const res = (await run("explain_selected_tile", {})) as Record<string, unknown>;
    expect(res["affectedByFilters"]).toEqual([
      { column: "plan", op: "eq", value: "pro" },
    ]);
    expect(res["dateRange"]).toEqual({ from: "2025-01-01", to: "2025-06-30" });
    expect((res["data"] as { rowCount: number }).rowCount).toBe(3);
  });
});

describe("helpers", () => {
  it("compactValue truncates strings and stringifies objects", () => {
    expect(compactValue("short")).toBe("short");
    expect((compactValue("y".repeat(200)) as string).length).toBe(120);
    expect(compactValue({ a: 1 })).toBe('{"a":1}');
    expect(compactValue(null)).toBeNull();
  });

  it("sanitizeMarkdown strips raw HTML tags", () => {
    expect(sanitizeMarkdown("# ok <img src=x onerror=alert(1)> done")).toBe(
      "# ok  done",
    );
  });
});
