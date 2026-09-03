/**
 * WHAT: Bearer-token auth for the optional workspace API. Resolves an HTTP
 * request to exactly one workspace, or to a precise refusal.
 *
 * WHY: The workspace API is a shared-server add-on to a local-first product,
 * so its access model has to be simple enough to reason about in one sitting:
 * a static token table in the environment, one token = one workspace, no
 * sessions, no cookies, no user database. Because a token maps to a single
 * workspace id, the route layer can never be handed a workspace it did not
 * authenticate for (see workspace-store.openWorkspace).
 *
 * KONTIER_WORKSPACE_TOKENS is a comma-separated list of
 * `token:workspaceId:label`. When it is unset the API is *not configured* and
 * every route answers 503 — the local-only deploy then degrades honestly
 * instead of pretending to be a server.
 *
 * Tokens are secrets: they are never logged, never echoed in a response, and
 * compared with a constant-time digest comparison.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** The authenticated caller: one token, one workspace. */
export interface WorkspacePrincipal {
  /** Every store call is scoped by this id. */
  workspaceId: string;
  /** Human-readable name of the token holder, safe to show and to log. */
  label: string;
}

export type AuthFailureReason = "not_configured" | "unauthorized";

export type AuthResult =
  | { ok: true; principal: WorkspacePrincipal }
  | { ok: false; reason: AuthFailureReason; status: 503 | 401; message: string };

interface TokenEntry {
  /** sha256 of the token; the token itself is not retained. */
  digest: Buffer;
  workspaceId: string;
  label: string;
}

const NOT_CONFIGURED_MESSAGE =
  "The Kontier RI workspace service is not configured on this deployment. " +
  "Set KONTIER_WORKSPACE_TOKENS to enable it; dashboards stay in this browser until then.";

const UNAUTHORIZED_MESSAGE =
  "Missing or unknown workspace token. Send `Authorization: Bearer <token>`.";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Parse `token:workspaceId:label` entries. Malformed entries are dropped
 * rather than crashing the server, and nothing about them is logged (an entry
 * contains a secret). A duplicated token keeps its first mapping so a typo in
 * a later entry cannot silently hand a workspace to someone else.
 */
function parseTable(raw: string): TokenEntry[] {
  const entries: TokenEntry[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split(",")) {
    const parts = chunk.split(":");
    const token = parts[0]?.trim() ?? "";
    const workspaceId = parts[1]?.trim() ?? "";
    // Labels may contain ":" (e.g. "team:eu"); everything after the second
    // separator is the label.
    const label = parts.slice(2).join(":").trim();
    if (token.length === 0 || workspaceId.length === 0) continue;
    const key = sha256(token).toString("hex");
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      digest: sha256(token),
      workspaceId,
      label: label.length > 0 ? label : workspaceId,
    });
  }
  return entries;
}

/**
 * Cache keyed by the raw env value: parsing is cheap but constant, and tests
 * (and a server restart with a new table) must see changes immediately.
 */
let cache: { raw: string; entries: TokenEntry[] } | null = null;

function tokenTable(): TokenEntry[] | null {
  const raw = process.env.KONTIER_WORKSPACE_TOKENS;
  if (raw === undefined || raw.trim().length === 0) return null;
  if (cache?.raw === raw) return cache.entries;
  const entries = parseTable(raw);
  cache = { raw, entries };
  return entries;
}

/** True when this deployment runs the workspace API at all. */
export function isWorkspaceApiConfigured(): boolean {
  const table = tokenTable();
  return table !== null && table.length > 0;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

function matches(entry: TokenEntry, digest: Buffer): boolean {
  // Equal-length sha256 digests, so timingSafeEqual never throws.
  return timingSafeEqual(entry.digest, digest);
}

/**
 * Resolve a request to a single workspace.
 * - table missing/empty -> 503 not_configured
 * - no/unknown bearer token -> 401 unauthorized
 */
export function authenticate(request: Request): AuthResult {
  const table = tokenTable();
  if (table === null || table.length === 0) {
    return {
      ok: false,
      reason: "not_configured",
      status: 503,
      message: NOT_CONFIGURED_MESSAGE,
    };
  }
  const token = bearerToken(request);
  if (token === null) {
    return { ok: false, reason: "unauthorized", status: 401, message: UNAUTHORIZED_MESSAGE };
  }
  const digest = sha256(token);
  // Constant-time comparison against every entry (the table is tiny), so the
  // response time does not reveal which prefix of a guess was correct.
  let found: TokenEntry | null = null;
  for (const entry of table) {
    if (matches(entry, digest)) found = entry;
  }
  if (found === null) {
    return { ok: false, reason: "unauthorized", status: 401, message: UNAUTHORIZED_MESSAGE };
  }
  return { ok: true, principal: { workspaceId: found.workspaceId, label: found.label } };
}

/** Test helper: drop the parsed-table cache. */
export function __resetTokenCache(): void {
  cache = null;
}
