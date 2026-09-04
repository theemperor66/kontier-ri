"use client";

/**
 * The sign-in gate.
 *
 * Composition: one navy field carrying the product's own world beside one
 * white field carrying the decision. Not three stacked cards of icon,
 * heading and body — that is the shape a page takes when nobody decided what
 * matters, and here something does: which workspace you are about to enter.
 *
 * The order is deliberate. Signing in with Kontier is a real OIDC round trip
 * against the platform's own Keycloak, so it leads. A guest workspace is the
 * honest answer for someone with no Kontier account, so it sits beside it,
 * not beneath it. The two quiet routes — an invite link, and the shared demo
 * tenant — are quiet because most people need neither.
 */

import { useState } from "react";
import {
  ArrowRight,
  CircleNotch,
  Key,
  LinkSimple,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { beginKontierSignIn } from "@/lib/keycloak";
import {
  createGuestWorkspace,
  joinDemoTenant,
  joinWithToken,
} from "@/lib/workspace-session";

type Busy = "kontier" | "guest" | "demo" | null;

export function SignIn({ onDismiss }: { onDismiss?: () => void }) {
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
      setBusy(null);
    }
  };

  const adoptPasted = () => {
    const raw = pasted.trim();
    if (raw.length === 0) return;
    const fromUrl = /[#&]ws=([^&]+)/.exec(raw)?.[1];
    joinWithToken(fromUrl ? decodeURIComponent(fromUrl) : raw);
  };

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[1.05fr_0.95fr]">
      {/* The product's own world. On a narrow screen it becomes a header
          rather than disappearing: it is the only thing that explains what
          you are signing in to. */}
      <section className="flex flex-col justify-between bg-nav px-7 py-8 text-white sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-[9px] bg-white/10 text-[15px] font-semibold">
            k
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            Kontier RI
          </span>
        </div>

        <div className="max-w-[34ch] py-10 lg:py-4">
          <h1 className="text-[30px] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[38px] lg:text-[44px]">
            The report is the conversation.
          </h1>
          <p className="mt-4 text-[14.5px] leading-relaxed text-white/70 sm:text-[15.5px]">
            Several people and their agents investigate one live report
            together. The agent proposes; a human approves; every change is
            attributed and reversible.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-4 border-t border-white/10 pt-6 text-white/60">
          {[
            ["100M", "rows queried in the tab"],
            ["46", "tools offered over WebMCP"],
            ["0", "changes applied unreviewed"],
          ].map(([value, note]) => (
            <div key={note}>
              <dt className="text-[19px] font-semibold tabular-nums text-white sm:text-[22px]">
                {value}
              </dt>
              <dd className="mt-1 text-[11.5px] leading-snug">{note}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* The decision. */}
      <section className="flex items-center px-6 py-10 sm:px-10 lg:px-14">
        <div className="w-full max-w-[27rem]">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em]">
            Choose a workspace
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            A workspace is the room your report lives in, and who else can
            reach it.
          </p>

          <div className="mt-7 flex flex-col gap-2.5">
            <Button
              data-testid="signin-tenant"
              className="h-11 w-full justify-between px-4 text-[14px]"
              disabled={busy !== null}
              onClick={() => void run("kontier", beginKontierSignIn)}
            >
              <span className="flex items-center gap-2">
                {busy === "kontier" ? (
                  <CircleNotch className="size-4 animate-spin" />
                ) : (
                  <Key className="size-4" />
                )}
                Sign in with Kontier
              </span>
              <ArrowRight className="size-4" />
            </Button>

            <Button
              variant="outline"
              data-testid="signin-guest"
              className="h-11 w-full justify-between px-4 text-[14px]"
              disabled={busy !== null}
              onClick={() => void run("guest", () => createGuestWorkspace())}
            >
              <span className="flex items-center gap-2">
                {busy === "guest" ? (
                  <CircleNotch className="size-4 animate-spin" />
                ) : null}
                Start a workspace as a guest
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Button>
          </div>

          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            Signing in with Kontier puts you in your organization&rsquo;s
            workspace with your colleagues. A guest workspace is yours alone
            until you send the link &mdash;{" "}
            <span className="text-warn">
              and that link is the only key, so keep it.
            </span>
          </p>

          {error ? (
            <p
              data-testid="signin-error"
              className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-destructive"
            >
              <Warning weight="fill" className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          <div className="mt-8 border-t border-line pt-5">
            {pasting ? (
              <div className="flex flex-wrap items-center gap-2">
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
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
                <button
                  type="button"
                  data-testid="signin-paste"
                  className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
                  onClick={() => setPasting(true)}
                >
                  <LinkSimple className="size-3.5" />
                  I have an invite link
                </button>
                <button
                  type="button"
                  data-testid="signin-demo"
                  disabled={busy !== null}
                  className="cursor-pointer transition-colors hover:text-foreground disabled:opacity-50"
                  onClick={() => void run("demo", joinDemoTenant)}
                >
                  {busy === "demo" ? "Opening…" : "Open the shared demo workspace"}
                </button>
              </div>
            )}
          </div>

          {onDismiss ? (
            <button
              type="button"
              data-testid="signin-dismiss"
              className="mt-6 cursor-pointer text-[13px] text-muted-foreground underline decoration-line-2 underline-offset-2 hover:text-foreground"
              onClick={onDismiss}
            >
              Back to my workspace
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
