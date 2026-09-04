"use client";

/**
 * WHAT: decides whether this visit starts at the sign-in screen or inside a
 * workspace.
 *
 * WHY it is a wall: the product is a SHARED investigation workspace, and
 * dropping a first-time visitor into a browser-local report shows them the
 * one thing this product is not.
 *
 *   1. Already in a workspace   -> work, immediately. No request first.
 *   2. Arrived on an invite link -> adopt it silently and work.
 *   3. No workspace API here     -> work. A build with no server cannot offer
 *                                   a sign-in that could succeed.
 *   4. Otherwise                 -> choose a workspace.
 *
 * NOTHING WAITS ON THE NETWORK TO PAINT. An earlier version returned null
 * until a probe answered, so a single slow or hanging request left a blank
 * page for as long as it took — which reads as "loads forever" and is the
 * worst thing a first screen can do. The sign-in screen renders first and the
 * probe only ever swaps it away, so the failure mode is a usable screen
 * rather than an empty one. The probe is also bounded, because a request with
 * no timeout is a promise to wait forever.
 */

import { useEffect, useState, type ReactNode } from "react";
import { SignIn } from "@/components/chrome/sign-in";
import { useUiState } from "@/lib/ui-state";
import {
  currentSession,
  subscribeSession,
  workspaceApiBase,
} from "@/lib/workspace-session";

/** Long enough for a cold container, short enough not to feel stuck. */
const PROBE_TIMEOUT_MS = 5_000;

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const requested = useUiState((s) => s.signInOpen);
  const setRequested = useUiState((s) => s.setSignInOpen);
  const [hasSession, setHasSession] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [apiAbsent, setApiAbsent] = useState(false);

  useEffect(() => {
    setMounted(true);
    const read = () => setHasSession(currentSession() !== null);
    read();
    if (new URLSearchParams(window.location.search).get("signin") === "1") {
      setRequested(true);
    }
    return subscribeSession(read);
  }, [setRequested]);

  // Only matters when signed out: it decides whether to offer a sign-in at
  // all. A session already proves there is a server.
  useEffect(() => {
    if (!mounted || hasSession) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    void (async () => {
      try {
        const response = await fetch(`${workspaceApiBase()}/dashboards`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        // 401 is the healthy answer: the API is there and wants a token.
        if (!cancelled && response.status !== 401 && !response.ok) {
          setApiAbsent(true);
        }
      } catch {
        // A timeout is NOT proof the API is missing, so this deliberately
        // does not fall through to local mode. Staying on the sign-in screen
        // keeps the retry one click away.
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [mounted, hasSession]);

  // Server render and first paint go to the app so nothing flashes for a
  // returning visitor, who is the common case.
  if (!mounted) return <>{children}</>;
  if (hasSession && !requested) return <>{children}</>;
  if (apiAbsent && !requested) return <>{children}</>;

  return (
    <SignIn onDismiss={hasSession ? () => setRequested(false) : undefined} />
  );
}
