/**
 * Public surface of `@kontier-ri/workspace`: the storage seam for dashboards,
 * version snapshots, investigation records, the command stream and presence.
 */

export type {
  CommandAppendResult,
  CommandEntry,
  CommandInput,
  CommandPage,
  DashboardRecord,
  DashboardSummary,
  InvestigationDecision,
  InvestigationRecord,
  PresencePeer,
  VersionRecord,
  VersionSummary,
  WorkspaceIdentity,
  WorkspaceStore,
} from "./types";

export {
  MAX_COMMAND_ENTRIES,
  MAX_DASHBOARDS,
  MAX_INVESTIGATIONS,
  MAX_VERSIONS_PER_DASHBOARD,
  PRESENCE_TTL_MS,
} from "./limits";

export { countDoc, summarizeDashboard } from "./doc-shape";
export type { DocCounts } from "./doc-shape";

export { WorkspaceError, isRetryableWorkspaceError } from "./errors";

export { LocalWorkspaceStore, WORKSPACE_KEY_PREFIX, workspaceKey } from "./local";
export type { KeyValueStorage, LocalWorkspaceStoreOptions } from "./local";

export { HttpWorkspaceStore } from "./http";
export type { FetchLike, HttpWorkspaceStoreOptions } from "./http";

// NOTE: ./conformance is deliberately NOT re-exported here. It imports
// `vitest`, so anything that re-exports it drags the test runner into every
// consumer's bundle — which is exactly what happened: importing this package
// from the web app made the dev server answer 500 with "Vitest failed to
// access its internal state". Tests import ../src/conformance directly.
