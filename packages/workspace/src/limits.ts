/**
 * Retention caps, shared by every implementation so the conformance contract
 * can assert the same numbers everywhere.
 *
 * These are *storage* caps, not product limits: localStorage is a ~5MB budget
 * shared with the rest of the app, and an unbounded command log would evict
 * the dashboards it describes. The remote store keeps the same numbers so a
 * workspace behaves identically after a local -> remote switch.
 */

/** Dashboards kept per workspace; the least recently updated is evicted. */
export const MAX_DASHBOARDS = 50;
/** Version snapshots kept per dashboard; the oldest is evicted. */
export const MAX_VERSIONS_PER_DASHBOARD = 20;
/** Completed investigation records kept per workspace; the oldest is evicted. */
export const MAX_INVESTIGATIONS = 50;
/** Command entries retained per dashboard; the oldest are evicted, `seq` keeps counting. */
export const MAX_COMMAND_ENTRIES = 500;
/** A peer is considered gone after this long without a heartbeat (ms). */
export const PRESENCE_TTL_MS = 30_000;
