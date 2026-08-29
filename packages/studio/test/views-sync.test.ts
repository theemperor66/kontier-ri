import { describe, expect, it } from "vitest";
import type { DataSource, DatasetMeta } from "@kontier-ri/datasource";
import { syncViewsToDataSource } from "../src/views-sync";

function fakeDS(failOn?: string): DataSource & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    listDatasets: () => Promise.resolve([]),
    getSchema: () => Promise.resolve([]),
    runQuery: () => Promise.reject(new Error("unused")),
    profileColumn: () => Promise.reject(new Error("unused")),
    createView(name: string): Promise<DatasetMeta> {
      if (name === failOn) return Promise.reject(new Error("boom"));
      created.push(name);
      return Promise.resolve({ name, rowCount: 0, columns: [] });
    },
    dropView: () => Promise.resolve(),
  };
}

describe("syncViewsToDataSource", () => {
  const views = [
    { name: "view_a", sql: "SELECT 1" },
    { name: "view_b", sql: "SELECT 2" },
  ];

  it("creates every doc view in the engine", async () => {
    const ds = fakeDS();
    const res = await syncViewsToDataSource(ds, views);
    expect(res.created).toEqual(["view_a", "view_b"]);
    expect(res.failed).toEqual([]);
  });

  it("collects per-view failures without throwing", async () => {
    const ds = fakeDS("view_a");
    const res = await syncViewsToDataSource(ds, views);
    expect(res.created).toEqual(["view_b"]);
    expect(res.failed).toEqual([{ name: "view_a", error: "boom" }]);
  });

  it("no-ops on datasources without view support", async () => {
    const ds = fakeDS();
    const bare = { ...ds, createView: undefined };
    const res = await syncViewsToDataSource(bare as DataSource, views);
    expect(res.created).toEqual([]);
  });
});
