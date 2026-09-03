"use client";

/**
 * WHAT: decides whether this visit starts at the sign-in screen or inside a
 * workspace.
 *
 * WHY it IS a wall now, having briefly not been: the product is a SHARED
 * investigation workspace. Dropping a first-time visitor into a browser-local
 * report shows them the one thing this product is not, and quietly strands
 * their work somewhere nobody else can reach — including them, on their next
 * device. Choosing a workspace is not a settings decision to postpone; it is
 * the first fact everything else depends on.
 *
 * The rules stay few and boring:
 *
 *   1. Already in a workspace   -> work.
 *   2. Arrived on an invite link -> adopt it silently and work. That is
 *                                   exactly what the person who clicked wanted.
 *   3. No workspace API here     -> work. A build with no server cannot offer
 *                                   a sign-in that could succeed.
 *   4. Otherwise                 -> choose a workspace.
 *
 * Rule 3 probes rather than reading a build flag, because the same bundle is
 * served by the container and by any static host, and only a request can tell
 * them apart. An unauthenticated 401 proves the API is there.
 */

import { useEffect, useState, type ReactNode } from "react";
import { SignIn } from "@/components/chrome/sign-in";
import { useUiState } from "@/lib/ui-state";
import { currentSession, workspaceApiBase } from "@/lib/workspace-session";
import { subscribeSession } from "@/lib/workspace-session";

type Probe = "checking" | "available" | "absent";

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const requested = useUiState((s) => s.signInOpen);
  const setRequested = useUiState((s) => s.setSignInOpen);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [probe, setProbe] = useState<Probe>("checking");

  useEffect(() => {
    const read = () => setHasSession(currentSession() !== null);
    read();
    if (new URLSearchParams(window.location.search).get("signin") === "1") {
      setRequested(true);
    }
    return subscribeSession(read);
  }, [setRequested]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${workspaceApiBase()}/dashboards`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!cancelled) {
          setProbe(response.status === 401 || response.ok ? "available" : "absent");
        }
      } catch {
        if (!cancelled) setProbe("absent");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hold the first paint until both facts are known. Showing the report and
  // then yanking it away is worse than a moment of nothing.
  if (hasSession === null || probe === "checking") return null;

  const mustChoose = !hasSession && probe === "available";
  if (mustChoose || requested) {
    return <SignIn onDismiss={hasSession ? () => setRequested(false) : undefined} />;
  }
  return <>{children}</>;
}
