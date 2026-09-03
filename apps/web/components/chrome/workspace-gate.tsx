"use client";

/**
 * WHAT: shows the sign-in screen when someone asks for it, and never before.
 *
 * WHY there is no wall: the first screen a stranger sees decides whether they
 * ever see the product. Making them choose a workspace before they know what
 * a workspace is here costs more visitors than it earns collaborators. So the
 * report renders immediately, and joining or inviting is one visible click
 * away in the top bar.
 *
 * The one exception is an invite link. If someone sent you `#ws=…`, adopting
 * it silently and dropping you straight into their workspace is exactly what
 * you wanted to happen.
 */

import { useEffect, type ReactNode } from "react";
import { SignIn } from "@/components/chrome/sign-in";
import { useUiState } from "@/lib/ui-state";
import { currentSession } from "@/lib/workspace-session";

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const open = useUiState((s) => s.signInOpen);
  const setOpen = useUiState((s) => s.setSignInOpen);

  // `?signin=1` is a shareable way to land on the chooser, for a demo or a
  // support reply. An invite fragment is adopted by currentSession() itself.
  useEffect(() => {
    currentSession();
    if (new URLSearchParams(window.location.search).get("signin") === "1") {
      setOpen(true);
    }
  }, [setOpen]);

  if (!open) return <>{children}</>;
  return <SignIn onLocalOnly={() => setOpen(false)} />;
}
