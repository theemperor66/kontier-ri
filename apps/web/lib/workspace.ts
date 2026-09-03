"use client";

/**
 * Workspace seam for the app: which store the session talks to, and who is
 * talking. Local storage is the default and needs no configuration; a
 * workspace service is used only when the deployment sets an API base and the
 * human has pasted a token for it. The token is never baked into the bundle.
 */

import { useEffect, useMemo, useState } from "react";
import {
  HttpWorkspaceStore,
  LocalWorkspaceStore,
  type WorkspaceIdentity,
  type WorkspaceStore,
} from "@kontier-ri/workspace";

const TOKEN_KEY = "kontier-ri:ws:token";
const ACTOR_KEY = "kontier-ri:ws:actor";
const LABEL_KEY = "kontier-ri:ws:label";

/** Where the workspace service lives, when the deployment has one. */
export function workspaceApiBase(): string | null {
  const base = process.env.NEXT_PUBLIC_WORKSPACE_API;
  return base && base.length > 0 ? base.replace(/\/$/, "") : null;
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
    /* private mode: the session stays local-only, which is a valid state */
  }
}

export function workspaceToken(): string | null {
  return readLocal(TOKEN_KEY);
}

export function setWorkspaceToken(token: string | null): void {
  writeLocal(TOKEN_KEY, token && token.trim().length > 0 ? token.trim() : null);
  window.dispatchEvent(new CustomEvent("kontier:workspace-config"));
}

/** A stable id for THIS browser tab's user, so peers can be told apart. */
export function actorId(): string {
  const existing = readLocal(ACTOR_KEY);
  if (existing) return existing;
  const created = `actor_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  writeLocal(ACTOR_KEY, created);
  return created;
}

export function actorLabel(): string {
  return readLocal(LABEL_KEY) ?? "This browser";
}

export function setActorLabel(label: string): void {
  writeLocal(LABEL_KEY, label.trim() || "This browser");
  window.dispatchEvent(new CustomEvent("kontier:workspace-config"));
}

export type WorkspaceMode = "local" | "remote" | "unconfigured";

export interface WorkspaceConnection {
  store: WorkspaceStore;
  mode: WorkspaceMode;
  /** Set when an API base exists but no token has been pasted yet. */
  needsToken: boolean;
  apiBase: string | null;
}

/**
 * Resolve the store for this session. Remote when an API base AND a token
 * exist; local otherwise. Never throws: a misconfigured remote degrades to
 * local storage rather than losing the user's work.
 */
export function resolveWorkspace(): WorkspaceConnection {
  const apiBase = workspaceApiBase();
  const token = workspaceToken();
  if (apiBase && token) {
    try {
      return {
        store: new HttpWorkspaceStore({ baseUrl: apiBase, token }),
        mode: "remote",
        needsToken: false,
        apiBase,
      };
    } catch {
      /* fall through to local */
    }
  }
  return {
    store: new LocalWorkspaceStore(),
    mode: apiBase ? "unconfigured" : "local",
    needsToken: Boolean(apiBase) && !token,
    apiBase,
  };
}

/** Live connection that re-resolves when the human pastes or clears a token. */
export function useWorkspace(): WorkspaceConnection {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const bump = () => setNonce((value) => value + 1);
    window.addEventListener("kontier:workspace-config", bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener("kontier:workspace-config", bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveWorkspace(), [nonce]);
}

export function describeWorkspace(
  connection: WorkspaceConnection,
  identity: WorkspaceIdentity | null,
): string {
  if (connection.mode === "remote") {
    return identity ? `Workspace: ${identity.label}` : "Workspace";
  }
  if (connection.needsToken) return "Workspace available — paste a token";
  return "This browser only";
}
