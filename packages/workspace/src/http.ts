/**
 * `HttpWorkspaceStore` — the shared half of the seam: the same `WorkspaceStore`
 * served by a Kontier workspace service over REST.
 *
 * It exists so a team can open the same dashboards, the same version history
 * and the same command stream from different machines, without the UI learning
 * anything new: the shell swaps the constructor and everything else is
 * unchanged. The server is the ordering authority (it assigns `seq`) and the
 * validation authority (it owns the zod schemas), which is why this file has
 * neither a sequence generator nor a document schema.
 *
 * REST contract (all paths relative to `baseUrl`, all bodies JSON,
 * `Authorization: Bearer <token>` on every request):
 *
 *   GET    /identity                              -> 200 WorkspaceIdentity
 *   GET    /dashboards                            -> 200 { dashboards: DashboardSummary[] }   (newest first)
 *   GET    /dashboards/:id                        -> 200 DashboardRecord | 404 -> null
 *   PUT    /dashboards/:id                        -> 200 DashboardSummary
 *   DELETE /dashboards/:id                        -> 204 | 404 (already gone, not an error)
 *   GET    /dashboards/:id/versions               -> 200 { versions: VersionSummary[] }       (newest first)
 *   PUT    /dashboards/:id/versions/:versionId    -> 200 VersionSummary
 *   GET    /dashboards/:id/versions/:versionId    -> 200 VersionRecord | 404 -> null
 *   DELETE /dashboards/:id/versions/:versionId    -> 204 | 404 (already gone, not an error)
 *   GET    /investigations                        -> 200 { investigations: InvestigationRecord[] } (newest first)
 *   POST   /investigations                        -> 200/201/204 (create-or-replace by id)
 *   POST   /dashboards/:id/commands               -> 200 { cursor: number }
 *   GET    /dashboards/:id/commands?since=N       -> 200 { entries: CommandEntry[], cursor: number }
 *   POST   /presence                              -> 200 { peers: PresencePeer[] }
 *
 * Every other status is a `WorkspaceError` carrying the status and a readable
 * message. Failures are never swallowed: a silent workspace is worse than a
 * loud one, because the human would keep editing a document that is not saved.
 */

import { WorkspaceError } from "./errors";
import type {
  CommandAppendResult,
  CommandInput,
  CommandPage,
  DashboardRecord,
  DashboardSummary,
  InvestigationRecord,
  PresencePeer,
  VersionRecord,
  VersionSummary,
  WorkspaceIdentity,
  WorkspaceStore,
} from "./types";

/** The `fetch` shape this store needs, so tests can inject an in-memory server. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Construction options for a server-backed workspace. */
export interface HttpWorkspaceStoreOptions {
  /** Root of the workspace API, e.g. `https://api.kontier.io/v1/workspace`. */
  baseUrl: string;
  /** Bearer token; sent on every request, including reads. */
  token: string;
  /** Injectable fetch; defaults to the global one (browser or Node 22+). */
  fetch?: FetchLike;
}

/** Bodies the store sends; declared so no request payload is typed `any`. */
type JsonBody = Record<string, unknown> | DashboardRecord | VersionRecord | InvestigationRecord;

interface RequestOptions {
  /** Query parameters appended to the path. */
  query?: Record<string, string>;
  /** JSON request body. */
  body?: JsonBody;
  /** Return `null` on 404 instead of throwing (used by the `load*` reads). */
  nullOn404?: boolean;
  /** Treat 404 as success (used by the idempotent `delete*` calls). */
  ignore404?: boolean;
}

/** Best-effort extraction of a server-supplied message/code from an error body. */
function describeErrorBody(text: string): { message: string; code: string | undefined } {
  if (!text) return { message: "", code: undefined };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const message = record["message"] ?? record["error"];
      const code = record["code"];
      return {
        message: typeof message === "string" ? message : "",
        code: typeof code === "string" ? code : undefined,
      };
    }
  } catch {
    /* not JSON: fall through and use the raw text */
  }
  return { message: text.slice(0, 200), code: undefined };
}

/**
 * Read a single object that may or may not arrive inside an envelope.
 *
 * The server wraps single items (`{ dashboard: ... }`) so a 404 can still
 * carry a typed `null`. An earlier client read the bare object, so every
 * loaded document came back with `doc: undefined` — the report opened empty
 * and nothing reported an error. Accept both shapes rather than pick a side:
 * a published contract should tolerate the reading it did not choose.
 */
function unwrap<T>(payload: unknown, key: string): T | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === "object" && key in (payload as Record<string, unknown>)) {
    const inner = (payload as Record<string, unknown>)[key];
    return (inner ?? null) as T | null;
  }
  return payload as T;
}

export class HttpWorkspaceStore implements WorkspaceStore {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly doFetch: FetchLike;

  constructor(options: HttpWorkspaceStoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    const injected = options.fetch;
    if (injected) {
      this.doFetch = injected;
    } else {
      const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
      if (!globalFetch) {
        throw new WorkspaceError("No fetch implementation available", { status: 0, url: this.baseUrl });
      }
      this.doFetch = (input, init) => globalFetch(input, init);
    }
  }

  // -- transport -----------------------------------------------------------

  /** One request + one error policy for the whole store. */
  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T | null> {
    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
    const url = `${this.baseUrl}${path}${query}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.doFetch(url, init);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new WorkspaceError(`${method} ${url} failed: workspace unreachable (${detail})`, {
        status: 0,
        url,
        cause,
      });
    }

    if (response.status === 404 && (options.nullOn404 || options.ignore404)) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const { message, code } = describeErrorBody(text);
      const suffix = message ? ` - ${message}` : "";
      throw new WorkspaceError(
        `${method} ${url} failed: ${response.status} ${response.statusText || "error"}${suffix}`,
        { status: response.status, url, ...(code === undefined ? {} : { code }) },
      );
    }
    if (response.status === 204) return null;

    const text = await response.text().catch(() => "");
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new WorkspaceError(`${method} ${url} failed: response was not valid JSON`, {
        status: response.status,
        url,
        code: "invalid_json",
        cause,
      });
    }
  }

  /** Request that must produce a body; a 204/empty response is a contract break. */
  private async requireJson<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const value = await this.request<T>(method, path, options);
    if (value === null) {
      throw new WorkspaceError(`${method} ${this.baseUrl}${path} failed: empty response body`, {
        status: 0,
        url: `${this.baseUrl}${path}`,
        code: "empty_body",
      });
    }
    return value;
  }

  /** Accept both `{ key: [...] }` and a bare array, so a thin server still works. */
  private static list<T>(payload: unknown, key: string): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (payload !== null && typeof payload === "object") {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
    return [];
  }

  // -- identity ------------------------------------------------------------

  async identity(): Promise<WorkspaceIdentity> {
    const raw = await this.requireJson<Partial<WorkspaceIdentity>>("GET", "/identity");
    return {
      workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : this.baseUrl,
      label: typeof raw.label === "string" ? raw.label : "Shared workspace",
      // A server-backed workspace is remote by definition; never trust a stray "local".
      kind: "remote",
    };
  }

  // -- dashboards ----------------------------------------------------------

  async listDashboards(): Promise<DashboardSummary[]> {
    const payload = await this.request<unknown>("GET", "/dashboards");
    return HttpWorkspaceStore.list<DashboardSummary>(payload, "dashboards");
  }

  async loadDashboard(id: string): Promise<DashboardRecord | null> {
    const payload = await this.request<unknown>("GET", `/dashboards/${encodeURIComponent(id)}`, {
      nullOn404: true,
    });
    return unwrap<DashboardRecord>(payload, "dashboard");
  }

  async saveDashboard(record: DashboardRecord): Promise<DashboardSummary> {
    // Send only what the server owns the truth about. The id is already in
    // the path and `updatedAt` is assigned server-side, so including them
    // made every save fail against a strict body schema — a 400 on the one
    // request that carries the user's work.
    return this.requireJson<DashboardSummary>("PUT", `/dashboards/${encodeURIComponent(record.id)}`, {
      body: { name: record.name, doc: record.doc },
    });
  }

  async deleteDashboard(id: string): Promise<void> {
    await this.request<never>("DELETE", `/dashboards/${encodeURIComponent(id)}`, { ignore404: true });
  }

  // -- versions ------------------------------------------------------------

  async listVersions(dashboardId: string): Promise<VersionSummary[]> {
    const payload = await this.request<unknown>(
      "GET",
      `/dashboards/${encodeURIComponent(dashboardId)}/versions`,
    );
    return HttpWorkspaceStore.list<VersionSummary>(payload, "versions");
  }

  async saveVersion(record: VersionRecord): Promise<VersionSummary> {
    return this.requireJson<VersionSummary>(
      "PUT",
      `/dashboards/${encodeURIComponent(record.dashboardId)}/versions/${encodeURIComponent(record.id)}`,
      { body: record },
    );
  }

  async loadVersion(dashboardId: string, versionId: string): Promise<VersionRecord | null> {
    return this.request<VersionRecord>(
      "GET",
      `/dashboards/${encodeURIComponent(dashboardId)}/versions/${encodeURIComponent(versionId)}`,
      { nullOn404: true },
    );
  }

  async deleteVersion(dashboardId: string, versionId: string): Promise<void> {
    await this.request<never>(
      "DELETE",
      `/dashboards/${encodeURIComponent(dashboardId)}/versions/${encodeURIComponent(versionId)}`,
      { ignore404: true },
    );
  }

  // -- investigations ------------------------------------------------------

  async listInvestigations(): Promise<InvestigationRecord[]> {
    const payload = await this.request<unknown>("GET", "/investigations");
    return HttpWorkspaceStore.list<InvestigationRecord>(payload, "investigations");
  }

  async saveInvestigation(record: InvestigationRecord): Promise<void> {
    await this.request<never>("POST", "/investigations", { body: record });
  }

  // -- command stream ------------------------------------------------------

  async appendCommands(dashboardId: string, entries: CommandInput[]): Promise<CommandAppendResult> {
    return this.requireJson<CommandAppendResult>(
      "POST",
      `/dashboards/${encodeURIComponent(dashboardId)}/commands`,
      { body: { entries } },
    );
  }

  async fetchCommands(dashboardId: string, sinceSeq: number): Promise<CommandPage> {
    const payload = await this.requireJson<Partial<CommandPage>>(
      "GET",
      `/dashboards/${encodeURIComponent(dashboardId)}/commands`,
      { query: { since: String(sinceSeq) } },
    );
    return {
      entries: HttpWorkspaceStore.list(payload, "entries"),
      cursor: typeof payload.cursor === "number" ? payload.cursor : 0,
    };
  }

  // -- presence ------------------------------------------------------------

  async heartbeat(actor: string, label: string, dashboardId: string | null): Promise<PresencePeer[]> {
    const payload = await this.request<unknown>("POST", "/presence", {
      body: { actor, label, dashboardId },
    });
    return HttpWorkspaceStore.list<PresencePeer>(payload, "peers");
  }
}
