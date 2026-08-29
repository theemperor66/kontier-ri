import { describe, expect, it } from "vitest";
import {
  buildChartSQL,
  buildTileQuery,
  buildTileQuerySQL,
  type TileQueryContext,
} from "../src/tile-sql";
import type { CalculatedField, ChartSpec, Tile } from "../src/types";

function chartTile(spec: Partial<ChartSpec>, tile: Partial<Tile> = {}): Tile {
  return {
    id: "t1",
    type: "chart",
    title: "Chart",
    layout: { x: 0, y: 0, w: 6, h: 4 },
    annotations: [],
    spec: {
      dataset: "invoices",
      chartType: "bar",
      xKey: "plan",
      query: {
        dims: ["plan"],
        measures: [{ col: "amount", agg: "sum" }],
      },
      ...spec,
    } as ChartSpec,
    ...tile,
  };
}

const invoicesSchema = {
  name: "invoices",
  columns: [
    { name: "plan", type: "VARCHAR" },
    { name: "amount", type: "DOUBLE" },
    { name: "customer_id", type: "VARCHAR" },
    { name: "month", type: "VARCHAR" },
  ],
};

const arpu: CalculatedField = {
  name: "arpu",
  dataset: "invoices",
  expression: "sum(amount) / count(DISTINCT customer_id)",
  kind: "aggregate",
};

const netAmount: CalculatedField = {
  name: "net_amount",
  dataset: "invoices",
  expression: "amount - tax",
  kind: "row",
};

describe("calculated-field expansion", () => {
  it("expands aggregate fields verbatim as measures, aliased by name", () => {
    const tile = chartTile({
      query: { dims: ["plan"], measures: [{ col: "arpu", agg: "sum" }] },
    });
    const sql = buildTileQuerySQL(tile, { calculatedFields: [arpu] })!;
    expect(sql).toContain(
      'CAST((sum(amount) / count(DISTINCT customer_id)) AS DOUBLE) AS "arpu"',
    );
    expect(sql).not.toContain('sum("arpu")');
  });

  it("wraps row fields with the measure agg", () => {
    const tile = chartTile({
      query: { dims: ["plan"], measures: [{ col: "net_amount", agg: "avg" }] },
    });
    const sql = buildTileQuerySQL(tile, { calculatedFields: [netAmount] })!;
    expect(sql).toContain(
      'CAST(avg((amount - tax)) AS DOUBLE) AS "avg_net_amount"',
    );
  });

  it("expands row fields used as dims (aliased by field name)", () => {
    const tile = chartTile({
      query: { dims: ["net_amount"], measures: [{ col: "*", agg: "count" }] },
      xKey: "net_amount",
    });
    const sql = buildTileQuerySQL(tile, { calculatedFields: [netAmount] })!;
    expect(sql).toContain('(amount - tax) AS "net_amount"');
    expect(sql).toContain("GROUP BY (amount - tax)");
  });

  it("only expands fields of the tile's dataset", () => {
    const foreign: CalculatedField = { ...arpu, dataset: "charges" };
    const tile = chartTile({
      query: { dims: ["plan"], measures: [{ col: "arpu", agg: "sum" }] },
    });
    const sql = buildTileQuerySQL(tile, { calculatedFields: [foreign] })!;
    expect(sql).toContain('sum("arpu")'); // treated as a plain column
  });

  it("expands calculated fields in KPI tiles (agg optional)", () => {
    const tile: Tile = {
      id: "k1",
      type: "kpi",
      title: "ARPU",
      layout: { x: 0, y: 0, w: 3, h: 2 },
      annotations: [],
      spec: { dataset: "invoices", measure: "arpu", format: "currency" },
    };
    // Without the field the spec is incomplete -> null (v1 behavior).
    expect(buildTileQuerySQL(tile)).toBeNull();
    const sql = buildTileQuerySQL(tile, { calculatedFields: [arpu] })!;
    expect(sql).toBe(
      'SELECT CAST((sum(amount) / count(DISTINCT customer_id)) AS DOUBLE) AS value FROM "invoices"',
    );
  });
});

describe("othersBucket top-N SQL", () => {
  const tile = chartTile({
    query: {
      dims: ["plan"],
      measures: [{ col: "amount", agg: "sum" }],
      limit: 5,
      othersBucket: true,
    },
  });

  it("ranks by the first measure and collapses the tail into 'Other'", () => {
    const sql = buildTileQuerySQL(tile)!;
    expect(sql).toContain("WITH __ranks AS (");
    expect(sql).toContain("row_number() OVER (ORDER BY CAST(sum(\"amount\") AS DOUBLE) DESC)");
    expect(sql).toContain("WHEN __ranks.__rn <= 5");
    expect(sql).toContain("ELSE 'Other'");
    expect(sql).toContain('AS "plan"');
    expect(sql).toContain("ORDER BY min(__ranks.__rn)");
    // Aggregates run over base rows (correct avg/median), not re-aggregated.
    expect(sql).toContain('CAST(sum("amount") AS DOUBLE) AS "sum_amount"');
  });

  it("pushes WHERE clauses into both the ranking CTE and the outer query", () => {
    const sql = buildTileQuerySQL(tile, {
      datasets: [invoicesSchema],
      globalFilters: [{ column: "plan", op: "eq", value: "pro" }],
    })!;
    const matches = sql.match(/WHERE "plan" = 'pro'/g);
    expect(matches).toHaveLength(2);
  });

  it("plain limit without othersBucket keeps the v1 shape", () => {
    const plain = chartTile({
      query: { dims: ["plan"], measures: [{ col: "amount", agg: "sum" }], limit: 5 },
    });
    expect(buildTileQuerySQL(plain)).toContain("LIMIT 5");
    expect(buildTileQuerySQL(plain)).not.toContain("__ranks");
  });
});

describe("filters + cross-filter in buildTileQuery", () => {
  it("applies schema-verified global filters and date range", () => {
    const tile = chartTile({});
    const sql = buildTileQuerySQL(tile, {
      datasets: [invoicesSchema],
      globalFilters: [
        { column: "plan", op: "in", value: ["pro", "scale"] },
        { column: "not_a_column", op: "eq", value: 1 },
      ],
      dateRange: { from: "2025-01-01", to: "2025-06-30" },
    })!;
    expect(sql).toContain(`"plan" IN ('pro', 'scale')`);
    expect(sql).not.toContain("not_a_column");
    expect(sql).toContain("BETWEEN '2025-01' AND '2025-06'"); // month string col
  });

  it("applies tile-level spec.filters and provides a fallback", () => {
    const tile = chartTile({
      filters: [{ column: "plan", op: "contains", value: "pro" }],
    });
    const q = buildTileQuery(tile)!;
    expect(q.sql).toContain("ILIKE '%pro%'");
    expect(q.fallbackSQL).toBeDefined();
    expect(q.fallbackSQL).not.toContain("ILIKE");
  });

  it("applies the cross-filter unless the tile is source or opted out", () => {
    const cf = { column: "plan", value: "pro", sourceTileId: "src" };
    const ctx: TileQueryContext = { crossFilter: cf };
    expect(buildTileQuerySQL(chartTile({}), ctx)).toContain(`"plan" = 'pro'`);
    expect(
      buildTileQuerySQL(chartTile({}, { id: "src" }), ctx),
    ).not.toContain(`"plan" = 'pro'`);
    expect(
      buildTileQuerySQL(chartTile({}, { ignoreCrossFilter: true }), ctx),
    ).not.toContain(`"plan" = 'pro'`);
  });

  it("skips the cross-filter when the schema lacks the column", () => {
    const sql = buildTileQuerySQL(chartTile({}), {
      datasets: [invoicesSchema],
      crossFilter: { column: "region", value: "EU" },
    })!;
    expect(sql).not.toContain("region");
  });

  it("wraps raw-SQL tiles and keeps the unfiltered fallback", () => {
    const tile = chartTile({
      query: { sql: "SELECT plan, sum(amount) AS total FROM invoices GROUP BY 1" },
    });
    const q = buildTileQuery(tile, {
      crossFilter: { column: "plan", value: "pro" },
    })!;
    expect(q.sql).toContain("SELECT * FROM (SELECT plan");
    expect(q.sql).toContain(`"plan" = 'pro'`);
    expect(q.fallbackSQL).toBe(
      "SELECT plan, sum(amount) AS total FROM invoices GROUP BY 1",
    );
  });

  it("filters table tiles by wrapping their SQL", () => {
    const tile: Tile = {
      id: "tbl",
      type: "table",
      title: "T",
      layout: { x: 0, y: 0, w: 6, h: 4 },
      annotations: [],
      spec: {
        dataset: "invoices",
        sql: "SELECT * FROM invoices",
        filters: [{ column: "plan", op: "eq", value: "pro" }],
      },
    };
    const q = buildTileQuery(tile)!;
    expect(q.sql).toBe(
      `SELECT * FROM (SELECT * FROM invoices) __tile WHERE "plan" = 'pro'`,
    );
    expect(q.fallbackSQL).toBe("SELECT * FROM invoices");
  });

  it("ctx-less calls stay byte-identical to v1", () => {
    const spec: ChartSpec = {
      dataset: "invoices",
      chartType: "bar",
      xKey: "month",
      query: {
        dims: ["month"],
        measures: [{ agg: "sum", col: "amount_eur" }],
      },
    };
    expect(buildChartSQL(spec)).toBe(
      'SELECT "month", CAST(sum("amount_eur") AS DOUBLE) AS "sum_amount_eur" ' +
        'FROM "invoices" GROUP BY "month" ORDER BY "month" LIMIT 1000',
    );
  });
});
