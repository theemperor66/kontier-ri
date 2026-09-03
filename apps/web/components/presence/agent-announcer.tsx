"use client";

/**
 * U6: polite aria-live narration of agent actions. Watches the activity-log
 * tail and announces new agent entries ("Agent added chart X") to screen
 * readers without any visual footprint. History present at mount is never
 * announced.
 */

import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "@/lib/dashboard-store";

function toAnnouncement(label: string): string {
  // Labels read "Added kpi tile ..." or "Agent shared a plan ...".
  const text = label.replace(/^Agent\s+/, "");
  return `Agent ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

export function AgentAnnouncer() {
  const latest = useDashboardStore((s) => s.activityLog[0]);
  const [message, setMessage] = useState("");
  const seenIdRef = useRef<string | null>(null);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!latest || latest.by !== "agent") return;
    if (seenIdRef.current === latest.id) return;
    seenIdRef.current = latest.id;
    if (latest.at < mountedAtRef.current) return; // pre-mount history
    // Clear first so identical consecutive labels still re-announce.
    setMessage("");
    const raf = requestAnimationFrame(() =>
      setMessage(toAnnouncement(latest.label)),
    );
    return () => cancelAnimationFrame(raf);
  }, [latest]);

  return (
    <div
      aria-live="polite"
      role="status"
      data-testid="agent-announcer"
      className="sr-only"
    >
      {message}
    </div>
  );
}
