/**
 * The workspace seam: where dashboards, version snapshots, investigation
 * records, the command stream and presence live.
 *
 * `packages/datasource` is the seam for *query engines*; this package is the
 * seam for *saved state*. Today the only implementation is the browser's
 * localStorage (`LocalWorkspaceStore`). Tomorrow the same interface is served
 * by a Kontier workspace service (`HttpWorkspaceStore`) so a team shares one
 * workspace without the UI knowing which one it talks to.
 *
 * Deliberate constraint: this package must NOT depend on `@kontier-ri/studio`.
 * The dashboard document is opaque (`unknown`) here, so the storage seam never
 * has to be redeployed when the doc schema gains a field.
 */

/** Which workspace the UI is attached to, so the shell can label it. */
export interface WorkspaceIdentity {
  /** Stable id of the workspace; used to namespace caches and log lines. */
  workspaceId: string;
  /** Human-readable name shown in the workspace switcher. */
  label: string;
  /** `local` = this browser only, `remote` = shared, server-backed. */
  kind: "local" | "remote";
}

/**
 * Shared collaboration state for one dashboard. `state` is deliberately
 * opaque: its shape belongs to the studio package and keeps changing, and a
 * server that pinned it would reject next week's proposals.
 */
export interface SessionRecord {
  dashboardId: string;
  state: unknown;
  /** Epoch ms, assigned by the store. */
  updatedAt: number;
}

/** Index row for the dashboard picker: enough to render without loading docs. */
export interface DashboardSummary {
  id: string;
  /** Display name; mirrors `doc.title` at save time. */
  name: string;
  /** Epoch ms of the last save, so the list can sort newest-first. */
  updatedAt: number;
  /** Total tiles across all pages; shown as "12 tiles" in the picker. */
  tileCount: number;
  /** Number of pages; shown so multi-page reports are recognizable. */
  pageCount: number;
}

/** A dashboard with its document. `doc` is opaque: see the file header. */
export interface DashboardRecord {
  id: string;
  name: string;
  updatedAt: number;
  /** The DashboardDoc JSON. Validated by the owner (studio / the server). */
  doc: unknown;
}

/** Index row for the version history panel: no document payload. */
export interface VersionSummary {
  id: string;
  /** Version snapshots are always scoped to one dashboard. */
  dashboardId: string;
  /** Why the snapshot exists, e.g. "Before applying 4 agent changes". */
  label: string;
  /** Epoch ms; version lists are ordered by this, newest first. */
  savedAt: number;
  /** Tiles in the snapshot, so a restore preview needs no document load. */
  tileCount: number;
}

/** A version snapshot with its document payload; what `restore` replays. */
export type VersionRecord = VersionSummary & {
  /** Snapshot of the DashboardDoc at save time. Opaque here. */
  doc: unknown;
};

/** One question the human answered during an investigation. */
export interface InvestigationDecision {
  question: string;
  /** The chosen option's label (not its id) so the record reads on its own. */
  answer: string;
  /** Free-text note the human typed with the answer, when they left one. */
  note?: string;
}

/**
 * A completed investigation: the durable "what did we conclude" record that
 * outlives the live session state it was derived from.
 */
export interface InvestigationRecord {
  /** Session id; re-saving the same id replaces the record (idempotent). */
  id: string;
  /** The brief the session started from. */
  objective: string;
  /** The agent's closing narrative. */
  summary: string;
  /** Findings worth keeping, one line each. */
  outcomes: string[];
  /** Every decision the human made, in the order they were answered. */
  decisions: InvestigationDecision[];
  /** How many proposed changes the human approved. */
  approvedChanges: number;
  /** Dashboard title at completion time; the doc may be renamed later. */
  dashboardTitle: string;
  startedAt: number;
  /** Epoch ms; investigation lists are ordered by this, newest first. */
  completedAt: number;
}

/**
 * One applied command in a dashboard's history — the unit of multiplayer sync.
 *
 * ORDERING GUARANTEE: `seq` is assigned by the store, never by the caller, so
 * command order is a **total order per dashboard**. Two peers that append
 * concurrently get distinct, increasing `seq` values; every peer that replays
 * `fetchCommands` sees the same sequence. `at` is a client clock and may go
 * backwards between peers — never sort on it.
 */
export interface CommandEntry {
  id: string;
  dashboardId: string;
  /** Store-assigned position, strictly increasing from 1 per dashboard. */
  seq: number;
  /** Who caused the change; drives the "agent edited this" affordances. */
  by: "human" | "agent";
  /** Undo-stack label, e.g. `Added bar chart "Revenue by month"`. */
  label: string;
  /** Client epoch ms. Display only — see the ordering guarantee above. */
  at: number;
  /** Client id of the peer that appended it, so a peer skips its own echo. */
  actor: string;
}

/** What a caller supplies to `appendCommands`: no `id`, no `seq` — the store owns both. */
export type CommandInput = Omit<CommandEntry, "id" | "seq">;

/** Result of `appendCommands`: the new high-water mark to poll from. */
export interface CommandAppendResult {
  /** Highest `seq` in the dashboard after the append. Monotonic, never resets. */
  cursor: number;
}

/** Result of `fetchCommands`: newer entries plus the cursor to poll from next. */
export interface CommandPage {
  /** Entries with `seq > sinceSeq`, ascending. May be capped (oldest dropped). */
  entries: CommandEntry[];
  /** Highest `seq` known to the store; pass it as the next `sinceSeq`. */
  cursor: number;
}

/** A peer currently attached to the workspace, as reported by `heartbeat`. */
export interface PresencePeer {
  /** Client id; matches `CommandEntry.actor`. */
  actor: string;
  /** Display name of the peer, e.g. "Zaid" or "Agent". */
  label: string;
  /** Epoch ms of the peer's last heartbeat; the UI fades stale peers. */
  lastSeen: number;
  /** Dashboard the peer is looking at, or `null` when it is elsewhere. */
  dashboardId: string | null;
}

/**
 * The workspace seam. Every method returns a Promise even in the local
 * implementation, so swapping localStorage for a network store is a
 * constructor change and nothing else.
 *
 * Guarantees every implementation must uphold (enforced by
 * `describeWorkspaceStoreContract`):
 * - `listDashboards`, `listVersions`, `listInvestigations` return newest first.
 * - Reads of missing records resolve to `null`; they never throw.
 * - Deletes are idempotent: deleting an unknown id resolves.
 * - `seq` is store-assigned and strictly increasing per dashboard; `cursor` is
 *   monotonic and never decreases, even when old entries are evicted by a cap.
 */
export interface WorkspaceStore {
  /** Which workspace this is, so the shell can say "local" vs "shared". */
  identity(): Promise<WorkspaceIdentity>;

  /** Dashboard picker rows, newest first. */
  listDashboards(): Promise<DashboardSummary[]>;
  /** Full record for one dashboard, or `null` when it does not exist. */
  loadDashboard(id: string): Promise<DashboardRecord | null>;
  /** Create-or-replace; returns the index row the picker should show. */
  saveDashboard(record: DashboardRecord): Promise<DashboardSummary>;
  /** Remove a dashboard and everything scoped to it (versions, commands). */
  deleteDashboard(id: string): Promise<void>;

  /** Snapshot rows for one dashboard, newest first. */
  listVersions(dashboardId: string): Promise<VersionSummary[]>;
  /** Create-or-replace a snapshot; returns the row the history panel shows. */
  saveVersion(record: VersionRecord): Promise<VersionSummary>;
  /** Full snapshot for a restore, or `null` when it does not exist. */
  loadVersion(dashboardId: string, versionId: string): Promise<VersionRecord | null>;
  /** Remove one snapshot; idempotent. */
  deleteVersion(dashboardId: string, versionId: string): Promise<void>;

  /**
   * The collaboration state for one dashboard: work session, plan, decisions,
   * insights and pending change sets, as one opaque blob.
   *
   * It is separate from the document on purpose. A pending agent proposal is
   * not part of the report and must not be undoable with the report, or land
   * in a version snapshot — but a second person cannot review a proposal they
   * cannot see, so it still has to travel. Returns null when nothing has been
   * shared for this dashboard yet.
   */
  readSession(dashboardId: string): Promise<SessionRecord | null>;
  /** Publish this tab's collaboration state; the store stamps updatedAt. */
  writeSession(dashboardId: string, state: unknown): Promise<SessionRecord>;

  /** Completed investigations, newest first. */
  listInvestigations(): Promise<InvestigationRecord[]>;
  /** Create-or-replace by `id`, so a re-render cannot duplicate a record. */
  saveInvestigation(record: InvestigationRecord): Promise<void>;

  /**
   * Append commands to a dashboard's stream. The store assigns `id` and `seq`,
   * which is what makes the order total (see `CommandEntry`).
   */
  appendCommands(dashboardId: string, entries: CommandInput[]): Promise<CommandAppendResult>;
  /** Everything newer than `sinceSeq`; pass `0` for a full replay. */
  fetchCommands(dashboardId: string, sinceSeq: number): Promise<CommandPage>;

  /**
   * Announce this client and get the live peer list back. Called on a timer;
   * the returned list always contains the caller.
   */
  heartbeat(actor: string, label: string, dashboardId: string | null): Promise<PresencePeer[]>;
}
