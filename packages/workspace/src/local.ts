/**
 * `LocalWorkspaceStore` — the default workspace: this browser's localStorage.
 *
 * It is the offline half of the seam, so Kontier RI keeps its promise that your
 * data never leaves the machine unless you connect a workspace. Everything is
 * best-effort: a private-mode browser, a disabled-storage policy or a quota
 * error must degrade to "history is not kept", never to a crash mid-edit —
 * the same rule `apps/web/lib/versions.ts` already follows.
 */

import { summarizeDashboard } from "./doc-shape";
import {
  MAX_COMMAND_ENTRIES,
  MAX_DASHBOARDS,
  MAX_INVESTIGATIONS,
  MAX_VERSIONS_PER_DASHBOARD,
} from "./limits";
import type {
  CommandAppendResult,
  CommandEntry,
  CommandInput,
  CommandPage,
  DashboardRecord,
  DashboardSummary,
  InvestigationRecord,
  PresencePeer,
  SessionRecord,
  VersionRecord,
  VersionSummary,
  WorkspaceIdentity,
  WorkspaceStore,
} from "./types";

/**
 * The slice of the DOM `Storage` API this package uses. Declared separately so
 * tests can inject a fake (and a throwing fake) without a jsdom environment;
 * `window.localStorage` satisfies it structurally.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Namespace for every key this store owns, so it never collides with app keys. */
export const WORKSPACE_KEY_PREFIX = "kontier-ri:ws:";

/** Key for a workspace area (`identity`, `dashboards`, `commands:<id>`, ...). */
export function workspaceKey(area: string): string {
  return `${WORKSPACE_KEY_PREFIX}${area}`;
}

/** Construction options; every field has a working default. */
export interface LocalWorkspaceStoreOptions {
  /** Storage to use. Defaults to `globalThis.localStorage`, or memory if blocked. */
  storage?: KeyValueStorage | null;
  /** Fixed workspace id; defaults to a persisted, generated one. */
  workspaceId?: string;
  /** Label shown in the workspace switcher. */
  label?: string;
  /** Clock seam so tests can produce deterministic timestamps. */
  now?: () => number;
}

/** In-memory stand-in used when the browser refuses storage (private mode). */
class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Reach for `localStorage` without letting a security exception escape. */
function defaultStorage(): KeyValueStorage {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (candidate) {
      // Touch it: Safari private mode only throws on first use, not on access.
      candidate.getItem(workspaceKey("probe"));
      return candidate;
    }
  } catch {
    /* storage blocked: fall through to memory */
  }
  return new MemoryStorage();
}

/** Short, sortable, collision-resistant id (`dash_ln8x1a4f2b`). */
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Persisted shape of one dashboard's command stream. */
interface CommandLog {
  /** Highest `seq` ever assigned; monotonic even after eviction. */
  cursor: number;
  entries: CommandEntry[];
}

export class LocalWorkspaceStore implements WorkspaceStore {
  private readonly storage: KeyValueStorage;
  private readonly now: () => number;
  /** Highest save stamp issued so far; keeps ordering strict. */
  private lastStamp = 0;
  private readonly label: string;
  private readonly fixedWorkspaceId: string | undefined;
  /** Used when storage is unwritable, so identity() is still stable per tab. */
  private readonly fallbackWorkspaceId = genId("ws");

  constructor(options: LocalWorkspaceStoreOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.now = options.now ?? (() => Date.now());
    this.label = options.label ?? "This browser";
    this.fixedWorkspaceId = options.workspaceId;
  }

  // -- storage primitives --------------------------------------------------

  /** Read + parse a key; a corrupt or unreadable value yields `fallback`. */
  private read<T>(area: string, fallback: T): T {
    try {
      const raw = this.storage.getItem(workspaceKey(area));
      if (raw === null) return fallback;
      const parsed: unknown = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : (parsed as T);
    } catch {
      return fallback;
    }
  }

  /** Write a key; returns false when storage refused (quota / private mode). */
  private write(area: string, value: unknown): boolean {
    try {
      this.storage.setItem(workspaceKey(area), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  private remove(area: string): void {
    try {
      this.storage.removeItem(workspaceKey(area));
    } catch {
      /* nothing to do: the record is already unreachable */
    }
  }

  /** Read an array key, tolerating a non-array value written by an old build. */
  private readList<T>(area: string): T[] {
    const value = this.read<unknown>(area, []);
    return Array.isArray(value) ? (value as T[]) : [];
  }

  // -- identity ------------------------------------------------------------

  async identity(): Promise<WorkspaceIdentity> {
    if (this.fixedWorkspaceId) {
      return { workspaceId: this.fixedWorkspaceId, label: this.label, kind: "local" };
    }
    const stored = this.read<{ workspaceId?: unknown }>("identity", {});
    const existing = typeof stored.workspaceId === "string" ? stored.workspaceId : null;
    if (existing) return { workspaceId: existing, label: this.label, kind: "local" };
    const workspaceId = this.fallbackWorkspaceId;
    this.write("identity", { workspaceId });
    return { workspaceId, label: this.label, kind: "local" };
  }

  // -- dashboards ----------------------------------------------------------

  async listDashboards(): Promise<DashboardSummary[]> {
    return this.readIndex();
  }

  async loadDashboard(id: string): Promise<DashboardRecord | null> {
    const record = this.read<DashboardRecord | null>(`dashboard:${id}`, null);
    return record && typeof record === "object" && record.id === id ? record : null;
  }

  async saveDashboard(record: DashboardRecord): Promise<DashboardSummary> {
    // The store stamps the save time, matching the server contract: whoever
    // holds the data decides what "newest" means, not the caller's clock.
    // Monotonic: a clock that does not move (a frozen test clock, or two
    // saves inside the same millisecond) must still produce a definite
    // order, or "newest first" silently becomes "insertion order".
    this.lastStamp = Math.max(this.now(), this.lastStamp + 1);
    const stamped: DashboardRecord = { ...record, updatedAt: this.lastStamp };
    const summary = summarizeDashboard(stamped);
    this.write(`dashboard:${stamped.id}`, stamped);
    const index = this.readIndex().filter((entry) => entry.id !== stamped.id);
    index.push(summary);
    this.writeIndex(index);
    return summary;
  }

  async deleteDashboard(id: string): Promise<void> {
    this.dropDashboard(id);
    this.writeIndex(this.readIndex().filter((entry) => entry.id !== id));
  }

  /** Dashboard index, newest first, with unreadable rows filtered out. */
  private readIndex(): DashboardSummary[] {
    return this.readList<DashboardSummary>("dashboards")
      .filter((entry) => entry !== null && typeof entry === "object" && typeof entry.id === "string")
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Persist the index newest-first and evict past the cap (oldest first). */
  private writeIndex(index: DashboardSummary[]): void {
    const sorted = index.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    for (const evicted of sorted.slice(MAX_DASHBOARDS)) this.dropDashboard(evicted.id);
    this.write("dashboards", sorted.slice(0, MAX_DASHBOARDS));
  }

  /** Remove a dashboard's doc and everything scoped to it. */
  private dropDashboard(id: string): void {
    this.remove(`dashboard:${id}`);
    this.remove(`versions:${id}`);
    this.remove(`commands:${id}`);
  }

  // -- versions ------------------------------------------------------------

  async listVersions(dashboardId: string): Promise<VersionSummary[]> {
    return this.readVersions(dashboardId).map(({ doc: _doc, ...summary }) => summary);
  }

  async saveVersion(record: VersionRecord): Promise<VersionSummary> {
    const kept = this.readVersions(record.dashboardId).filter((v) => v.id !== record.id);
    kept.push(record);
    kept.sort((a, b) => b.savedAt - a.savedAt);
    this.write(`versions:${record.dashboardId}`, kept.slice(0, MAX_VERSIONS_PER_DASHBOARD));
    const { doc: _doc, ...summary } = record;
    return summary;
  }

  async loadVersion(dashboardId: string, versionId: string): Promise<VersionRecord | null> {
    return this.readVersions(dashboardId).find((v) => v.id === versionId) ?? null;
  }

  async deleteVersion(dashboardId: string, versionId: string): Promise<void> {
    const kept = this.readVersions(dashboardId).filter((v) => v.id !== versionId);
    this.write(`versions:${dashboardId}`, kept);
  }

  /** Snapshots for one dashboard, newest first. */
  private readVersions(dashboardId: string): VersionRecord[] {
    return this.readList<VersionRecord>(`versions:${dashboardId}`)
      .filter((v) => v !== null && typeof v === "object" && typeof v.id === "string")
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  // -- investigations ------------------------------------------------------

  // -- collaboration session ------------------------------------------------

  async readSession(dashboardId: string): Promise<SessionRecord | null> {
    const stored = this.read<SessionRecord | null>(`session:${dashboardId}`, null);
    if (!stored || typeof stored !== "object") return null;
    return stored;
  }

  async writeSession(dashboardId: string, state: unknown): Promise<SessionRecord> {
    this.lastStamp = Math.max(this.now(), this.lastStamp + 1);
    const record: SessionRecord = {
      dashboardId,
      state,
      updatedAt: this.lastStamp,
    };
    this.write(`session:${dashboardId}`, record);
    return record;
  }

  async listInvestigations(): Promise<InvestigationRecord[]> {
    return this.readInvestigations();
  }

  async saveInvestigation(record: InvestigationRecord): Promise<void> {
    const kept = this.readInvestigations().filter((item) => item.id !== record.id);
    kept.push(record);
    kept.sort((a, b) => b.completedAt - a.completedAt);
    this.write("investigations", kept.slice(0, MAX_INVESTIGATIONS));
  }

  /** Completed investigations, newest first. */
  private readInvestigations(): InvestigationRecord[] {
    return this.readList<InvestigationRecord>("investigations")
      .filter((r) => r !== null && typeof r === "object" && typeof r.id === "string")
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  // -- command stream ------------------------------------------------------

  async appendCommands(dashboardId: string, entries: CommandInput[]): Promise<CommandAppendResult> {
    const log = this.readCommandLog(dashboardId);
    const durableCursor = log.cursor;
    let cursor = durableCursor;
    for (const input of entries) {
      cursor += 1;
      log.entries.push({ ...input, dashboardId, id: genId("cmd"), seq: cursor });
    }
    log.cursor = cursor;
    // Evict oldest entries only; `cursor` keeps counting so peers never rewind.
    log.entries = log.entries.slice(-MAX_COMMAND_ENTRIES);
    // If storage refused the write the append did not happen, so report the
    // cursor that IS durable: a caller must never poll from a seq that was
    // never stored, or it would skip the entries a later append reuses.
    return { cursor: this.write(`commands:${dashboardId}`, log) ? cursor : durableCursor };
  }

  async fetchCommands(dashboardId: string, sinceSeq: number): Promise<CommandPage> {
    const log = this.readCommandLog(dashboardId);
    return {
      entries: log.entries.filter((entry) => entry.seq > sinceSeq),
      cursor: log.cursor,
    };
  }

  /** One dashboard's stream, repaired if the stored value is corrupt. */
  private readCommandLog(dashboardId: string): CommandLog {
    const empty: CommandLog = { cursor: 0, entries: [] };
    const raw = this.read<Partial<CommandLog> | null>(`commands:${dashboardId}`, null);
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) return empty;
    const entries = raw.entries
      .filter((entry): entry is CommandEntry => entry !== null && typeof entry === "object" && typeof entry.seq === "number")
      .sort((a, b) => a.seq - b.seq);
    const highest = entries.length > 0 ? (entries[entries.length - 1] as CommandEntry).seq : 0;
    const cursor = typeof raw.cursor === "number" ? Math.max(raw.cursor, highest) : highest;
    return { cursor, entries };
  }

  // -- presence ------------------------------------------------------------

  /**
   * A local workspace has exactly one peer: you. The method still exists so the
   * presence UI has no local/remote branch — it just renders a list of one.
   */
  async heartbeat(actor: string, label: string, dashboardId: string | null): Promise<PresencePeer[]> {
    const self: PresencePeer = { actor, label, lastSeen: this.now(), dashboardId };
    this.write("presence", [self]);
    return [self];
  }
}
