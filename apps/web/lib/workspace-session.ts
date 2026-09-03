"use client";

/**
 * WHAT: the client's workspace session — which workspace this tab is in, and
 * the token that proves it.
 *
 * WHY the token lives in the URL as well as in localStorage: for a guest
 * there is no account, so the link IS the credential. Putting it in the
 * fragment (never the query string) keeps it out of server logs, Referer
 * headers and analytics, while still letting someone paste it to a colleague
 * or save it to reopen the workspace next week.
 *
 * There is no password to recover. Losing the link loses the workspace, and
 * the UI says so before the workspace is created rather than after.
 */

import { HttpWorkspaceStore, type WorkspaceStore } from "@kontier-ri/workspace";

const TOKEN_KEY = "kontier-ri:ws:session";
const ACTOR_KEY = "kontier-ri:ws:actor";
const NAME_KEY = "kontier-ri:ws:display-name";
/** Fragment key an invite link carries. */
export const INVITE_FRAGMENT_KEY = "ws";

export type SessionKind = "guest" | "tenant";

export interface WorkspaceSession {
  token: string;
  workspaceId: string;
  label: string;
  kind: SessionKind;
}

/** Where the workspace API lives. Same origin unless overridden. */
export function workspaceApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_WORKSPACE_API?.trim();
  if (configured && configured.length > 0) return configured.replace(/\/$/, "");
  return "/api/workspace";
}

function readLocal(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the session lasts as long as the tab, which still works */
  }
}

// ---------------------------------------------------------------------------
// Identity of this participant. Never invented beyond a local label the human
// can change: no avatars, no personas, no fabricated names for other people.
// ---------------------------------------------------------------------------

export function actorId(): string {
  const existing = readLocal(ACTOR_KEY);
  if (existing) return existing;
  const created = `actor_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  writeLocal(ACTOR_KEY, created);
  return created;
}

export function displayName(): string {
  return readLocal(NAME_KEY) ?? "You";
}

export function setDisplayName(name: string): void {
  const trimmed = name.trim().slice(0, 60);
  writeLocal(NAME_KEY, trimmed.length > 0 ? trimmed : null);
  notify();
}

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

function parseSession(raw: string | null): WorkspaceSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSession>;
    if (
      typeof parsed.token === "string" &&
      typeof parsed.workspaceId === "string" &&
      parsed.token.length > 0 &&
      parsed.workspaceId.length > 0
    ) {
      return {
        token: parsed.token,
        workspaceId: parsed.workspaceId,
        label: typeof parsed.label === "string" ? parsed.label : "Workspace",
        kind: parsed.kind === "tenant" ? "tenant" : "guest",
      };
    }
  } catch {
    /* corrupt entry: treat as signed out */
  }
  return null;
}

/**
 * An invite link carries `#ws=<token>`. Reading it stores the session and
 * strips the fragment, so the credential does not sit in the address bar for
 * the next screenshot or shoulder-surfer.
 */
function adoptInviteFromUrl(): WorkspaceSession | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const match = new RegExp(`(?:^#|[#&])${INVITE_FRAGMENT_KEY}=([^&]+)`).exec(hash);
  const token = match?.[1];
  if (!token) return null;
  const session: WorkspaceSession = {
    token: decodeURIComponent(token),
    // The real id and label arrive from identity(); the link only carries the
    // credential, because an id in a link tells a stranger what to probe for.
    workspaceId: "",
    label: "Shared workspace",
    kind: "guest",
  };
  writeLocal(TOKEN_KEY, JSON.stringify(session));
  const cleaned = hash
    .replace(new RegExp(`(?:^#|&)${INVITE_FRAGMENT_KEY}=[^&]*`), "")
    .replace(/^&/, "");
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${cleaned ? `#${cleaned}` : ""}`);
  return session;
}

export function currentSession(): WorkspaceSession | null {
  return adoptInviteFromUrl() ?? parseSession(readLocal(TOKEN_KEY));
}

export function storeSession(session: WorkspaceSession): void {
  writeLocal(TOKEN_KEY, JSON.stringify(session));
  notify();
}

export function clearSession(): void {
  writeLocal(TOKEN_KEY, null);
  notify();
}

/** The link to send someone. The token is the invitation. */
export function inviteUrl(session: WorkspaceSession): string {
  const url = new URL(window.location.href);
  url.hash = `${INVITE_FRAGMENT_KEY}=${encodeURIComponent(session.token)}`;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Creating a session
// ---------------------------------------------------------------------------

interface SessionResponse {
  workspaceId?: string;
  token?: string;
  label?: string;
  kind?: string;
}

async function requestSession(
  path: "guest" | "tenant",
  body?: unknown,
): Promise<WorkspaceSession> {
  const response = await fetch(`${workspaceApiBase()}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `The workspace service refused (${response.status}).`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  const parsed = JSON.parse(text) as SessionResponse;
  if (!parsed.token || !parsed.workspaceId) {
    throw new Error("The workspace service returned an unusable session.");
  }
  const session: WorkspaceSession = {
    token: parsed.token,
    workspaceId: parsed.workspaceId,
    label: parsed.label ?? "Workspace",
    kind: parsed.kind === "tenant" ? "tenant" : "guest",
  };
  storeSession(session);
  return session;
}

export function createGuestWorkspace(label?: string): Promise<WorkspaceSession> {
  return requestSession("guest", { label: label ?? "" });
}

export function joinDemoTenant(): Promise<WorkspaceSession> {
  return requestSession("tenant");
}

/** Adopt a token someone pasted by hand. Verified by the first real call. */
export function joinWithToken(token: string): WorkspaceSession {
  const session: WorkspaceSession = {
    token: token.trim(),
    workspaceId: "",
    label: "Shared workspace",
    kind: "guest",
  };
  storeSession(session);
  return session;
}

/** The store for a session, or null when this tab is signed out. */
export function storeForSession(session: WorkspaceSession | null): WorkspaceStore | null {
  if (session === null) return null;
  return new HttpWorkspaceStore({
    baseUrl: workspaceApiBase(),
    token: session.token,
  });
}

// ---------------------------------------------------------------------------
// Change notification, so every hook re-reads at once.
// ---------------------------------------------------------------------------

const SESSION_EVENT = "kontier:workspace-session";

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

export function subscribeSession(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SESSION_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
