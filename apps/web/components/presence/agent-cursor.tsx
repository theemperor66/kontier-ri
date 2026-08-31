"use client";

/**
 * Synthetic agent cursor (E2): a cursor glyph with a "Kai" name tag that
 * flies (FLIP: transform-only transition, no layout) to every tile the
 * agent just mutated. Driven exclusively off the store's agentPulse map —
 * which only agent-origin commands set — so it never fakes activity.
 * prefers-reduced-motion collapses the flight to an instant placement via
 * the global reduced-motion rule.
 */

import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "@/lib/dashboard-store";
import { cn } from "@/lib/utils";

const LINGER_MS = 2600;

export function AgentCursor() {
  const agentPulse = useDashboardStore((s) => s.agentPulse);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const seenRef = useRef(0);

  // Latest agent-touched tile wins.
  let latestId: string | null = null;
  let latestAt = 0;
  for (const [id, at] of Object.entries(agentPulse)) {
    if (at > latestAt) {
      latestAt = at;
      latestId = id;
    }
  }

  useEffect(() => {
    if (!latestId || latestAt <= seenRef.current) return;
    const el = document.querySelector(`[data-testid="tile-${latestId}"]`);
    if (!(el instanceof HTMLElement)) return;
    seenRef.current = latestAt;
    const rect = el.getBoundingClientRect();
    const target = {
      x: rect.left + Math.min(rect.width - 32, rect.width * 0.7),
      y: rect.top + Math.min(rect.height - 24, 44),
    };
    // First flight starts from just below the viewport, then FLIPs to the
    // tile on the next frame so the transform transition plays.
    setPos((prev) => prev ?? { x: window.innerWidth * 0.5, y: window.innerHeight + 40 });
    const raf = requestAnimationFrame(() => setPos(target));
    setVisible(true);
    const t = setTimeout(() => setVisible(false), LINGER_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [latestId, latestAt]);

  if (!pos) return null;

  return (
    <div
      data-testid="agent-cursor"
      aria-hidden
      className={cn(
        "agent-cursor pointer-events-none fixed left-0 top-0 z-[60]",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 3l14 8-6.6 1.6L9 19.5 5 3z"
          fill="var(--agent)"
          stroke="var(--background)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="ml-3.5 -mt-1 inline-block rounded-full bg-agent px-1.5 py-px text-[10px] font-semibold leading-4 text-background shadow-sm">
        Kai
      </span>
    </div>
  );
}
