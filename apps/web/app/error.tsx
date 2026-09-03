"use client";

import { useEffect } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { KontierWordmark } from "@/components/chrome/kontier-wordmark";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No telemetry is sent: the local-first privacy promise includes errors.
    console.error("Kontier RI workspace error", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 text-foreground">
      <section className="w-full max-w-lg">
        <KontierWordmark className="h-5 w-auto text-foreground" />
        <div className="mt-10 flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <WarningCircle weight="fill" className="size-5" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em]">
          The workspace hit a problem.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your saved dashboard is still in this browser. Retry the workspace
          first. If you were using an in-memory upload, keep the source file
          nearby in case the data engine needs it again.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={reset}>
            <ArrowClockwise className="size-4" /> Retry workspace
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
        {error.digest ? (
          <p className="mt-6 font-mono text-[10px] text-muted-foreground">
            Reference {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
