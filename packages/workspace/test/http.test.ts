/**
 * `HttpWorkspaceStore`: the shared contract driven through the in-memory REST
 * server, plus the things only a network store can get wrong — auth headers,
 * request shapes, and turning every failure into a `WorkspaceError` instead of
 * a silent empty list.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { makeCommand, makeDashboard, makeInvestigation, makeVersion } from "../src/conformance";
import { describeWorkspaceStoreContract } from "../src/conformance";
import { WorkspaceError, isRetryableWorkspaceError } from "../src/errors";
import { HttpWorkspaceStore } from "../src/http";
import { createMockWorkspaceServer } from "./mock-server";
import type { MockWorkspaceServer } from "./mock-server";

/** Await a rejection and narrow it to WorkspaceError; fails if the call resolved. */
async function captureWorkspaceError(promise: Promise<unknown>): Promise<WorkspaceError> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(WorkspaceError);
    return caught as WorkspaceError;
  }
  throw new Error("Expected the workspace call to reject, but it resolved");
}

describeWorkspaceStoreContract("HttpWorkspaceStore", () => {
  const server = createMockWorkspaceServer();
  return new HttpWorkspaceStore({ baseUrl: server.baseUrl, token: server.token, fetch: server.fetch });
});

describe("HttpWorkspaceStore request shape", () => {
  let server: MockWorkspaceServer;
  let store: HttpWorkspaceStore;

  beforeEach(() => {
    server = createMockWorkspaceServer();
    store = new HttpWorkspaceStore({
      baseUrl: `${server.baseUrl}/`, // trailing slash must not produce `//dashboards`
      token: server.token,
      fetch: server.fetch,
    });
  });

  it("sends a bearer token on every request, read or write", async () => {
    await store.listDashboards();
    await store.saveDashboard(makeDashboard());
    await store.deleteDashboard("dash_1");
    expect(server.calls).toHaveLength(3);
    for (const call of server.calls) expect(call.authorization).toBe(`Bearer ${server.token}`);
  });

  it("sets a JSON content type on writes only", async () => {
    await store.listDashboards();
    await store.saveDashboard(makeDashboard());
    expect(server.calls[0]?.contentType).toBeNull();
    expect(server.calls[1]?.contentType).toBe("application/json");
  });

  it("uses the documented method and path for every operation", async () => {
    await store.identity();
    await store.listDashboards();
    await store.saveDashboard(makeDashboard());
    await store.loadDashboard("dash_1");
    await store.listVersions("dash_1");
    await store.saveVersion(makeVersion());
    await store.loadVersion("dash_1", "ver_1");
    await store.deleteVersion("dash_1", "ver_1");
    await store.listInvestigations();
    await store.saveInvestigation(makeInvestigation());
    await store.appendCommands("dash_1", [makeCommand()]);
    await store.fetchCommands("dash_1", 3);
    await store.heartbeat("actor_a", "Zaid", "dash_1");
    await store.deleteDashboard("dash_1");

    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /identity",
      "GET /dashboards",
      "PUT /dashboards/dash_1",
      "GET /dashboards/dash_1",
      "GET /dashboards/dash_1/versions",
      "PUT /dashboards/dash_1/versions/ver_1",
      "GET /dashboards/dash_1/versions/ver_1",
      "DELETE /dashboards/dash_1/versions/ver_1",
      "GET /investigations",
      "POST /investigations",
      "POST /dashboards/dash_1/commands",
      "GET /dashboards/dash_1/commands?since=3",
      "POST /presence",
      "DELETE /dashboards/dash_1",
    ]);
  });

  it("percent-encodes ids so a slash in an id cannot forge a path", async () => {
    await store.loadDashboard("a/b?x=1");
    expect(server.calls[0]?.path).toBe("/dashboards/a%2Fb%3Fx%3D1");
  });

  it('always reports kind "remote", whatever the server claims', async () => {
    server.setIntercept((method, path) =>
      method === "GET" && path === "/identity"
        ? new Response(JSON.stringify({ workspaceId: "ws_1", label: "Cloud", kind: "local" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : undefined,
    );
    expect(await store.identity()).toEqual({ workspaceId: "ws_1", label: "Cloud", kind: "remote" });
  });

  it("accepts a bare array as well as the wrapped list shape", async () => {
    server.setIntercept((method, path) =>
      method === "GET" && path === "/dashboards"
        ? new Response(JSON.stringify([{ id: "d", name: "n", updatedAt: 1, tileCount: 0, pageCount: 0 }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : undefined,
    );
    expect((await store.listDashboards()).map((entry) => entry.id)).toEqual(["d"]);
  });
});

describe("HttpWorkspaceStore presence", () => {
  it("lists every live peer, not just the caller", async () => {
    const server = createMockWorkspaceServer();
    const store = new HttpWorkspaceStore({ baseUrl: server.baseUrl, token: server.token, fetch: server.fetch });
    server.seedPeer({ actor: "actor_agent", label: "Agent", lastSeen: server.now, dashboardId: "dash_1" });
    const peers = await store.heartbeat("actor_a", "Zaid", "dash_1");
    expect(peers.map((peer) => peer.actor).sort()).toEqual(["actor_a", "actor_agent"]);
  });

  it("drops peers whose heartbeat expired", async () => {
    const server = createMockWorkspaceServer();
    const store = new HttpWorkspaceStore({ baseUrl: server.baseUrl, token: server.token, fetch: server.fetch });
    server.seedPeer({ actor: "actor_ghost", label: "Gone", lastSeen: server.now - 120_000, dashboardId: null });
    const peers = await store.heartbeat("actor_a", "Zaid", null);
    expect(peers.map((peer) => peer.actor)).toEqual(["actor_a"]);
  });
});

describe("HttpWorkspaceStore error mapping", () => {
  let server: MockWorkspaceServer;
  let store: HttpWorkspaceStore;

  const fail = (status: number, body: string, contentType = "application/json") => {
    server.setIntercept(() => new Response(body, { status, headers: { "content-type": contentType } }));
  };

  beforeEach(() => {
    server = createMockWorkspaceServer();
    store = new HttpWorkspaceStore({ baseUrl: server.baseUrl, token: server.token, fetch: server.fetch });
  });

  it("rejects with a WorkspaceError carrying the status and the server message", async () => {
    fail(500, JSON.stringify({ message: "primary is down", code: "db_unavailable" }));
    const workspaceError = await captureWorkspaceError(store.listDashboards());
    expect(workspaceError.status).toBe(500);
    expect(workspaceError.code).toBe("db_unavailable");
    expect(workspaceError.url).toBe(`${server.baseUrl}/dashboards`);
    expect(workspaceError.message).toContain("500");
    expect(workspaceError.message).toContain("primary is down");
    expect(isRetryableWorkspaceError(workspaceError)).toBe(true);
  });

  it("maps a bad token to a 401 error instead of an empty workspace", async () => {
    const wrong = new HttpWorkspaceStore({ baseUrl: server.baseUrl, token: "nope", fetch: server.fetch });
    await expect(wrong.listDashboards()).rejects.toThrow(WorkspaceError);
    const error = await captureWorkspaceError(wrong.listDashboards());
    expect(error.status).toBe(401);
    expect(error.code).toBe("unauthorized");
    expect(isRetryableWorkspaceError(error)).toBe(false);
  });

  it("uses a non-JSON error body as the message", async () => {
    fail(502, "<html>bad gateway</html>", "text/html");
    const error = await captureWorkspaceError(store.listDashboards());
    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
    expect(error.message).toContain("bad gateway");
  });

  it("reports an unreachable workspace as status 0 and keeps the cause", async () => {
    const offline = new HttpWorkspaceStore({
      baseUrl: server.baseUrl,
      token: server.token,
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const error = await captureWorkspaceError(offline.listDashboards());
    expect(error.status).toBe(0);
    expect(error.message).toContain("workspace unreachable");
    expect(error.message).toContain("Failed to fetch");
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(isRetryableWorkspaceError(error)).toBe(true);
  });

  it("rejects a 200 that is not JSON rather than pretending it was empty", async () => {
    fail(200, "not json at all", "text/plain");
    const error = await captureWorkspaceError(store.listDashboards());
    expect(error.code).toBe("invalid_json");
    expect(error.message).toContain("not valid JSON");
  });

  it("rejects a write that answers 204 when a body is required", async () => {
    server.setIntercept((method) => (method === "PUT" ? new Response(null, { status: 204 }) : undefined));
    const error = await captureWorkspaceError(store.saveDashboard(makeDashboard()));
    expect(error.code).toBe("empty_body");
  });

  it("treats 404 as null on reads and as success on deletes", async () => {
    expect(await store.loadDashboard("missing")).toBeNull();
    expect(await store.loadVersion("dash_1", "missing")).toBeNull();
    await expect(store.deleteDashboard("missing")).resolves.toBeUndefined();
    await expect(store.deleteVersion("dash_1", "missing")).resolves.toBeUndefined();
  });

  it("does NOT treat other delete failures as success", async () => {
    fail(403, JSON.stringify({ message: "read-only workspace", code: "forbidden" }));
    const error = await captureWorkspaceError(store.deleteDashboard("dash_1"));
    expect(error.status).toBe(403);
    expect(error.code).toBe("forbidden");
  });

  it("throws at construction when no fetch is available", () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    try {
      delete (globalThis as { fetch?: unknown }).fetch;
      expect(() => new HttpWorkspaceStore({ baseUrl: server.baseUrl, token: server.token })).toThrow(
        WorkspaceError,
      );
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});
