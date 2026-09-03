/**
 * `describeWorkspaceStoreContract` — one vitest suite that every
 * `WorkspaceStore` implementation must pass.
 *
 * Same idea as the `describeDataSourceContract` kit in docs/ENGINEERING-PLAN.md:
 * the value of a seam is only real if a second implementation behaves like the
 * first. A private Kontier workspace adapter can import this file and prove
 * itself against the exact suite the local store passes, so "switch workspace"
 * can never become a subtly different product.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COMMAND_ENTRIES,
  MAX_DASHBOARDS,
  MAX_INVESTIGATIONS,
  MAX_VERSIONS_PER_DASHBOARD,
} from "./limits";
import type {
  CommandInput,
  DashboardRecord,
  InvestigationRecord,
  VersionRecord,
  WorkspaceStore,
} from "./types";

/** Builds a fresh, empty store. Called before every test in the contract. */
export type WorkspaceStoreFactory = () => WorkspaceStore | Promise<WorkspaceStore>;

/** A doc shaped like a real DashboardDoc, so tile/page counts are derivable. */
export function makeDoc(pages: number, tilesPerPage: number, title = "Revenue"): unknown {
  return {
    title,
    pages: Array.from({ length: pages }, (_unused, pageIndex) => ({
      id: `page_${pageIndex}`,
      tiles: Array.from({ length: tilesPerPage }, (_t, tileIndex) => ({
        id: `tile_${pageIndex}_${tileIndex}`,
        type: "bar",
      })),
    })),
  };
}

/** A dashboard record with sensible defaults; overrides win. */
export function makeDashboard(overrides: Partial<DashboardRecord> = {}): DashboardRecord {
  return {
    id: "dash_1",
    name: "Churn",
    updatedAt: 1_000,
    doc: makeDoc(2, 3),
    ...overrides,
  };
}

/** A version record with sensible defaults; overrides win. */
export function makeVersion(overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    id: "ver_1",
    dashboardId: "dash_1",
    label: "Before agent changes",
    savedAt: 1_000,
    tileCount: 6,
    doc: makeDoc(2, 3),
    ...overrides,
  };
}

/** An investigation record with sensible defaults; overrides win. */
export function makeInvestigation(overrides: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return {
    id: "sess_1",
    objective: "Why did November MRR drop?",
    summary: "Two enterprise accounts downgraded.",
    outcomes: ["MRR -4.2%", "Both downgrades are annual-plan renewals"],
    decisions: [{ question: "Exclude test accounts?", answer: "Yes", note: "3 seats" }],
    approvedChanges: 4,
    dashboardTitle: "Churn",
    startedAt: 900,
    completedAt: 1_000,
    ...overrides,
  };
}

/** A command input with sensible defaults; overrides win. */
export function makeCommand(overrides: Partial<CommandInput> = {}): CommandInput {
  return {
    dashboardId: "dash_1",
    by: "human",
    label: 'Added bar chart "Revenue by month"',
    at: 1_000,
    actor: "actor_a",
    ...overrides,
  };
}

/**
 * Run the shared workspace suite against `makeStore`.
 * `name` is only used to label the suite in the vitest output.
 */
export function describeWorkspaceStoreContract(name: string, makeStore: WorkspaceStoreFactory): void {
  describe(`WorkspaceStore contract: ${name}`, () => {
    let store: WorkspaceStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    // -- identity ----------------------------------------------------------

    it("reports a workspace id, a label and a kind", async () => {
      const identity = await store.identity();
      expect(identity.workspaceId.length).toBeGreaterThan(0);
      expect(identity.label.length).toBeGreaterThan(0);
      expect(["local", "remote"]).toContain(identity.kind);
    });

    // -- dashboards --------------------------------------------------------

    it("round-trips a dashboard document and derives its counts", async () => {
      const record = makeDashboard({ doc: makeDoc(3, 4) });
      const summary = await store.saveDashboard(record);
      expect(summary).toMatchObject({
        id: record.id,
        name: record.name,
        tileCount: 12,
        pageCount: 3,
      });
      // updatedAt belongs to the store, so it is checked for sanity, not
      // for equality with whatever the caller happened to send.
      expect(summary.updatedAt).toBeGreaterThan(0);
      const loaded = await store.loadDashboard(record.id);
      expect(loaded?.doc).toEqual(record.doc);
      expect(loaded?.name).toBe(record.name);
    });

    it("lists dashboards newest first, by SAVE time not the caller's clock", async () => {
      // The store stamps updatedAt. A shared workspace has several clients
      // with several clocks, so letting a caller claim a timestamp would let
      // one browser with a fast clock pin itself to the top of everyone's
      // list. The values passed here are deliberately in the wrong order to
      // prove they are ignored.
      await store.saveDashboard(makeDashboard({ id: "dash_old", updatedAt: 300 }));
      await store.saveDashboard(makeDashboard({ id: "dash_mid", updatedAt: 100 }));
      await store.saveDashboard(makeDashboard({ id: "dash_new", updatedAt: 200 }));
      const list = await store.listDashboards();
      expect(list.map((entry) => entry.id)).toEqual(["dash_new", "dash_mid", "dash_old"]);
    });

    it("replaces an existing dashboard instead of duplicating it", async () => {
      await store.saveDashboard(makeDashboard({ name: "v1", updatedAt: 100 }));
      await store.saveDashboard(makeDashboard({ name: "v2", updatedAt: 200, doc: makeDoc(1, 1) }));
      const list = await store.listDashboards();
      expect(list).toHaveLength(1);
      expect(list[0]?.name).toBe("v2");
      expect(list[0]?.tileCount).toBe(1);
      expect((await store.loadDashboard("dash_1"))?.name).toBe("v2");
    });

    it("returns null for an unknown dashboard", async () => {
      expect(await store.loadDashboard("nope")).toBeNull();
    });

    it("deletes a dashboard and tolerates deleting an unknown id", async () => {
      await store.saveDashboard(makeDashboard());
      await store.deleteDashboard("dash_1");
      expect(await store.loadDashboard("dash_1")).toBeNull();
      expect(await store.listDashboards()).toEqual([]);
      await expect(store.deleteDashboard("dash_1")).resolves.toBeUndefined();
    });

    it(`keeps at most ${MAX_DASHBOARDS} dashboards, evicting the oldest`, async () => {
      const total = MAX_DASHBOARDS + 5;
      for (let index = 0; index < total; index += 1) {
        await store.saveDashboard(makeDashboard({ id: `dash_${index}`, updatedAt: 1_000 + index }));
      }
      const list = await store.listDashboards();
      expect(list).toHaveLength(MAX_DASHBOARDS);
      expect(list[0]?.id).toBe(`dash_${total - 1}`);
      expect(list.some((entry) => entry.id === "dash_0")).toBe(false);
      expect(await store.loadDashboard("dash_0")).toBeNull();
    });

    // -- versions ----------------------------------------------------------

    it("round-trips a version snapshot and lists it without the doc", async () => {
      const version = makeVersion();
      const summary = await store.saveVersion(version);
      expect(summary).toEqual({
        id: version.id,
        dashboardId: version.dashboardId,
        label: version.label,
        savedAt: version.savedAt,
        tileCount: version.tileCount,
      });
      expect(await store.listVersions("dash_1")).toEqual([summary]);
      expect((await store.loadVersion("dash_1", "ver_1"))?.doc).toEqual(version.doc);
    });

    it("lists versions newest first", async () => {
      await store.saveVersion(makeVersion({ id: "ver_a", savedAt: 100 }));
      await store.saveVersion(makeVersion({ id: "ver_c", savedAt: 300 }));
      await store.saveVersion(makeVersion({ id: "ver_b", savedAt: 200 }));
      const list = await store.listVersions("dash_1");
      expect(list.map((entry) => entry.id)).toEqual(["ver_c", "ver_b", "ver_a"]);
    });

    it("scopes versions to their dashboard", async () => {
      await store.saveVersion(makeVersion({ id: "ver_a", dashboardId: "dash_1" }));
      await store.saveVersion(makeVersion({ id: "ver_b", dashboardId: "dash_2" }));
      expect((await store.listVersions("dash_1")).map((v) => v.id)).toEqual(["ver_a"]);
      expect((await store.listVersions("dash_2")).map((v) => v.id)).toEqual(["ver_b"]);
      expect(await store.loadVersion("dash_1", "ver_b")).toBeNull();
    });

    it("returns null for an unknown version and deletes idempotently", async () => {
      await store.saveVersion(makeVersion());
      expect(await store.loadVersion("dash_1", "nope")).toBeNull();
      await store.deleteVersion("dash_1", "ver_1");
      expect(await store.listVersions("dash_1")).toEqual([]);
      await expect(store.deleteVersion("dash_1", "ver_1")).resolves.toBeUndefined();
    });

    it(`keeps at most ${MAX_VERSIONS_PER_DASHBOARD} versions per dashboard`, async () => {
      const total = MAX_VERSIONS_PER_DASHBOARD + 5;
      for (let index = 0; index < total; index += 1) {
        await store.saveVersion(makeVersion({ id: `ver_${index}`, savedAt: 1_000 + index }));
      }
      const list = await store.listVersions("dash_1");
      expect(list).toHaveLength(MAX_VERSIONS_PER_DASHBOARD);
      expect(list[0]?.id).toBe(`ver_${total - 1}`);
      expect(await store.loadVersion("dash_1", "ver_0")).toBeNull();
    });

    // -- investigations ----------------------------------------------------

    it("round-trips investigations, newest first", async () => {
      const first = makeInvestigation({ id: "sess_a", completedAt: 100 });
      const second = makeInvestigation({ id: "sess_b", completedAt: 200 });
      await store.saveInvestigation(first);
      await store.saveInvestigation(second);
      const list = await store.listInvestigations();
      expect(list.map((record) => record.id)).toEqual(["sess_b", "sess_a"]);
      expect(list[1]).toEqual(first);
    });

    it("replaces an investigation with the same id", async () => {
      await store.saveInvestigation(makeInvestigation({ summary: "draft" }));
      await store.saveInvestigation(makeInvestigation({ summary: "final" }));
      const list = await store.listInvestigations();
      expect(list).toHaveLength(1);
      expect(list[0]?.summary).toBe("final");
    });

    it(`keeps at most ${MAX_INVESTIGATIONS} investigations`, async () => {
      const total = MAX_INVESTIGATIONS + 5;
      for (let index = 0; index < total; index += 1) {
        await store.saveInvestigation(
          makeInvestigation({ id: `sess_${index}`, completedAt: 1_000 + index }),
        );
      }
      const list = await store.listInvestigations();
      expect(list).toHaveLength(MAX_INVESTIGATIONS);
      expect(list[0]?.id).toBe(`sess_${total - 1}`);
      expect(list.some((record) => record.id === "sess_0")).toBe(false);
    });

    // -- command stream ----------------------------------------------------

    it("assigns seq itself and returns a monotonic cursor", async () => {
      const first = await store.appendCommands("dash_1", [makeCommand(), makeCommand()]);
      expect(first.cursor).toBe(2);
      const second = await store.appendCommands("dash_1", [makeCommand({ by: "agent" })]);
      expect(second.cursor).toBe(3);
      const page = await store.fetchCommands("dash_1", 0);
      expect(page.entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
      expect(page.cursor).toBe(3);
      for (const entry of page.entries) {
        expect(entry.id.length).toBeGreaterThan(0);
        expect(entry.dashboardId).toBe("dash_1");
      }
      expect(page.entries[2]?.by).toBe("agent");
      expect(new Set(page.entries.map((entry) => entry.id)).size).toBe(3);
    });

    it("fetchCommands(since) returns only newer entries", async () => {
      await store.appendCommands("dash_1", [
        makeCommand({ label: "one" }),
        makeCommand({ label: "two" }),
        makeCommand({ label: "three" }),
      ]);
      const page = await store.fetchCommands("dash_1", 1);
      expect(page.entries.map((entry) => entry.label)).toEqual(["two", "three"]);
      expect(page.cursor).toBe(3);
      const caughtUp = await store.fetchCommands("dash_1", page.cursor);
      expect(caughtUp.entries).toEqual([]);
      expect(caughtUp.cursor).toBe(3);
    });

    it("keeps command streams scoped to their dashboard", async () => {
      await store.appendCommands("dash_1", [makeCommand({ label: "a" })]);
      await store.appendCommands("dash_2", [
        makeCommand({ dashboardId: "dash_2", label: "b" }),
        makeCommand({ dashboardId: "dash_2", label: "c" }),
      ]);
      const one = await store.fetchCommands("dash_1", 0);
      const two = await store.fetchCommands("dash_2", 0);
      expect(one.entries.map((entry) => entry.label)).toEqual(["a"]);
      expect(one.cursor).toBe(1);
      expect(two.entries.map((entry) => entry.seq)).toEqual([1, 2]);
      expect(two.cursor).toBe(2);
    });

    it("preserves the actor so a peer can skip its own commands", async () => {
      await store.appendCommands("dash_1", [makeCommand({ actor: "actor_a" })]);
      await store.appendCommands("dash_1", [makeCommand({ actor: "actor_b" })]);
      const page = await store.fetchCommands("dash_1", 0);
      expect(page.entries.map((entry) => entry.actor)).toEqual(["actor_a", "actor_b"]);
    });

    it("appending nothing leaves the cursor unchanged", async () => {
      expect((await store.appendCommands("dash_1", [])).cursor).toBe(0);
      await store.appendCommands("dash_1", [makeCommand()]);
      expect((await store.appendCommands("dash_1", [])).cursor).toBe(1);
      expect((await store.fetchCommands("dash_1", 0)).entries).toHaveLength(1);
    });

    it(`evicts past ${MAX_COMMAND_ENTRIES} entries but never rewinds the cursor`, async () => {
      const total = MAX_COMMAND_ENTRIES + 100;
      const batch = 100;
      let cursor = 0;
      for (let start = 0; start < total; start += batch) {
        const entries = Array.from({ length: batch }, (_unused, offset) =>
          makeCommand({ label: `cmd_${start + offset}` }),
        );
        const result = await store.appendCommands("dash_1", entries);
        expect(result.cursor).toBeGreaterThan(cursor);
        cursor = result.cursor;
      }
      expect(cursor).toBe(total);
      const page = await store.fetchCommands("dash_1", 0);
      expect(page.cursor).toBe(total);
      expect(page.entries.length).toBeLessThanOrEqual(MAX_COMMAND_ENTRIES);
      expect(page.entries.at(-1)?.seq).toBe(total);
      expect(page.entries.at(-1)?.label).toBe(`cmd_${total - 1}`);
      const seqs = page.entries.map((entry) => entry.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    });

    // -- presence ----------------------------------------------------------

    it("heartbeat returns a peer list that contains the caller", async () => {
      const peers = await store.heartbeat("actor_a", "Zaid", "dash_1");
      const self = peers.find((peer) => peer.actor === "actor_a");
      expect(self?.label).toBe("Zaid");
      expect(self?.dashboardId).toBe("dash_1");
      expect(typeof self?.lastSeen).toBe("number");
    });

    it("heartbeat accepts a null dashboard for a peer that is not on one", async () => {
      const peers = await store.heartbeat("actor_a", "Zaid", null);
      expect(peers.find((peer) => peer.actor === "actor_a")?.dashboardId).toBeNull();
    });
  });
}
