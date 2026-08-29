import { describe, expect, it } from "vitest";

import {
  aggExpr,
  buildChartSQL,
  buildTileQuerySQL,
  measureAlias,
  plottableAggExpr,
} from "../src/tile-sql";
import type { ChartSpec, Tile } from "../src/types";

/**
 * DuckDB widens sum/avg on BIGINT/DECIMAL to HUGEINT/DECIMAL128, and count to
 * BIGINT — none of which survive as plain JS numbers through Arrow. Every
 * numeric aggregate the studio emits must be CAST to DOUBLE so chart/KPI
 * renderers can plot the values directly.
 */

describe("plottableAggExpr", () => {
  it("casts sum/avg/count/count_distinct to DOUBLE", () => {
    expect(plottableAggExpr("sum", "amount")).toBe('CAST(sum("amount") AS DOUBLE)');
    expect(plottableAggExpr("avg", "amount")).toBe('CAST(avg("amount") AS DOUBLE)');
    expect(plottableAggExpr("count", "*")).toBe("CAST(count(*) AS DOUBLE)");
    expect(plottableAggExpr("count_distinct", "customer_id")).toBe(
      'CAST(count(DISTINCT "customer_id") AS DOUBLE)',
    );
  });

  it("leaves min/max untouched (they keep the column type, e.g. DATE)", () => {
    expect(plottableAggExpr("min", "month")).toBe('min("month")');
    expect(plottableAggExpr("max", "amount")).toBe('max("amount")');
  });
});

describe("buildChartSQL", () => {
  const spec: ChartSpec = {
    dataset: "invoices",
    chartType: "bar",
    xKey: "month",
    query: {
      dims: ["month"],
      measures: [
        { agg: "sum", col: "amount_eur" },
        { agg: "max", col: "amount_eur" },
      ],
    },
  };

  it("CASTs widening aggregates to DOUBLE, keeps min/max raw", () => {
    const sql = buildChartSQL(spec);
    expect(sql).toContain('CAST(sum("amount_eur") AS DOUBLE) AS "sum_amount_eur"');
    expect(sql).toContain('max("amount_eur") AS "max_amount_eur"');
    expect(sql).not.toContain("CAST(max(");
  });

  it("keeps stable measure aliases and structure", () => {
    const sql = buildChartSQL(spec);
    expect(sql).toBe(
      'SELECT "month", CAST(sum("amount_eur") AS DOUBLE) AS "sum_amount_eur", ' +
        'max("amount_eur") AS "max_amount_eur" FROM "invoices" ' +
        'GROUP BY "month" ORDER BY "month" LIMIT 1000',
    );
    expect(measureAlias({ agg: "sum", col: "amount_eur" })).toBe("sum_amount_eur");
  });

  it("passes raw SQL queries through untouched", () => {
    const raw: ChartSpec = {
      dataset: "invoices",
      chartType: "line",
      xKey: "month",
      query: { sql: "SELECT month, sum(x) AS s FROM invoices GROUP BY 1" },
    };
    expect(buildChartSQL(raw)).toBe("SELECT month, sum(x) AS s FROM invoices GROUP BY 1");
  });
});

describe("buildTileQuerySQL (kpi)", () => {
  it("CASTs measure/agg KPI queries to DOUBLE", () => {
    const tile: Tile = {
      id: "t1",
      type: "kpi",
      title: "Count",
      layout: { x: 0, y: 0, w: 3, h: 2 },
      spec: { dataset: "charges", measure: "*", agg: "count", format: "number" },
      annotations: [],
    };
    expect(buildTileQuerySQL(tile)).toBe(
      'SELECT CAST(count(*) AS DOUBLE) AS value FROM "charges"',
    );
  });
});

describe("aggExpr", () => {
  it("stays raw (callers that need plottable output use plottableAggExpr)", () => {
    expect(aggExpr("sum", "amount")).toBe('sum("amount")');
  });
});
