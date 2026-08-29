import { describe, expect, it } from "vitest";
import {
  DuckDBDataSource,
  dedupeDatasetName,
  sanitizeDatasetName,
} from "../src/duckdb";
import { ReadOnlySQLError, assertSelectOnly } from "../src/guard";
import type { ColumnMeta, DatasetMeta } from "../src/types";

/** Fake engine: overrides exec/registerFile so no duckdb-wasm boots. */
class FakeDuckDBDataSource extends DuckDBDataSource {
  executed: string[] = [];
  registeredFiles: string[] = [];
  private responses: { columns: ColumnMeta[]; rows: unknown[][] }[] = [];

  seedDataset(meta: DatasetMeta): void {
    this.registerMeta(meta);
  }

  queueResponse(columns: ColumnMeta[], rows: unknown[][]): void {
    this.responses.push({ columns, rows });
  }

  /** Queue the standard CREATE/DROP + count + DESCRIBE response triple. */
  queueViewResponses(): void {
    this.queueResponse([], []); // CREATE VIEW
    this.queueResponse([{ name: "n", type: "DOUBLE", nullable: true }], [[7]]);
    this.queueResponse(
      ["column_name", "column_type", "null"].map((name) => ({
        name,
        type: "VARCHAR",
        nullable: true,
      })),
      [["month", "VARCHAR", "YES"]],
    );
  }

  protected override async exec(sql: string) {
    this.executed.push(sql);
    const next = this.responses.shift();
    if (!next) throw new Error(`No queued response for: ${sql}`);
    return next;
  }

  protected override async registerFile(fileName: string): Promise<void> {
    this.registeredFiles.push(fileName);
  }
}

describe("assertSelectOnly (view body guard)", () => {
  it("accepts SELECT / WITH / FROM bodies", () => {
    expect(assertSelectOnly("SELECT 1")).toBe("SELECT 1");
    expect(assertSelectOnly("WITH x AS (SELECT 1) SELECT * FROM x")).toContain(
      "WITH",
    );
    expect(assertSelectOnly("FROM invoices")).toBe("FROM invoices");
  });

  it("rejects DDL/DML and non-query read statements", () => {
    expect(() => assertSelectOnly("DROP TABLE t")).toThrow(ReadOnlySQLError);
    expect(() => assertSelectOnly("INSERT INTO t VALUES (1)")).toThrow(
      ReadOnlySQLError,
    );
    expect(() => assertSelectOnly("DESCRIBE invoices")).toThrow(
      ReadOnlySQLError,
    );
    expect(() => assertSelectOnly("SHOW TABLES")).toThrow(ReadOnlySQLError);
    expect(() => assertSelectOnly("SELECT 1; DROP TABLE t")).toThrow(
      ReadOnlySQLError,
    );
  });
});

describe("DuckDBDataSource.createView / dropView", () => {
  it("creates a namespaced view, registers it, lists it", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.queueViewResponses();
    const meta = await ds.createView(
      "view_mrr",
      "SELECT month, sum(amount) AS mrr FROM invoices GROUP BY 1",
    );
    expect(ds.executed[0]).toBe(
      'CREATE OR REPLACE VIEW "view_mrr" AS SELECT month, sum(amount) AS mrr FROM invoices GROUP BY 1',
    );
    expect(meta).toMatchObject({ name: "view_mrr", group: "views", rowCount: 7 });
    expect(meta.description).toContain("SELECT month");
    const listed = await ds.listDatasets();
    expect(listed.map((d) => d.name)).toContain("view_mrr");
  });

  it("rejects un-namespaced names and non-SELECT bodies", async () => {
    const ds = new FakeDuckDBDataSource();
    await expect(ds.createView("mrr", "SELECT 1")).rejects.toThrow(/view_/);
    await expect(
      ds.createView("view_evil", "DROP TABLE invoices"),
    ).rejects.toThrow(ReadOnlySQLError);
    await expect(
      ds.createView('view_x"; DROP TABLE t', "SELECT 1"),
    ).rejects.toThrow(/Invalid dataset name/);
    expect(ds.executed).toHaveLength(0);
  });

  it("refuses to shadow or drop non-view datasets", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.seedDataset({
      name: "view_taken",
      group: "saas_billing",
      rowCount: 1,
      columns: [],
    });
    await expect(ds.createView("view_taken", "SELECT 1")).rejects.toThrow(
      /non-view dataset/,
    );
    await expect(ds.dropView("invoices")).rejects.toThrow(/view_/);
    await expect(ds.dropView("view_taken")).rejects.toThrow(/not a view/);
  });

  it("dropView unregisters and issues DROP VIEW IF EXISTS", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.queueViewResponses();
    await ds.createView("view_tmp", "SELECT 1");
    ds.queueResponse([], []);
    await ds.dropView("view_tmp");
    expect(ds.executed.at(-1)).toBe('DROP VIEW IF EXISTS "view_tmp"');
    expect((await ds.listDatasets()).map((d) => d.name)).not.toContain(
      "view_tmp",
    );
  });
});

describe("dataset name sanitization (importFile)", () => {
  it("sanitizeDatasetName handles spaces, parens, dashes, unicode, digits", () => {
    expect(sanitizeDatasetName("My Data (2024) final")).toBe(
      "My_Data_2024_final",
    );
    expect(sanitizeDatasetName("café-orders")).toBe("cafe_orders");
    expect(sanitizeDatasetName("2024-q1")).toBe("_2024_q1");
    expect(sanitizeDatasetName("---")).toBe("dataset");
    expect(sanitizeDatasetName("__x__")).toBe("x");
  });

  it("dedupeDatasetName appends _2, _3 on collisions", () => {
    const taken = new Set(["orders", "orders_2"]);
    expect(dedupeDatasetName("orders", (n) => taken.has(n))).toBe("orders_3");
    expect(dedupeDatasetName("fresh", (n) => taken.has(n))).toBe("fresh");
  });

  it("importFile sanitizes the name, dedupes, and keeps the label", async () => {
    const ds = new FakeDuckDBDataSource();
    ds.seedDataset({
      name: "My_Report",
      group: "uploads",
      rowCount: 1,
      columns: [],
    });
    // CREATE VIEW + count + DESCRIBE for the import.
    ds.queueResponse([], []);
    ds.queueResponse([{ name: "n", type: "DOUBLE", nullable: true }], [[3]]);
    ds.queueResponse(
      ["column_name", "column_type", "null"].map((name) => ({
        name,
        type: "VARCHAR",
        nullable: true,
      })),
      [["id", "BIGINT", "NO"]],
    );
    const file = new File(["id\n1\n"], "My Report.csv", { type: "text/csv" });
    const meta = await ds.importFile(file);
    expect(meta.name).toBe("My_Report_2");
    expect(meta.description).toBe("My Report.csv");
    expect(meta.group).toBe("uploads");
    expect(ds.registeredFiles[0]).toBe("My_Report_2.csv");
  });
});
