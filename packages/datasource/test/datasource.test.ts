import { describe, expect, it } from "vitest";
import { DuckDBDataSource } from "../src/duckdb";
import { ReadOnlySQLError } from "../src/guard";
import { buildStatsSQL, buildTopValuesSQL, shapeProfile } from "../src/profile";
import type { ColumnMeta, DatasetMeta } from "../src/types";

/**
 * Fake engine: overrides the internal exec() so we can test the DataSource
 * orchestration (guard, row cap, profiling) without booting duckdb-wasm.
 */
class FakeDuckDBDataSource extends DuckDBDataSource {
  executed: string[] = [];
  private responses: { columns: ColumnMeta[]; rows: unknown[][] }[] = [];

  seedDataset(meta: DatasetMeta): void {
    this.registerMeta(meta);
  }

  queueResponse(columns: ColumnMeta[], rows: unknown[][]): void {
    this.responses.push({ columns, rows });
  }

  protected override async exec(sql: string) {
    this.executed.push(sql);
    const next = this.responses.shift();
    if (!next) throw new Error(`No queued response for: ${sql}`);
    return next;
  }
}

const invoicesMeta: DatasetMeta = {
  name: "invoices",
  group: "saas_billing",
  rowCount: 3,
  columns: [
    { name: "id", type: "VARCHAR", nullable: false },
    { name: "amount", type: "DOUBLE", nullable: true },
  ],
};

const col = (name: string): ColumnMeta => ({ name, type: "DOUBLE", nullable: true });

describe("DuckDBDataSource.runQuery", () => {
  it("rejects non-SELECT SQL before touching the engine", async () => {
    const ds = new FakeDuckDBDataSource();
    await expect(ds.runQuery("DROP TABLE invoices")).rejects.toThrow(ReadOnlySQLError);
    expect(ds.executed).toHaveLength(0);
  });

  it("wraps queries with the row cap and reports truncation", async () => {
    const ds = new FakeDuckDBDataSource({ maxRows: 2 });
    // cap 2 -> engine asked for LIMIT 3; return 3 rows to trigger truncation
    ds.queueResponse([col("x")], [[1], [2], [3]]);
    const res = await ds.runQuery("SELECT x FROM t");
    expect(ds.executed[0]).toContain("LIMIT 3");
    expect(ds.executed[0]).toContain("SELECT x FROM t");
    expect(res.truncated).toBe(true);
    expect(res.rowCount).toBe(2);
    expect(res.rows).toEqual([[1], [2]]);
  });

  it("does not mark short results as truncated", async () => {
    const ds = new FakeDuckDBDataSource({ maxRows: 2 });
    ds.queueResponse([col("x")], [[1]]);
    const res = await ds.runQuery("SELECT x FROM t;");
    expect(res.truncated).toBe(false);
    expect(res.rowCount).toBe(1);
  });
});

describe("DuckDBDataSource.listDatasets / getSchema", () => {
  it("returns registered metadata and rejects unknown datasets", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.seedDataset(invoicesMeta);
    expect(await ds.listDatasets()).toEqual([invoicesMeta]);
    expect(await ds.getSchema("invoices")).toEqual(invoicesMeta.columns);
    await expect(ds.getSchema("nope")).rejects.toThrow(/Unknown dataset/);
  });
});

describe("DuckDBDataSource.profileColumn", () => {
  it("computes count/nulls/distinct/min/max/topValues", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.seedDataset(invoicesMeta);
    const statCols = ["total", "non_null", "distinct_count", "min_value", "max_value"].map(col);
    ds.queueResponse(statCols, [[100, 90, 5, 1.5, 99]]);
    ds.queueResponse([col("value"), col("n")], [[42, 60], [7, 30]]);

    const profile = await ds.profileColumn("invoices", "amount");
    expect(profile).toEqual({
      dataset: "invoices",
      column: "amount",
      type: "DOUBLE",
      count: 100,
      nulls: 10,
      distinct: 5,
      min: 1.5,
      max: 99,
      topValues: [
        { value: 42, count: 60 },
        { value: 7, count: 30 },
      ],
    });
  });

  it("rejects unknown columns", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.seedDataset(invoicesMeta);
    await expect(ds.profileColumn("invoices", "nope")).rejects.toThrow(/Unknown column/);
  });
});

describe("profile SQL builders", () => {
  it("quote identifiers in stats SQL", () => {
    const sql = buildStatsSQL("invoices", "amount");
    expect(sql).toContain('FROM "invoices"');
    expect(sql).toContain('count("amount")');
    expect(sql).toContain('count(DISTINCT "amount")');
  });

  it("quote identifiers in top-values SQL and cap the list", () => {
    const sql = buildTopValuesSQL("invoices", "we\"ird");
    expect(sql).toContain('"we""ird"');
    expect(sql).toContain("LIMIT 10");
  });

  it("shapeProfile handles empty stats", () => {
    const p = shapeProfile("d", "c", "VARCHAR", {}, []);
    expect(p.count).toBe(0);
    expect(p.nulls).toBe(0);
    expect(p.min).toBeNull();
    expect(p.topValues).toEqual([]);
  });
});
