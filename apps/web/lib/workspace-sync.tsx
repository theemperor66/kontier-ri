"use client";

/**
 * WHAT: the shared-workspace loop. Keeps this tab's dashboard in step with the
 * server, tells the server this participant is here, and reports who else is.
 *
 * WHY the server and not peer-to-peer: several humans and several agents act
 * on one report, so somebody has to decide what happened first. The server
 * assigns `seq` on every command, which makes that a total order nobody can
 * argue with. `at` is a client clock and is display only.
 *
 * CONFLICT MODEL, stated plainly: the server document is authoritative. When
 * this tab sees a command from another participant it re-reads the document
 * and adopts it. That is last-write-wins with a refresh, NOT a CRDT — two
 * people editing the same tile in the same second can still lose a keystroke.
 * What is guaranteed is that everyone converges on the same document, that
 * every change is attributed, and that nothing is applied without approval.
 * Pending local edits are flushed before adopting, so the loser of a race
 * sees the other person's version rather than a merge of both.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PresencePeer, WorkspaceStore } from "@kontier-ri/workspace";
import { useDashboardStore } from "@/lib/dashboard-store";
import { currentDashboardId, flushPersist } from "@/lib/dashboards";
import {
  actorId,
  currentSession,
  displayName,
  storeForSession,
  subscribeSession,
  type WorkspaceSession,
} from "@/lib/workspace-session";

/** How often this tab asks for commands it has not seen. */
export const SYNC_POLL_MS = 2_000;
/** How often it says "still here". The server prunes silent peers. */
export const HEARTBEAT_MS = 10_000;

export type ConnectionState = "signed-out" | "connecting" | "live" | "error";

interface WorkspaceValue {
  session: WorkspaceSession | null;
  store: WorkspaceStore | null;
  state: ConnectionState;
  /** Human-readable reason, only when state is "error". */
  error: string | null;
  /** Everyone the server has heard from lately, including this participant. */
  peers: PresencePeer[];
  /** Other participants only — what the UI means by "who else is here". */
  others: PresencePeer[];
  /** Highest command seq this tab has applied. */
  cursor: number;
  refresh(): void;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [state, setState] = useState<ConnectionState>("signed-out");
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [cursor, setCursor] = useState(0);
  const [nonce, setNonce] = useState(0);

  // Read the session on mount and whenever it changes (invite link adopted,
  // signed in, signed out).
  useEffect(() => {
    const read = () => setSession(currentSession());
    read();
    return subscribeSession(read);
  }, []);

  const store = useMemo(() => storeForSession(session), [session]);
  const me = useMemo(() => actorId(), []);
  const cursorRef = useRef(0);
  cursorRef.current = cursor;

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /** Adopt the server's document for the dashboard this tab is showing. */
  const adoptServerDoc = useCallback(
    async (activeStore: WorkspaceStore, dashboardId: string) => {
      const record = await activeStore.loadDashboard(dashboardId);
      if (!record) return;
      // Do not clobber unsaved local edits silently: flush them first, so the
      // server has seen this tab's work before the tab adopts someone else's.
      flushPersist();
      useDashboardStore.getState().resetDashboard(record.doc as never);
    },
    [],
  );

  // Sign in / out transitions.
  useEffect(() => {
    if (!store || !session) {
      setState("signed-out");
      setError(null);
      setPeers([]);
      setCursor(0);
      return;
    }
    let cancelled = false;
    setState("connecting");
    setError(null);
    void (async () => {
      try {
        await store.identity();
        if (!cancelled) setState("live");
      } catch (err) {
        if (cancelled) return;
        setState("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, session, nonce]);

  // Command polling: the only thing that tells this tab someone else acted.
  useEffect(() => {
    if (!store || state !== "live") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const dashboardId = currentDashboardId();
      if (!dashboardId) {
        timer = setTimeout(tick, SYNC_POLL_MS);
        return;
      }
      try {
        const page = await store.fetchCommands(dashboardId, cursorRef.current);
        if (stopped) return;
        const remote = page.entries.filter((entry) => entry.actor !== me);
        if (remote.length > 0) {
          await adoptServerDoc(store, dashboardId);
        }
        if (page.cursor !== cursorRef.current) setCursor(page.cursor);
        setError(null);
      } catch (err) {
        if (stopped) return;
        // A poll failure is not a sign-out: the network may come back.
        setError(err instanceof Error ? err.message : String(err));
      }
      if (!stopped) timer = setTimeout(tick, SYNC_POLL_MS);
    };

    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [store, state, me, adoptServerDoc]);

  // Push: save the document and report this tab's commands, so the other
  // participants have something to poll for. Without this half the loop is
  // one-way and nobody ever sees anyone else's work.
  useEffect(() => {
    if (!store || state !== "live") return;
    const pushed = new Set<string>();
    // Everything already in the log at sign-in belongs to history, not to
    // this session; reporting it again would duplicate the feed for peers.
    for (const entry of useDashboardStore.getState().activityLog) {
      pushed.add(entry.id);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastDoc = useDashboardStore.getState().doc;
    let inFlight = false;

    const push = async () => {
      timer = undefined;
      if (inFlight) return;
      const dashboardId = currentDashboardId();
      if (!dashboardId) return;
      inFlight = true;
      try {
        const snapshot = useDashboardStore.getState();
        await store.saveDashboard({
          id: dashboardId,
          name: snapshot.doc.title,
          updatedAt: Date.now(),
          doc: snapshot.doc as never,
        });
        const fresh = snapshot.activityLog.filter(
          (entry) => !pushed.has(entry.id),
        );
        if (fresh.length > 0) {
          // Oldest first, so `seq` on the server matches what happened here.
          const entries = [...fresh].reverse().map((entry) => ({
            dashboardId,
            by: entry.by,
            actor: me,
            label: entry.label,
            at: entry.at,
          }));
          await store.appendCommands(dashboardId, entries);
          for (const entry of fresh) pushed.add(entry.id);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight = false;
      }
    };

    const unsubscribe = useDashboardStore.subscribe((snapshot) => {
      if (snapshot.doc === lastDoc) return;
      lastDoc = snapshot.doc;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void push(), 600);
    });
    // Publish once on connect so a peer joining an existing report sees it.
    void push();

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [store, state, me]);

  // Presence: say we are here, and learn who else is.
  useEffect(() => {
    if (!store || state !== "live") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const beat = async () => {
      try {
        const seen = await store.heartbeat(
          me,
          displayName(),
          currentDashboardId(),
        );
        if (!stopped) setPeers(seen);
      } catch {
        // Presence is decoration. A failure here must never break the app.
      }
      if (!stopped) timer = setTimeout(beat, HEARTBEAT_MS);
    };

    void beat();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [store, state, me]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      session,
      store,
      state,
      error,
      peers,
      others: peers.filter((peer) => peer.actor !== me),
      cursor,
      refresh,
    }),
    [session, store, state, error, peers, me, cursor, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
