/**
 * WHAT: guest workspaces — a workspace anyone can create from the sign-in
 * screen, with no account, whose invite link is the credential.
 *
 * WHY: the product's whole claim is that several humans and several agents
 * work one live report together. A visitor who has to register first never
 * sees that. So a guest presses one button, gets a workspace and a link, and
 * anyone holding the link is in the same workspace. This is the "anyone with
 * the link" capability pattern, not an account system.
 *
 * The token is a 256-bit random string. Only its sha256 digest is stored, so
 * a stolen registry file cannot be replayed as a set of live credentials. The
 * plaintext is returned exactly once, at creation, and never again — losing
 * the link means losing the workspace, which is the honest consequence of
 * having no account to recover it with.
 *
 * Guest workspaces are capped and expire, because this file is writable by
 * unauthenticated callers and must not become an unbounded disk allocation.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { workspaceDataDir } from "./workspace-store";

/** Beyond this, creation is refused until entries expire. */
export const MAX_GUEST_WORKSPACES = 500;
/** A guest workspace outlives a judging window and not much more. */
export const GUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Creations allowed per rolling window, per process. */
export const GUEST_CREATE_LIMIT = 30;
export const GUEST_CREATE_WINDOW_MS = 60 * 60 * 1000;

interface GuestEntry {
  /** sha256 of the token, hex. The token itself is never stored. */
  digest: string;
  workspaceId: string;
  label: string;
  createdAt: number;
}

interface GuestFile {
  version: 1;
  guests: GuestEntry[];
}

export interface CreatedGuest {
  workspaceId: string;
  /** Plaintext, returned once. */
  token: string;
  label: string;
}

function registryPath(): string {
  return path.join(workspaceDataDir(), "guests.json");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readRegistry(): GuestFile {
  try {
    const raw = fs.readFileSync(registryPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as GuestFile).guests)
    ) {
      return { version: 1, guests: (parsed as GuestFile).guests };
    }
  } catch {
    /* missing or corrupt: an empty registry is the safe reading */
  }
  return { version: 1, guests: [] };
}

function writeRegistry(file: GuestFile): void {
  const dir = workspaceDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = registryPath();
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(file), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function live(guests: GuestEntry[], now: number): GuestEntry[] {
  return guests.filter((entry) => now - entry.createdAt < GUEST_TTL_MS);
}

/**
 * Guest mode needs somewhere to write. It does NOT need
 * KONTIER_WORKSPACE_TOKENS: a deployment can serve guests only, which is
 * exactly the public demo.
 */
export function areGuestWorkspacesEnabled(): boolean {
  return process.env.KONTIER_WORKSPACE_GUESTS?.trim().toLowerCase() !== "off";
}

// Per-process creation budget. Deliberately not per-IP: behind a proxy the
// client address is whatever the proxy says, and a shared budget cannot be
// bypassed by rotating a header.
let window = { startedAt: 0, count: 0 };

export function guestCreationAllowed(now = Date.now()): boolean {
  if (now - window.startedAt >= GUEST_CREATE_WINDOW_MS) return true;
  return window.count < GUEST_CREATE_LIMIT;
}

function recordCreation(now: number): void {
  if (now - window.startedAt >= GUEST_CREATE_WINDOW_MS) {
    window = { startedAt: now, count: 1 };
    return;
  }
  window.count += 1;
}

export type CreateGuestResult =
  | { ok: true; guest: CreatedGuest }
  | { ok: false; reason: "disabled" | "rate_limited" | "at_capacity" };

/**
 * Create a guest workspace and return its one-time token.
 *
 * The workspace id is random too. A predictable id would let someone probe
 * for other people's workspaces even without their token, and the id appears
 * in presence payloads.
 */
export function createGuestWorkspace(
  label: string,
  now = Date.now(),
): CreateGuestResult {
  if (!areGuestWorkspacesEnabled()) return { ok: false, reason: "disabled" };
  if (!guestCreationAllowed(now)) return { ok: false, reason: "rate_limited" };

  const file = readRegistry();
  const kept = live(file.guests, now);
  if (kept.length >= MAX_GUEST_WORKSPACES) {
    // Prune first, then refuse only if still full.
    if (kept.length >= MAX_GUEST_WORKSPACES) {
      writeRegistry({ version: 1, guests: kept });
      return { ok: false, reason: "at_capacity" };
    }
  }

  const token = `gst_${randomBytes(32).toString("base64url")}`;
  const workspaceId = `guest_${randomBytes(9).toString("base64url")}`;
  const trimmed = label.trim();
  const entry: GuestEntry = {
    digest: sha256Hex(token),
    workspaceId,
    label: trimmed.length > 0 ? trimmed.slice(0, 120) : "Guest workspace",
    createdAt: now,
  };
  writeRegistry({ version: 1, guests: [...kept, entry] });
  recordCreation(now);
  return {
    ok: true,
    guest: { workspaceId, token, label: entry.label },
  };
}

/** Resolve a bearer token to a guest workspace, or null. */
export function findGuestWorkspace(
  token: string,
  now = Date.now(),
): { workspaceId: string; label: string } | null {
  if (!areGuestWorkspacesEnabled()) return null;
  const digest = Buffer.from(sha256Hex(token), "hex");
  let found: GuestEntry | null = null;
  // Constant-time compare against every live entry, so response time does not
  // reveal how close a guess was.
  for (const entry of live(readRegistry().guests, now)) {
    let candidate: Buffer;
    try {
      candidate = Buffer.from(entry.digest, "hex");
    } catch {
      continue;
    }
    if (
      candidate.length === digest.length &&
      timingSafeEqual(candidate, digest)
    ) {
      found = entry;
    }
  }
  return found ? { workspaceId: found.workspaceId, label: found.label } : null;
}

/** Test helper: forget the rolling creation window. */
export function __resetGuestRateLimit(): void {
  window = { startedAt: 0, count: 0 };
}
