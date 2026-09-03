/**
 * WHAT: The server-side workspace store for Kontier RI — a file-backed,
 * workspace-scoped home for dashboards, version snapshots, the per-dashboard
 * command log, investigation records and presence.
 *
 * WHY: Kontier RI is local-first. The browser owns the truth in the static
 * (GitHub Pages) deploy, so this store only exists for the *optional* server
 * deploy where several people or agents share one workspace. It therefore has
 * to be boring and dependency-free: `node:fs/promises` only (no native
 * modules, so `next build` and the export stay portable), one JSON file per
 * workspace, atomic writes (temp file + rename) so a crash can never leave a
 * half-written workspace, and an in-process promise chain per workspace so two
 * concurrent requests can never interleave a read-modify-write.
 *
 * ISOLATION: the only way to reach data is `openWorkspace(workspaceId)`, which
 * returns a handle whose methods take NO workspace argument. A route holding
 * workspace A's handle cannot address workspace B even by mistake — the
 * isolation the product promises is a property of this API, not of a filter in
 * a route handler.
 *
 * The dashboard document itself is stored as opaque JSON. The document schema
 * lives in the client packages and keeps evolving (tiles[] -> pages[]); the
 * server must never be the reason an old or new document shape stops loading.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Public shapes (the wire contract shared with packages/workspace)
// ---------------------------------------------------------------------------

/** A dashboard document, kept opaque on purpose (see file header). */
export type WorkspaceDoc = Record<string, unknown>;

export interface DashboardSummary {
  id: string;
  name: string;
  /** epoch ms of the last write */
  updatedAt: number;
  tileCount: number;
}

export interface DashboardRecord extends DashboardSummary {
  doc: WorkspaceDoc;
}

export interface VersionSummary {
  id: string;
  label: string;
  /** epoch ms */
  savedAt: number;
  tileCount: number;
}

export interface VersionRecord extends VersionSummary {
  doc: WorkspaceDoc;
}

/** One entry of the per-dashboard command log. `seq` is assigned here. */
export interface CommandEntry {
  /** Server-assigned total order. Starts at 1, never reused, never reset. */
  seq: number;
  /** Who caused the change ("human" | "agent" | any client label). */
  by: string;
  label: string;
  /** Client clock, epoch ms — kept for display only; `seq` is the order. */
  at: number;
  actor: string;
}

export type CommandInput = Omit<CommandEntry, "seq">;

export interface PresencePeer {
  actor: string;
  label: string;
  dashboardId: string | null;
  /** epoch ms of the last presence ping */
  lastSeenAt: number;
}

export interface InvestigationDecision {
  question: string;
  answer: string;
  note?: string;
}

/** Mirrors lib/investigations.tsx so a record round-trips unchanged. */
export interface InvestigationRecord {
  id: string;
  objective: string;
  summary: string;
  outcomes: string[];
  decisions: InvestigationDecision[];
  approvedChanges: number;
  dashboardTitle: string;
  startedAt: number;
  completedAt: number;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Command log cap; the oldest entries are evicted, `seq` keeps counting. */
export const MAX_COMMAND_ENTRIES = 1000;
/** Presence entries older than this are dropped on the next write. */
export const PRESENCE_TTL_MS = 30_000;
/** Bounds the workspace file; the browser keeps a shorter local history. */
export const MAX_VERSIONS_PER_DASHBOARD = 200;
export const MAX_INVESTIGATIONS = 200;

// ---------------------------------------------------------------------------
// On-disk shape
// ---------------------------------------------------------------------------

interface DashboardFileEntry {
  id: string;
  name: string;
  updatedAt: number;
  doc: WorkspaceDoc;
}

interface CommandLog {
  /** Highest `seq` ever assigned — kept across eviction, so order is total. */
  nextSeq: number;
  entries: CommandEntry[];
}

interface WorkspaceFile {
  version: 1;
  /** dashboard id -> dashboard */
  dashboards: Record<string, DashboardFileEntry>;
  /** dashboard id -> versions, oldest first */
  versions: Record<string, VersionRecord[]>;
  /** dashboard id -> command log */
  commands: Record<string, CommandLog>;
  /** oldest first */
  investigations: InvestigationRecord[];
  presence: PresencePeer[];
  /**
   * dashboard id -> shared collaboration state (work session, plan,
   * decisions, pending change sets). Opaque here on purpose: its shape is
   * the studio package's business and keeps changing.
   */
  sessions: Record<string, { state: unknown; updatedAt: number }>;
}

function emptyFile(): WorkspaceFile {
  return {
    version: 1,
    dashboards: {},
    versions: {},
    commands: {},
    investigations: [],
    presence: [],
    sessions: {},
  };
}

// ---------------------------------------------------------------------------
// Location on disk
// ---------------------------------------------------------------------------

/**
 * Data directory, read on every call so tests (and a restarted server) can
 * point KONTIER_WORKSPACE_DIR somewhere else without reloading this module.
 */
export function workspaceDataDir(): string {
  const configured = process.env.KONTIER_WORKSPACE_DIR?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : ".data/workspace");
}

/**
 * One file per workspace. The id is slugged so a hostile token table can
 * never escape the data directory ("../../etc/passwd" becomes a flat name).
 */
export function workspaceFilePath(workspaceId: string): string {
  return path.join(workspaceDataDir(), `${safeFileStem(workspaceId)}.json`);
}

function safeFileStem(workspaceId: string): string {
  const slug = workspaceId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96);
  return slug.length > 0 ? slug : "_";
}

// ---------------------------------------------------------------------------
// Read / atomic write
// ---------------------------------------------------------------------------

async function readFile(workspaceId: string): Promise<WorkspaceFile> {
  let raw: string;
  try {
    raw = await fs.readFile(workspaceFilePath(workspaceId), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return emptyFile();
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeFile(parsed);
  } catch {
    // A corrupt file must not take the API down. Atomic writes make this
    // near-impossible, so treat it as "nothing stored yet" and move on.
    return emptyFile();
  }
}

/**
 * Write the workspace file atomically: a uniquely named temp file in the same
 * directory, flushed, then renamed over the target. Readers therefore only
 * ever see a complete file, and a concurrent process cannot see a torn write.
 */
async function writeFileAtomic(workspaceId: string, file: WorkspaceFile): Promise<void> {
  const target = workspaceFilePath(workspaceId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  const body = JSON.stringify(file);
  const handle = await fs.open(tmp, "wx");
  try {
    await handle.writeFile(body, "utf8");
    try {
      await handle.sync();
    } catch {
      // Some file systems refuse fsync; the rename below is still atomic.
    }
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

// ---------------------------------------------------------------------------
// Defensive normalization of whatever is on disk
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFile(parsed: unknown): WorkspaceFile {
  if (!isRecord(parsed)) return emptyFile();
  const base = emptyFile();
  return {
    version: 1,
    dashboards: isRecord(parsed.dashboards)
      ? (parsed.dashboards as Record<string, DashboardFileEntry>)
      : base.dashboards,
    versions: isRecord(parsed.versions)
      ? (parsed.versions as Record<string, VersionRecord[]>)
      : base.versions,
    commands: isRecord(parsed.commands)
      ? (parsed.commands as Record<string, CommandLog>)
      : base.commands,
    investigations: Array.isArray(parsed.investigations)
      ? (parsed.investigations as InvestigationRecord[])
      : base.investigations,
    presence: Array.isArray(parsed.presence)
      ? (parsed.presence as PresencePeer[])
      : base.presence,
    // Any field added to WorkspaceFile MUST be listed here. This function
    // rebuilds the file from an allow-list, so an unlisted field is written
    // successfully and then silently dropped by the very next read.
    sessions: isRecord(parsed.sessions)
      ? (parsed.sessions as Record<string, { state: unknown; updatedAt: number }>)
      : base.sessions,
  };
}

// ---------------------------------------------------------------------------
// Per-workspace serialization
// ---------------------------------------------------------------------------

/**
 * One promise chain per workspace file. Every read-modify-write runs inside
 * the chain, so two requests to the same workspace are applied one after the
 * other instead of clobbering each other's snapshot. Cross-process safety is
 * out of scope by design (one server per data directory).
 */
const chains = new Map<string, Promise<unknown>>();

function withLock<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
  const key = workspaceFilePath(workspaceId);
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  // Keep the chain alive but never let a rejection poison the next caller.
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Read inside the lock: callers never observe a half-applied mutation. */
function read<T>(workspaceId: string, project: (file: WorkspaceFile) => T): Promise<T> {
  return withLock(workspaceId, async () => project(await readFile(workspaceId)));
}

/** Read-modify-write inside the lock, with one atomic write at the end. */
function mutate<T>(
  workspaceId: string,
  apply: (file: WorkspaceFile) => T,
): Promise<T> {
  return withLock(workspaceId, async () => {
    const file = await readFile(workspaceId);
    const result = apply(file);
    prunePresence(file);
    await writeFileAtomic(workspaceId, file);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Tile count for the summary rows. Reads the current `pages[].tiles[]` shape
 * and the historical flat `tiles[]` shape, and never throws on either.
 */
export function countTiles(doc: WorkspaceDoc): number {
  const pages = doc.pages;
  if (Array.isArray(pages)) {
    return pages.reduce<number>((total, page) => {
      if (!isRecord(page)) return total;
      const tiles = page.tiles;
      return total + (Array.isArray(tiles) ? tiles.length : 0);
    }, 0);
  }
  const tiles = doc.tiles;
  return Array.isArray(tiles) ? tiles.length : 0;
}

function toSummary(entry: DashboardFileEntry): DashboardSummary {
  return {
    id: entry.id,
    name: entry.name,
    updatedAt: entry.updatedAt,
    tileCount: countTiles(entry.doc),
  };
}

function versionSummary(version: VersionRecord): VersionSummary {
  return {
    id: version.id,
    label: version.label,
    savedAt: version.savedAt,
    tileCount: version.tileCount,
  };
}

function prunePresence(file: WorkspaceFile): void {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  file.presence = file.presence.filter((peer) => peer.lastSeenAt > cutoff);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// The workspace handle
// ---------------------------------------------------------------------------

export interface WorkspaceStore {
  readonly workspaceId: string;

  listDashboards(): Promise<DashboardSummary[]>;
  readDashboard(id: string): Promise<DashboardRecord | null>;
  /** Upsert. `created` is true when this call added the dashboard (HTTP 201). */
  writeDashboard(
    id: string,
    input: { name: string; doc: WorkspaceDoc },
  ): Promise<{ dashboard: DashboardSummary; created: boolean }>;
  /** false when the dashboard did not exist (HTTP 404). */
  deleteDashboard(id: string): Promise<boolean>;

  /** Newest first. */
  listVersions(dashboardId: string): Promise<VersionSummary[] | null>;
  /** null when the dashboard does not exist. */
  createVersion(
    dashboardId: string,
    input: { label: string; doc: WorkspaceDoc },
  ): Promise<VersionSummary | null>;
  readVersion(dashboardId: string, versionId: string): Promise<VersionRecord | null>;
  deleteVersion(dashboardId: string, versionId: string): Promise<boolean>;

  /** Newest first. */
  listInvestigations(): Promise<InvestigationRecord[]>;
  saveInvestigation(record: InvestigationRecord): Promise<void>;

  /** Shared collaboration state for one dashboard, or null when unshared. */
  readSession(
    dashboardId: string,
  ): Promise<{ dashboardId: string; state: unknown; updatedAt: number } | null>;
  /** Replaces the state wholesale and stamps updatedAt. */
  writeSession(
    dashboardId: string,
    state: unknown,
  ): Promise<{ dashboardId: string; state: unknown; updatedAt: number }>;

  /** Appends in the given order and returns the new cursor (last `seq`). */
  appendCommands(dashboardId: string, entries: CommandInput[]): Promise<number>;
  readCommands(
    dashboardId: string,
    since: number,
  ): Promise<{ entries: CommandEntry[]; cursor: number }>;

  /** Upserts the caller's presence and returns every live peer. */
  touchPresence(input: {
    actor: string;
    label: string;
    dashboardId: string | null;
  }): Promise<PresencePeer[]>;
}

/**
 * The ONLY entry point into stored data. Everything below this line is scoped
 * to `workspaceId`; no method accepts another workspace id, so a caller that
 * holds one handle cannot read or write another workspace.
 */
export function openWorkspace(workspaceId: string): WorkspaceStore {
  const id = workspaceId.trim();
  if (id.length === 0) throw new Error("openWorkspace: workspaceId is required");

  return {
    workspaceId: id,

    listDashboards() {
      return read(id, (file) =>
        Object.values(file.dashboards)
          .map(toSummary)
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    },

    readDashboard(dashboardId) {
      return read(id, (file) => {
        const entry = file.dashboards[dashboardId];
        if (!entry) return null;
        return { ...toSummary(entry), doc: entry.doc };
      });
    },

    writeDashboard(dashboardId, input) {
      return mutate(id, (file) => {
        const created = file.dashboards[dashboardId] === undefined;
        const entry: DashboardFileEntry = {
          id: dashboardId,
          name: input.name,
          updatedAt: Date.now(),
          doc: input.doc,
        };
        file.dashboards[dashboardId] = entry;
        return { dashboard: toSummary(entry), created };
      });
    },

    deleteDashboard(dashboardId) {
      return mutate(id, (file) => {
        if (file.dashboards[dashboardId] === undefined) return false;
        delete file.dashboards[dashboardId];
        delete file.versions[dashboardId];
        delete file.commands[dashboardId];
        return true;
      });
    },

    listVersions(dashboardId) {
      return read(id, (file) => {
        if (file.dashboards[dashboardId] === undefined) return null;
        const versions = file.versions[dashboardId] ?? [];
        return versions.map(versionSummary).reverse();
      });
    },

    createVersion(dashboardId, input) {
      return mutate(id, (file) => {
        if (file.dashboards[dashboardId] === undefined) return null;
        const version: VersionRecord = {
          id: newId("ver"),
          label: input.label,
          savedAt: Date.now(),
          tileCount: countTiles(input.doc),
          doc: input.doc,
        };
        const versions = file.versions[dashboardId] ?? [];
        versions.push(version);
        file.versions[dashboardId] = versions.slice(-MAX_VERSIONS_PER_DASHBOARD);
        return versionSummary(version);
      });
    },

    readVersion(dashboardId, versionId) {
      return read(
        id,
        (file) =>
          (file.versions[dashboardId] ?? []).find((version) => version.id === versionId) ??
          null,
      );
    },

    deleteVersion(dashboardId, versionId) {
      return mutate(id, (file) => {
        const versions = file.versions[dashboardId] ?? [];
        const next = versions.filter((version) => version.id !== versionId);
        if (next.length === versions.length) return false;
        file.versions[dashboardId] = next;
        return true;
      });
    },

    readSession(dashboardId) {
      return read(id, (file) => {
        const stored = file.sessions[dashboardId];
        return stored
          ? { dashboardId, state: stored.state, updatedAt: stored.updatedAt }
          : null;
      });
    },

    writeSession(dashboardId, state) {
      return mutate(id, (file) => {
        const sessions = file.sessions;
        // Replace, never merge: an approved-and-cleared proposal must not
        // come back from the dead because an older tab still had it.
        const record = { state, updatedAt: Date.now() };
        file.sessions = { ...sessions, [dashboardId]: record };
        return { dashboardId, state, updatedAt: record.updatedAt };
      });
    },

    listInvestigations() {
      return read(id, (file) => file.investigations.slice().reverse());
    },

    async saveInvestigation(record) {
      await mutate(id, (file) => {
        // Re-sending a record replaces it: the recorder is at-least-once.
        const others = file.investigations.filter((item) => item.id !== record.id);
        others.push(record);
        file.investigations = others.slice(-MAX_INVESTIGATIONS);
      });
    },

    appendCommands(dashboardId, entries) {
      return mutate(id, (file) => {
        const log = file.commands[dashboardId] ?? { nextSeq: 1, entries: [] };
        for (const entry of entries) {
          log.entries.push({ ...entry, seq: log.nextSeq });
          log.nextSeq += 1;
        }
        // Cap the log, evicting the oldest. `nextSeq` deliberately keeps
        // counting so `seq` stays a total order across evictions.
        if (log.entries.length > MAX_COMMAND_ENTRIES) {
          log.entries = log.entries.slice(-MAX_COMMAND_ENTRIES);
        }
        file.commands[dashboardId] = log;
        return log.nextSeq - 1;
      });
    },

    readCommands(dashboardId, since) {
      return read(id, (file) => {
        const log = file.commands[dashboardId] ?? { nextSeq: 1, entries: [] };
        return {
          entries: log.entries.filter((entry) => entry.seq > since),
          cursor: log.nextSeq - 1,
        };
      });
    },

    touchPresence(input) {
      return mutate(id, (file) => {
        const now = Date.now();
        const peer: PresencePeer = {
          actor: input.actor,
          label: input.label,
          dashboardId: input.dashboardId,
          lastSeenAt: now,
        };
        const cutoff = now - PRESENCE_TTL_MS;
        file.presence = [
          ...file.presence.filter(
            (other) => other.actor !== peer.actor && other.lastSeenAt > cutoff,
          ),
          peer,
        ];
        // Includes the caller, so a client can render the whole roster and
        // decide for itself whether to hide "me".
        return file.presence.slice().sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      });
    },
  };
}

/** Test helper: forget the in-process locks (never needed in production). */
export function __resetWorkspaceLocks(): void {
  chains.clear();
}
