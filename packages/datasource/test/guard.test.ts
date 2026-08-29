import { describe, expect, it } from "vitest";
import {
  applyRowCap,
  assertReadOnly,
  quoteIdent,
  ReadOnlySQLError,
  stripLiteralsAndComments,
} from "../src/guard";

describe("assertReadOnly", () => {
  it("accepts plain SELECT", () => {
    expect(assertReadOnly("SELECT 1")).toBe("SELECT 1");
  });

  it("accepts WITH ... SELECT", () => {
    const sql = "WITH x AS (SELECT 1 AS a) SELECT * FROM x";
    expect(assertReadOnly(sql)).toBe(sql);
  });

  it("accepts DESCRIBE / SUMMARIZE / SHOW / FROM-first", () => {
    expect(() => assertReadOnly("DESCRIBE invoices")).not.toThrow();
    expect(() => assertReadOnly("SUMMARIZE invoices")).not.toThrow();
    expect(() => assertReadOnly("SHOW TABLES")).not.toThrow();
    expect(() => assertReadOnly("FROM invoices SELECT 1")).not.toThrow();
  });

  it("strips a trailing semicolon", () => {
    expect(assertReadOnly("SELECT 1;")).toBe("SELECT 1");
    expect(assertReadOnly("SELECT 1; \n")).toBe("SELECT 1");
  });

  it("is case-insensitive and tolerant of leading whitespace/comments", () => {
    expect(() => assertReadOnly("  \n-- hi\nselect 1")).not.toThrow();
    expect(() => assertReadOnly("/* c */ SELECT 1")).not.toThrow();
  });

  it("rejects empty input", () => {
    expect(() => assertReadOnly("")).toThrow(ReadOnlySQLError);
    expect(() => assertReadOnly("   ")).toThrow(ReadOnlySQLError);
    expect(() => assertReadOnly("-- only a comment")).toThrow(ReadOnlySQLError);
  });

  it("rejects DML/DDL statements", () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "DROP TABLE t",
      "CREATE TABLE t (a INT)",
      "ALTER TABLE t ADD COLUMN b INT",
      "COPY t TO 'out.csv'",
      "ATTACH 'other.db'",
      "PRAGMA database_list",
      "SET memory_limit = '1GB'",
      "INSTALL httpfs",
      "LOAD httpfs",
      "CALL pragma_table_info('t')",
      "BEGIN TRANSACTION",
      "VACUUM",
      "TRUNCATE t",
    ]) {
      expect(() => assertReadOnly(sql), sql).toThrow(ReadOnlySQLError);
    }
  });

  it("rejects multi-statement input, including SELECT-led smuggling", () => {
    expect(() => assertReadOnly("SELECT 1; DROP TABLE t")).toThrow(ReadOnlySQLError);
    expect(() => assertReadOnly("SELECT 1; SELECT 2")).toThrow(ReadOnlySQLError);
  });

  it("rejects forbidden keywords hidden mid-query", () => {
    expect(() =>
      assertReadOnly("SELECT * FROM t WHERE a IN (DELETE FROM t RETURNING a)"),
    ).toThrow(ReadOnlySQLError);
  });

  it("does NOT false-positive on forbidden words inside string literals", () => {
    expect(() =>
      assertReadOnly("SELECT * FROM t WHERE note = 'please DROP TABLE x'"),
    ).not.toThrow();
    expect(() =>
      assertReadOnly("SELECT 'insert; update; delete' AS phrase"),
    ).not.toThrow();
  });

  it("does NOT false-positive on quoted identifiers", () => {
    expect(() => assertReadOnly('SELECT "delete", "copy" FROM t')).not.toThrow();
  });

  it("does NOT false-positive on words containing forbidden substrings", () => {
    expect(() =>
      assertReadOnly("SELECT created_at, updated_by FROM t"),
    ).not.toThrow();
  });

  it("rejects semicolons hidden after comments", () => {
    expect(() => assertReadOnly("SELECT 1 -- x\n; DROP TABLE t")).toThrow(
      ReadOnlySQLError,
    );
  });
});

describe("stripLiteralsAndComments", () => {
  it("removes line and block comments", () => {
    expect(stripLiteralsAndComments("SELECT 1 -- drop table t")).toBe("SELECT 1 ");
    expect(stripLiteralsAndComments("SELECT /* drop */ 1")).toBe("SELECT  1");
  });

  it("replaces string literals, honoring '' escapes", () => {
    expect(stripLiteralsAndComments("SELECT 'a''b; drop'")).toBe("SELECT '?'");
  });
});

describe("applyRowCap", () => {
  it("wraps the query with LIMIT cap+1", () => {
    const wrapped = applyRowCap("SELECT * FROM t", 100);
    expect(wrapped).toContain("SELECT * FROM t");
    expect(wrapped).toMatch(/LIMIT 101\s*$/);
  });
});

describe("quoteIdent", () => {
  it("quotes and escapes identifiers", () => {
    expect(quoteIdent("plain")).toBe('"plain"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});
