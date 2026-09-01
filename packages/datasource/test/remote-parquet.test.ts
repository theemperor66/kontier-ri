import { describe, expect, it } from "vitest";
import { DuckDBDataSource } from "../src/duckdb";
import {
  NET_STATS_CHANNEL,
  buildNetStatsPreamble,
  subscribeNetStats,
} from "../src/net-stats";
import type { ColumnMeta } from "../src/types";

/** Fake engine (same pattern as datasource.test.ts): overrides exec(). */
class FakeDuckDBDataSource extends DuckDBDataSource {
  executed: string[] = [];
  private responses: { columns: ColumnMeta[]; rows: unknown[][] }[] = [];

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

const col = (name: string): ColumnMeta => ({ name, type: "DOUBLE", nullable: true });

const URLS = [
  "https://example.github.io/data/month=2024-01/part-0.parquet",
  "https://example.github.io/data/month=2024-02/part-0.parquet",
];

/** Queue the 4 engine calls registerRemoteParquet makes: SET cache, view, count, describe. */
function queueRegistration(ds: FakeDuckDBDataSource, rowCount: number): void {
  ds.queueResponse([], []); // SET enable_http_metadata_cache
  ds.queueResponse([], []); // CREATE VIEW
  ds.queueResponse([col("n")], [[rowCount]]); // count(*)
  ds.queueResponse(
    ["column_name", "column_type", "null"].map(col),
    [
      ["event_ts", "TIMESTAMP", "YES"],
      ["month", "VARCHAR", "YES"],
    ],
  ); // DESCRIBE
}

describe("DuckDBDataSource.registerRemoteParquet", () => {
  it("creates a hive-partitioned read_parquet view and caches the real row count", async () => {
    const ds = new FakeDuckDBDataSource();
    queueRegistration(ds, 100_000_000);

    const meta = await ds.registerRemoteParquet("scale_events", URLS);

    expect(ds.executed[0]).toContain("SET enable_http_metadata_cache=true");
    expect(ds.executed[1]).toContain('CREATE OR REPLACE VIEW "scale_events"');
    expect(ds.executed[1]).toContain(
      `read_parquet(['${URLS[0]}', '${URLS[1]}'], hive_partitioning=1)`,
    );
    expect(ds.executed[2]).toContain('count(*)::DOUBLE');
    expect(meta.rowCount).toBe(100_000_000);
    expect(meta.group).toBe("remote");
    expect(meta.columns.map((c) => c.name)).toEqual(["event_ts", "month"]);

    // listDatasets surfaces the cached metadata without re-querying.
    const before = ds.executed.length;
    expect(await ds.listDatasets()).toEqual([meta]);
    expect(ds.executed.length).toBe(before);
  });

  it("honors group/description/hivePartitioning options", async () => {
    const ds = new FakeDuckDBDataSource();
    queueRegistration(ds, 7);
    const meta = await ds.registerRemoteParquet("events", URLS.slice(0, 1), {
      group: "warehouse",
      description: "one file",
      hivePartitioning: false,
    });
    expect(ds.executed[1]).toContain("hive_partitioning=0");
    expect(meta.group).toBe("warehouse");
    expect(meta.description).toBe("one file");
  });

  it("rejects empty URL lists, non-http URLs and SQL-hostile URLs untouched by the engine", async () => {
    const ds = new FakeDuckDBDataSource();
    await expect(ds.registerRemoteParquet("x", [])).rejects.toThrow(/at least one URL/);
    await expect(
      ds.registerRemoteParquet("x", ["file:///etc/passwd"]),
    ).rejects.toThrow(/http\(s\) URL/);
    await expect(
      ds.registerRemoteParquet("x", ["https://a/b'); DROP TABLE t; --.parquet"]),
    ).rejects.toThrow(/http\(s\) URL/);
    await expect(ds.registerRemoteParquet("bad name!", URLS)).rejects.toThrow(
      /Invalid dataset name/,
    );
    expect(ds.executed).toHaveLength(0);
  });
});

describe("net-stats", () => {
  it("builds a syntactically valid worker preamble wired to the channel", () => {
    const src = buildNetStatsPreamble();
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain(JSON.stringify(NET_STATS_CHANNEL));
    // custom channel names are embedded safely
    expect(buildNetStatsPreamble('weird"chan')).toContain('"weird\\"chan"');
  });

  it("subscribeNetStats returns a working unsubscribe and filters malformed payloads", async () => {
    // Node >= 18 ships BroadcastChannel; the helper must also no-op cleanly
    // when it is absent (covered by the typeof guard).
    const seen: unknown[] = [];
    const stop = subscribeNetStats((m) => seen.push(m), "net-stats-test");
    const sender = new BroadcastChannel("net-stats-test");
    sender.postMessage({ url: "https://h/x.parquet", status: 206, bytes: 1234 });
    sender.postMessage({ nope: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual([{ url: "https://h/x.parquet", status: 206, bytes: 1234 }]);
    stop();
    sender.close();
  });
});
