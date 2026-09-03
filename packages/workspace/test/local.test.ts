/**
 * `LocalWorkspaceStore`: the shared contract plus the failure modes only a
 * browser has — blocked storage, a quota error mid-save, and JSON another
 * build (or an extension) corrupted.
 */

import { describe, expect, it } from "vitest";
import { describeWorkspaceStoreContract, makeCommand, makeDashboard, makeDoc, makeInvestigation, makeVersion } from "../src/conformance";
import { MAX_DASHBOARDS } from "../src/limits";
import { LocalWorkspaceStore, WORKSPACE_KEY_PREFIX, workspaceKey } from "../src/local";
import type { KeyValueStorage } from "../src/local";

/** Minimal localStorage stand-in; `failOn` makes writes throw like a quota error. */
class FakeStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  failOn: RegExp | null = null;
  writes = 0;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    if (this.failOn?.test(key)) {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** A storage that is hostile in every direction (Safari private mode). */
class HostileStorage implements KeyValueStorage {
  getItem(): string | null {
    throw new Error("SecurityError: storage is disabled");
  }
  setItem(): void {
    throw new Error("SecurityError: storage is disabled");
  }
  removeItem(): void {
    throw new Error("SecurityError: storage is disabled");
  }
}

describeWorkspaceStoreContract(
  "LocalWorkspaceStore",
  () => new LocalWorkspaceStore({ storage: new FakeStorage(), now: () => 1_700_000_000_000 }),
);

describe("LocalWorkspaceStore keys and identity", () => {
  it("namespaces every key it writes", async () => {
    const storage = new FakeStorage();
    const store = new LocalWorkspaceStore({ storage });
    await store.saveDashboard(makeDashboard());
    await store.saveVersion(makeVersion());
    await store.saveInvestigation(makeInvestigation());
    await store.appendCommands("dash_1", [makeCommand()]);
    await store.heartbeat("actor_a", "Zaid", "dash_1");
    const keys = [...storage.map.keys()];
    expect(keys.length).toBeGreaterThan(4);
    for (const key of keys) expect(key.startsWith(WORKSPACE_KEY_PREFIX)).toBe(true);
    expect(keys).toContain(workspaceKey("dashboards"));
    expect(keys).toContain(workspaceKey("dashboard:dash_1"));
    expect(keys).toContain(workspaceKey("versions:dash_1"));
    expect(keys).toContain(workspaceKey("commands:dash_1"));
    expect(keys).toContain(workspaceKey("investigations"));
  });

  it('reports kind "local" and reuses a persisted workspace id', async () => {
    const storage = new FakeStorage();
    const first = await new LocalWorkspaceStore({ storage }).identity();
    const second = await new LocalWorkspaceStore({ storage }).identity();
    expect(first.kind).toBe("local");
    expect(second.workspaceId).toBe(first.workspaceId);
  });

  it("honours an explicit workspace id and label", async () => {
    const store = new LocalWorkspaceStore({ storage: new FakeStorage(), workspaceId: "ws_x", label: "Laptop" });
    expect(await store.identity()).toEqual({ workspaceId: "ws_x", label: "Laptop", kind: "local" });
  });

  it("heartbeat reports only the caller, because a local workspace has one peer", async () => {
    const store = new LocalWorkspaceStore({ storage: new FakeStorage(), now: () => 42 });
    await store.heartbeat("actor_b", "Someone else", "dash_2");
    const peers = await store.heartbeat("actor_a", "Zaid", "dash_1");
    expect(peers).toEqual([{ actor: "actor_a", label: "Zaid", lastSeen: 42, dashboardId: "dash_1" }]);
  });
});

describe("LocalWorkspaceStore survives hostile storage", () => {
  it("never throws when every storage call throws", async () => {
    const store = new LocalWorkspaceStore({ storage: new HostileStorage() });
    await expect(store.saveDashboard(makeDashboard())).resolves.toMatchObject({ id: "dash_1" });
    await expect(store.listDashboards()).resolves.toEqual([]);
    await expect(store.loadDashboard("dash_1")).resolves.toBeNull();
    await expect(store.listVersions("dash_1")).resolves.toEqual([]);
    await expect(store.listInvestigations()).resolves.toEqual([]);
    await expect(store.deleteDashboard("dash_1")).resolves.toBeUndefined();
    // Nothing is durable, so the reported cursor stays at 0 rather than
    // claiming a seq the store cannot replay.
    await expect(store.appendCommands("dash_1", [makeCommand()])).resolves.toEqual({ cursor: 0 });
    await expect(store.identity()).resolves.toMatchObject({ kind: "local" });
  });

  it("returns a summary even when the quota rejects the document write", async () => {
    const storage = new FakeStorage();
    storage.failOn = /dashboard:/;
    const store = new LocalWorkspaceStore({ storage });
    const summary = await store.saveDashboard(makeDashboard({ doc: makeDoc(2, 2) }));
    expect(summary.tileCount).toBe(4);
    // The index still lists it, so the human sees the dashboard is not saved
    // rather than watching it vanish mid-session.
    expect(await store.listDashboards()).toHaveLength(1);
    expect(await store.loadDashboard("dash_1")).toBeNull();
  });

  it("keeps working after a quota error on the command log", async () => {
    const storage = new FakeStorage();
    const store = new LocalWorkspaceStore({ storage });
    await store.appendCommands("dash_1", [makeCommand()]);
    storage.failOn = /commands:/;
    // The rejected write means the second entry was never persisted, so the
    // reported cursor does not advance and seq 2 is still free.
    await expect(store.appendCommands("dash_1", [makeCommand()])).resolves.toEqual({ cursor: 1 });
    expect((await store.fetchCommands("dash_1", 0)).cursor).toBe(1);
    storage.failOn = null;
    await expect(store.appendCommands("dash_1", [makeCommand()])).resolves.toEqual({ cursor: 2 });
  });

  it("falls back to memory when localStorage is missing entirely", async () => {
    const store = new LocalWorkspaceStore({ storage: null });
    await store.saveDashboard(makeDashboard());
    expect((await store.listDashboards()).map((entry) => entry.id)).toEqual(["dash_1"]);
  });
});

describe("LocalWorkspaceStore tolerates corrupt JSON", () => {
  const corrupt = async (area: string, raw: string) => {
    const storage = new FakeStorage();
    storage.map.set(workspaceKey(area), raw);
    return { storage, store: new LocalWorkspaceStore({ storage }) };
  };

  it("treats an unparsable dashboard index as empty and repairs it on save", async () => {
    const { store } = await corrupt("dashboards", "{not json");
    expect(await store.listDashboards()).toEqual([]);
    await store.saveDashboard(makeDashboard());
    expect(await store.listDashboards()).toHaveLength(1);
  });

  it("ignores an index that is not an array", async () => {
    const { store } = await corrupt("dashboards", '{"entries":[]}');
    expect(await store.listDashboards()).toEqual([]);
  });

  it("drops index rows that are not objects", async () => {
    const { store } = await corrupt("dashboards", '[null, 7, {"id":"dash_1","name":"a","updatedAt":1,"tileCount":0,"pageCount":0}]');
    expect((await store.listDashboards()).map((entry) => entry.id)).toEqual(["dash_1"]);
  });

  it("returns null for a corrupt document and for one saved under another id", async () => {
    const { storage, store } = await corrupt("dashboard:dash_1", "<html>oops</html>");
    expect(await store.loadDashboard("dash_1")).toBeNull();
    storage.map.set(workspaceKey("dashboard:dash_1"), JSON.stringify({ id: "other", name: "x", updatedAt: 1, doc: {} }));
    expect(await store.loadDashboard("dash_1")).toBeNull();
  });

  it("treats a corrupt version list and command log as empty", async () => {
    const { storage, store } = await corrupt("versions:dash_1", "]]]");
    storage.map.set(workspaceKey("commands:dash_1"), "nope");
    expect(await store.listVersions("dash_1")).toEqual([]);
    expect(await store.fetchCommands("dash_1", 0)).toEqual({ entries: [], cursor: 0 });
    // A repaired stream still starts at 1, so replay stays deterministic.
    expect(await store.appendCommands("dash_1", [makeCommand()])).toEqual({ cursor: 1 });
  });

  it("rebuilds the cursor from the retained entries when it was lost", async () => {
    const { store } = await corrupt(
      "commands:dash_1",
      JSON.stringify({ entries: [{ id: "c1", dashboardId: "dash_1", seq: 9, by: "human", label: "x", at: 1, actor: "a" }] }),
    );
    expect((await store.fetchCommands("dash_1", 0)).cursor).toBe(9);
    expect(await store.appendCommands("dash_1", [makeCommand()])).toEqual({ cursor: 10 });
  });
});

describe("LocalWorkspaceStore cap eviction", () => {
  it("removes the evicted dashboard's document, versions and commands", async () => {
    const storage = new FakeStorage();
    const store = new LocalWorkspaceStore({ storage });
    await store.saveDashboard(makeDashboard({ id: "dash_0", updatedAt: 1 }));
    await store.saveVersion(makeVersion({ dashboardId: "dash_0" }));
    await store.appendCommands("dash_0", [makeCommand({ dashboardId: "dash_0" })]);
    expect(storage.map.has(workspaceKey("versions:dash_0"))).toBe(true);

    for (let index = 1; index <= MAX_DASHBOARDS; index += 1) {
      await store.saveDashboard(makeDashboard({ id: `dash_${index}`, updatedAt: 1_000 + index }));
    }

    expect(await store.listDashboards()).toHaveLength(MAX_DASHBOARDS);
    expect(storage.map.has(workspaceKey("dashboard:dash_0"))).toBe(false);
    expect(storage.map.has(workspaceKey("versions:dash_0"))).toBe(false);
    expect(storage.map.has(workspaceKey("commands:dash_0"))).toBe(false);
  });

  it("deleting a dashboard also deletes its versions and command stream", async () => {
    const storage = new FakeStorage();
    const store = new LocalWorkspaceStore({ storage });
    await store.saveDashboard(makeDashboard());
    await store.saveVersion(makeVersion());
    await store.appendCommands("dash_1", [makeCommand()]);
    await store.deleteDashboard("dash_1");
    expect(storage.map.has(workspaceKey("versions:dash_1"))).toBe(false);
    expect(storage.map.has(workspaceKey("commands:dash_1"))).toBe(false);
    expect(await store.listVersions("dash_1")).toEqual([]);
  });
});
