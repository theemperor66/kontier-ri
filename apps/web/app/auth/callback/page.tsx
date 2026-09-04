"use client";

/**
 * The return leg of the Kontier sign-in.
 *
 * A redirect back from an identity provider is the one screen a user never
 * chose to visit, so it says what is happening, and when something goes wrong
 * it says what to do next rather than showing a stack trace.
 */

import { useEffect, useState } from "react";
import { ArrowLeft, CircleNotch, Warning } from "@phosphor-icons/react";
import { completeKontierSignIn } from "@/lib/keycloak";
import { storeSession } from "@/lib/workspace-session";
import { Button } from "@/components/ui/button";

export default function KontierCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await completeKontierSignIn(
          new URLSearchParams(window.location.search),
        );
        if (cancelled) return;
        storeSession({
          token: result.token,
          workspaceId: result.workspaceId,
          label: result.label,
          kind: "tenant",
        });
        // replace, not push: the code is single-use and Back must not retry it
        window.location.replace("/");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        {error === null ? (
          <>
            <CircleNotch
              className="mx-auto size-6 animate-spin text-accent-strong"
              aria-hidden
            />
            <h1 className="mt-4 text-[17px] font-semibold">
              Finishing your Kontier sign-in
            </h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              Checking the identity token and opening your organization&rsquo;s
              workspace.
            </p>
          </>
        ) : (
          <div
            data-testid="callback-error"
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-left"
          >
            <p className="flex items-center gap-2 text-[15px] font-semibold text-destructive">
              <Warning weight="fill" className="size-4 shrink-0" />
              That sign-in did not complete
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-destructive/90">
              {error}
            </p>
            <Button
              variant="outline"
              className="mt-4 h-9"
              onClick={() => window.location.replace("/?signin=1")}
            >
              <ArrowLeft className="size-3.5" /> Back to sign-in
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
