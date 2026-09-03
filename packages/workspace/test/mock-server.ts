/**
 * In-memory workspace server used by `test/http.test.ts`.
 *
 * It implements the REST contract documented in `src/http.ts` — including the
 * retention caps and the server-assigned `seq` — so `HttpWorkspaceStore` can be
 * run against the same conformance suite as `LocalWorkspaceStore` without a
 * network. The counting logic is intentionally re-implemented here rather than
 * imported: a test double that shares the production helper cannot disagree
 * with it, and disagreement is exactly what this suite is meant to catch.
 */

import {
  MAX_COMMAND_ENTRIES,
  MAX_DASHBOARDS,
  MAX_INVESTIGATIONS,
  MAX_VERSIONS_PER_DASHBOARD,
  PRESENCE_TTL_MS,
} from "../src/limits";
import type { FetchLike } from "../src/http";
import type {
  CommandEntry,
  CommandInput,
  DashboardRecord,
  DashboardSummary,
  InvestigationRecord,
  PresencePeer,
  SessionRecord,
  VersionRecord,
  VersionSummary,
} from "../src/types";

/** One request the store made, so tests can assert paths, methods and auth. */
export interface RecordedCall {
  method: string;
  /** Path + query, relative to the base URL. */
  path: string;
  /** Raw `Authorization` header value, or null when absent. */
  authorization: string | null;
  contentType: string | null;
}

/** Lets a test force a failure for one endpoint without touching the router. */
export type Intercept = (method: string, path: string) => Response | undefined;

export interface MockWorkspaceServer {
  /** Base URL to hand to `HttpWorkspaceStore`. */
  baseUrl: string;
  /** Token the server accepts; anything else gets a 401. */
  token: string;
  /** Drop-in `fetch` for `HttpWorkspaceStore({ fetch })`. */
  fetch: FetchLike;
  /** Every request received, in order. */
  calls: RecordedCall[];
  /** Install (or clear) a fault injector. */
  setIntercept(intercept: Intercept | null): void;
  /** Register a peer without going through the store (multi-peer presence). */
  seedPeer(peer: PresencePeer): void;
  /** Frozen clock used for `lastSeen`, so presence tests are deterministic. */
  now: number;
}

const BASE_URL = "https://workspace.test/v1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function errorResponse(status: number, message: string, code: string): Response {
  return json({ message, code }, status);
}

/** Independent re-implementation of the tile/page count the picker needs. */
function countTiles(doc: unknown): { tileCount: number; pageCount: number } {
  if (typeof doc !== "object" || doc === null) return { tileCount: 0, pageCount: 0 };
  const pages = (doc as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return { tileCount: 0, pageCount: 0 };
  let tileCount = 0;
  for (const page of pages) {
    const tiles = (page as { tiles?: unknown } | null)?.tiles;
    if (Array.isArray(tiles)) tileCount += tiles.length;
  }
  return { tileCount, pageCount: pages.length };
}

function toDashboardSummary(record: DashboardRecord): DashboardSummary {
  const { tileCount, pageCount } = countTiles(record.doc);
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, tileCount, pageCount };
}

function toVersionSummary(record: VersionRecord): VersionSummary {
  return {
    id: record.id,
    dashboardId: record.dashboardId,
    label: record.label,
    savedAt: record.savedAt,
    tileCount: record.tileCount,
  };
}

/** Create a fresh server; every instance starts empty. */
export function createMockWorkspaceServer(): MockWorkspaceServer {
  const dashboards = new Map<string, DashboardRecord>();
  const versions = new Map<string, VersionRecord[]>();
  const sessions = new Map<string, SessionRecord>();
  const commands = new Map<string, { cursor: number; entries: CommandEntry[] }>();
  const peers = new Map<string, PresencePeer>();
  let investigations: InvestigationRecord[] = [];
  let intercept: Intercept | null = null;
  let commandId = 0;

  const server: MockWorkspaceServer = {
    baseUrl: BASE_URL,
    token: "tok_test",
    calls: [],
    now: 1_700_000_000_000,
    setIntercept(next) {
      intercept = next;
    },
    seedPeer(peer) {
      peers.set(peer.actor, peer);
    },
    fetch: async (input, init) => handle(input, init),
  };

  function dropDashboard(id: string): void {
    dashboards.delete(id);
    versions.delete(id);
    commands.delete(id);
  }

  function handle(input: string, init?: RequestInit): Response {
    const url = new URL(input);
    const path = `${url.pathname.replace("/v1", "")}`;
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? "GET").toUpperCase();
    server.calls.push({
      method,
      path: `${path}${url.search}`,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
    });

    const forced = intercept?.(method, path);
    if (forced) return forced;

    if (headers.get("authorization") !== `Bearer ${server.token}`) {
      return errorResponse(401, "Missing or invalid bearer token", "unauthorized");
    }

    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const segments = path.split("/").filter(Boolean);

    if (path === "/identity" && method === "GET") {
      return json({ workspaceId: "ws_shared", label: "Kontier Cloud", kind: "remote" });
    }

    if (path === "/investigations") {
      if (method === "GET") return json({ investigations });
      if (method === "POST") {
        const record = body as InvestigationRecord;
        investigations = [...investigations.filter((item) => item.id !== record.id), record]
          .sort((a, b) => b.completedAt - a.completedAt)
          .slice(0, MAX_INVESTIGATIONS);
        return noContent();
      }
    }

    if (path === "/presence" && method === "POST") {
      const { actor, label, dashboardId } = body as {
        actor: string;
        label: string;
        dashboardId: string | null;
      };
      peers.set(actor, { actor, label, dashboardId, lastSeen: server.now });
      const live = [...peers.values()].filter((peer) => server.now - peer.lastSeen < PRESENCE_TTL_MS);
      return json({ peers: live });
    }

    if (segments[0] === "dashboards") {
      if (segments.length === 1 && method === "GET") {
        const list = [...dashboards.values()]
          .map(toDashboardSummary)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        return json({ dashboards: list });
      }

      const id = segments[1] ? decodeURIComponent(segments[1]) : null;
      if (!id) return errorResponse(404, `No route for ${method} ${path}`, "not_found");

      if (segments.length === 2) {
        if (method === "GET") {
          const record = dashboards.get(id);
          return record ? json(record) : errorResponse(404, `Unknown dashboard ${id}`, "not_found");
        }
        if (method === "PUT") {
          // The id comes from the PATH and updatedAt is assigned here, which
          // is what the real API does. This mock used to read both from the
          // body, so it accepted a request shape the server rejects with 400
          // — the contract suite passed against a server that did not exist.
          const sent = body as { name: string; doc: DashboardRecord["doc"] };
          // Each write gets a later timestamp than the last, because the
          // STORE owns this clock. A shared workspace cannot let a client's
          // clock decide what is newest - the same reason `seq` is assigned
          // here and not sent.
          server.now += 1;
          const record: DashboardRecord = {
            id,
            name: sent.name,
            doc: sent.doc,
            updatedAt: server.now,
          };
          dashboards.set(id, record);
          const ordered = [...dashboards.values()].sort((a, b) => b.updatedAt - a.updatedAt);
          for (const evicted of ordered.slice(MAX_DASHBOARDS)) dropDashboard(evicted.id);
          return json(toDashboardSummary(record));
        }
        if (method === "DELETE") {
          if (!dashboards.has(id)) return errorResponse(404, `Unknown dashboard ${id}`, "not_found");
          dropDashboard(id);
          return noContent();
        }
      }

      if (segments[2] === "session" && segments.length === 3) {
        if (method === "GET") {
          const record = sessions.get(id);
          return record
            ? json({ session: record })
            : errorResponse(404, `No session for ${id}`, "not_found");
        }
        if (method === "PUT") {
          server.now += 1;
          const record: SessionRecord = {
            dashboardId: id,
            state: (body as { state: unknown }).state,
            updatedAt: server.now,
          };
          sessions.set(id, record);
          return json({ session: record });
        }
      }

      if (segments[2] === "versions") {
        const list = versions.get(id) ?? [];
        const versionId = segments[3] ? decodeURIComponent(segments[3]) : null;
        if (!versionId && method === "GET") {
          return json({ versions: list.map(toVersionSummary) });
        }
        if (versionId && method === "PUT") {
          const record = body as VersionRecord;
          const next = [...list.filter((item) => item.id !== versionId), record]
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(0, MAX_VERSIONS_PER_DASHBOARD);
          versions.set(id, next);
          return json(toVersionSummary(record));
        }
        if (versionId && method === "GET") {
          const record = list.find((item) => item.id === versionId);
          return record ? json(record) : errorResponse(404, `Unknown version ${versionId}`, "not_found");
        }
        if (versionId && method === "DELETE") {
          if (!list.some((item) => item.id === versionId)) {
            return errorResponse(404, `Unknown version ${versionId}`, "not_found");
          }
          versions.set(id, list.filter((item) => item.id !== versionId));
          return noContent();
        }
      }

      if (segments[2] === "commands" && segments.length === 3) {
        const log = commands.get(id) ?? { cursor: 0, entries: [] };
        if (method === "POST") {
          const entries = (body as { entries?: CommandInput[] }).entries ?? [];
          for (const entry of entries) {
            commandId += 1;
            log.cursor += 1;
            log.entries.push({ ...entry, dashboardId: id, id: `srv_${commandId}`, seq: log.cursor });
          }
          log.entries = log.entries.slice(-MAX_COMMAND_ENTRIES);
          commands.set(id, log);
          return json({ cursor: log.cursor });
        }
        if (method === "GET") {
          const since = Number(url.searchParams.get("since") ?? "0");
          return json({
            entries: log.entries.filter((entry) => entry.seq > since),
            cursor: log.cursor,
          });
        }
      }
    }

    return errorResponse(404, `No route for ${method} ${path}`, "not_found");
  }

  return server;
}
