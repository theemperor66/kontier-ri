"use client";

/**
 * WHAT: the front door. Three ways in, and only one of them involves anyone
 * at Kontier knowing who you are.
 *
 * WHY it is a screen and not a modal: which workspace you are in decides what
 * everything else means — whose report you are editing, who can see your
 * approvals, who is in the room. That is not a preference to bury in a menu.
 *
 * The guest path is the honest default for a first visit: one button, no
 * account, and the link it gives you is the only way back. The screen says so
 * BEFORE creating the workspace, because there is no password reset for a
 * link you did not keep.
 */

import { useState } from "react";
import {
  ArrowRight,
  Buildings,
  LinkSimple,
  Users,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createGuestWorkspace,
  joinDemoTenant,
  joinWithToken,
} from "@/lib/workspace-session";

type Busy = "guest" | "tenant" | null;

export function SignIn({ onLocalOnly }: { onLocalOnly?: () => void }) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const adoptPasted = () => {
    const raw = pasted.trim();
    if (raw.length === 0) return;
    // Accept a whole invite URL or a bare token.
    const fromUrl = /[#&]ws=([^&]+)/.exec(raw)?.[1];
    joinWithToken(fromUrl ? decodeURIComponent(fromUrl) : raw);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl">
        <div className="mb-7">
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">
            Kontier RI
          </h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
            A shared investigation workspace. Several people and their agents
            work the same live report — and nothing changes until someone
            approves it.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-card shadow-card">
          {/* Guest: the path a first-time visitor should take. */}
          <section className="border-b border-line p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent text-accent-foreground">
                <Users className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold">
                  Start a workspace as a guest
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  No account. You get your own workspace, a link to invite
                  other people, and the same link to reopen it later.
                </p>
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-warn">
                  <Warning className="mt-px size-3.5 shrink-0" />
                  The link is the only key. Save it — there is no password to
                  reset.
                </p>
                <Button
                  data-testid="signin-guest"
                  className="mt-3.5 h-10 gap-2"
                  disabled={busy !== null}
                  onClick={() => void run("guest", () => createGuestWorkspace())}
                >
                  {busy === "guest" ? "Creating…" : "Create my workspace"}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </section>

          {/* Kontier tenant: one button, as specified. No redirect dance. */}
          <section className="border-b border-line p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-2 text-muted-foreground">
                <Buildings className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold">
                  Sign in as a Kontier tenant
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  Join the shared Kontier demo workspace. Everyone who presses
                  this lands in the same room, on synthetic billing data.
                </p>
                <Button
                  variant="outline"
                  data-testid="signin-tenant"
                  className="mt-3.5 h-10"
                  disabled={busy !== null}
                  onClick={() => void run("tenant", joinDemoTenant)}
                >
                  {busy === "tenant" ? "Joining…" : "Sign in as a Kontier tenant"}
                </Button>
              </div>
            </div>
          </section>

          {/* Someone sent you a link. */}
          <section className="p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-2 text-muted-foreground">
                <LinkSimple className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold">
                  I have an invite link
                </h2>
                {pasting ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Input
                      autoFocus
                      data-testid="signin-token"
                      value={pasted}
                      placeholder="Paste the invite link"
                      className="h-9 min-w-0 flex-1"
                      onChange={(event) => setPasted(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") adoptPasted();
                      }}
                    />
                    <Button
                      variant="outline"
                      className="h-9"
                      data-testid="signin-token-join"
                      onClick={adoptPasted}
                    >
                      Open
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="signin-paste"
                    className="mt-1 cursor-pointer text-[13px] text-accent-strong underline decoration-line-2 underline-offset-2"
                    onClick={() => setPasting(true)}
                  >
                    Paste it here
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>

        {error ? (
          <p
            data-testid="signin-error"
            className="mt-3.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive"
          >
            {error}
          </p>
        ) : null}

        {onLocalOnly ? (
          <button
            type="button"
            data-testid="signin-local"
            className="mt-4 cursor-pointer text-[13px] text-muted-foreground underline decoration-line-2 underline-offset-2 hover:text-foreground"
            onClick={onLocalOnly}
          >
            Keep working in this browser instead
          </button>
        ) : null}
      </div>
    </div>
  );
}
