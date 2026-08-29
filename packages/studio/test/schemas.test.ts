import { describe, expect, it } from "vitest";
import * as z from "zod";
import * as schemas from "../src/schemas";
import { buildSelectedTileTools, buildStaticTools } from "../src/webmcp/tools";
import type { DataSource } from "@kontier-ri/datasource";

/** name -> [schema, minimal valid input] for every tool input schema. */
const cases: Record<string, [z.ZodType, Record<string, unknown>]> = {
  list_datasets: [schemas.listDatasetsInput, {}],
  get_dataset_schema: [schemas.getDatasetSchemaInput, { dataset: "invoices" }],
  profile_column: [
    schemas.profileColumnInput,
    { dataset: "invoices", column: "amount" },
  ],
  sample_rows: [schemas.sampleRowsInput, { dataset: "invoices" }],
  run_sql: [schemas.runSqlInput, { sql: "SELECT 1" }],
  add_tile: [
    schemas.addTileInput,
    {
      type: "markdown",
      title: "Notes",
      spec: { content: "hello" },
    },
  ],
  update_tile: [
    schemas.updateTileInput,
    { tileId: "t1", patch: { title: "x" } },
  ],
  move_tile: [schemas.moveTileInput, { tileId: "t1", x: 0, y: 0, w: 6, h: 4 }],
  remove_tile: [schemas.removeTileInput, { tileId: "t1" }],
  set_global_filter: [
    schemas.setGlobalFilterInput,
    { column: "plan", op: "eq", value: "pro" },
  ],
  clear_global_filters: [schemas.clearGlobalFiltersInput, {}],
  set_date_range: [
    schemas.setDateRangeInput,
    { from: "2025-01-01", to: "2025-06-30" },
  ],
  set_theme: [schemas.setThemeInput, { mode: "dark" }],
  set_dashboard_title: [schemas.setDashboardTitleInput, { title: "Revenue" }],
  add_annotation: [
    schemas.addAnnotationInput,
    { tileId: "t1", text: "spike here" },
  ],
  get_dashboard_state: [schemas.getDashboardStateInput, {}],
  get_user_focus: [schemas.getUserFocusInput, {}],
  describe_tile: [schemas.describeTileInput, { tileId: "t1" }],
  get_activity_log: [schemas.getActivityLogInput, {}],
  edit_selected_tile: [
    schemas.editSelectedTileInput,
    { patch: { title: "x" } },
  ],
  restyle_selected_tile: [
    schemas.restyleSelectedTileInput,
    { chartType: "bar" },
  ],
  explain_selected_tile: [schemas.explainSelectedTileInput, {}],
};

describe("tool input schemas are strict", () => {
  for (const [name, [schema, valid]] of Object.entries(cases)) {
    it(`${name}: accepts the valid example and rejects unknown keys`, () => {
      expect(schema.safeParse(valid).success).toBe(true);
      const poisoned = { ...valid, __unknown_key__: 1 };
      expect(schema.safeParse(poisoned).success).toBe(false);
    });
  }

  it("nested tile specs reject unknown keys too", () => {
    expect(
      schemas.kpiSpecSchema.safeParse({
        dataset: "d",
        measure: "m",
        agg: "sum",
        format: "currency",
        bogus: true,
      }).success,
    ).toBe(false);
    expect(
      schemas.chartSpecSchema.safeParse({
        dataset: "d",
        query: { sql: "SELECT 1", sneaky: 1 },
        chartType: "line",
        xKey: "x",
      }).success,
    ).toBe(false);
    expect(
      schemas.addTileInput.safeParse({
        type: "markdown",
        title: "t",
        spec: { content: "hi", extra: "no" },
      }).success,
    ).toBe(false);
  });

  it("enforces documented caps and formats", () => {
    expect(schemas.runSqlInput.safeParse({ sql: "SELECT 1", limit: 501 }).success).toBe(false);
    expect(schemas.runSqlInput.parse({ sql: "SELECT 1" }).limit).toBe(100);
    expect(
      schemas.sampleRowsInput.safeParse({ dataset: "d", limit: 21 }).success,
    ).toBe(false);
    expect(schemas.sampleRowsInput.parse({ dataset: "d" }).limit).toBe(10);
    expect(
      schemas.tableSpecSchema.safeParse({ dataset: "d", sql: "SELECT 1", pageSize: 26 }).success,
    ).toBe(false);
    expect(
      schemas.setDateRangeInput.safeParse({ from: "01/02/2025", to: "2025-06-30" }).success,
    ).toBe(false);
    expect(
      schemas.moveTileInput.safeParse({ tileId: "t", x: 12, y: 0, w: 1, h: 1 }).success,
    ).toBe(false);
  });
});

describe("JSON Schema generation", () => {
  const ctx = { dataSource: {} as unknown as DataSource };
  const defs = [
    ...buildStaticTools(ctx),
    ...buildSelectedTileTools(ctx),
  ];

  it("every tool schema converts via z.toJSONSchema to a strict object", () => {
    expect(defs).toHaveLength(22);
    for (const def of defs) {
      const js = z.toJSONSchema(def.inputSchema) as Record<string, unknown>;
      expect(js["type"], def.name).toBe("object");
      expect(js["additionalProperties"], def.name).toBe(false);
    }
  });
});
