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
import type { PresenceState } from "@kontier-ri/studio";
import type { PresencePeer, WorkspaceStore } from "@kontier-ri/workspace";
import { useDashboardStore } from "@/lib/dashboard-store";
import {
  currentDashboardId,
  flushPersist,
  saveDashboardDoc,
  setCurrentDashboard,
} from "@/lib/dashboards";
import {
  actorId,
  currentSession,
  displayName,
  storeForSession,
  storeSession,
  subscribeSession,
  type WorkspaceSession,
} from "@/lib/workspace-session";

/** How often this tab asks for commands it has not seen. */
export const SYNC_POLL_MS = 2_000;
/** How often it says "still here". The server prunes silent peers. */
export const HEARTBEAT_MS = 10_000;

/** JSON that never throws on a cyclic or exotic value. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

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
  /**
   * The save stamp of the document version this tab is currently showing.
   *
   * Commands alone are not enough to stay in step. Loading a demo, restoring
   * a version or importing a report changes the document without producing an
   * activity entry, so a peer watching only the command stream would sit on a
   * stale report forever and never learn why. The dashboard's updatedAt moves
   * for every write, so it is the honest trigger.
   */
  const seenUpdatedAt = useRef(0);
  /** Same idea for the shared collaboration state (proposals, decisions). */
  const seenSessionAt = useRef(0);
  /**
   * The exact document and collaboration state this tab last exchanged with
   * the server, serialized.
   *
   * Object identity is not enough. Adopting a peer's state creates new
   * objects, which the store subscription cannot tell apart from the user
   * typing — so each tab would publish what it just received, the other would
   * adopt and publish it back, and the two would ping-pong forever, saving on
   * every tick. Comparing content stops the echo at the source.
   */
  const syncedDocJson = useRef("");
  const syncedPresenceJson = useRef("");
  /**
   * True while this tab is mid-save.
   *
   * Adoption and publishing race each other: a poll can list dashboards
   * BEFORE a save lands and finish loading AFTER it, then apply that stale
   * document over edits the user made in between. The symptom is a change
   * that silently undoes itself a second later, which is the worst possible
   * bug in an editor. So adoption stands aside while a save is in flight.
   */
  const pushInFlight = useRef(false);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * Load a document into the store WITHOUT destroying the collaboration
   * state.
   *
   * resetDashboard clears presence, which is right when a human opens a
   * different report and wrong here: a pending proposal belongs to the
   * workspace, not to the document version that happened to be on screen.
   * Refreshing the report — even from this tab's own save, which races its
   * own poll — was silently deleting change sets a reviewer had not seen yet.
   */
  const applyServerDoc = useCallback((doc: unknown, updatedAt: number) => {
    // Re-check on arrival, not only before the fetch: our own save may have
    // completed while this document was in transit, in which case it is now
    // the older of the two and must not be applied.
    if (updatedAt <= seenUpdatedAt.current) return;
    if (safeJson(doc) === syncedDocJson.current) {
      seenUpdatedAt.current = Math.max(seenUpdatedAt.current, updatedAt);
      return;
    }
    const store = useDashboardStore.getState();
    const keptPresence = store.presence;
    flushPersist();
    store.resetDashboard(doc as never);
    useDashboardStore.getState().adoptPresence(keptPresence);
    seenUpdatedAt.current = Math.max(seenUpdatedAt.current, updatedAt);
    syncedDocJson.current = safeJson(useDashboardStore.getState().doc);
  }, []);

  /**
   * Make sure this tab is on the workspace's report rather than its own.
   * Returns the dashboard id now in use, or null when the workspace is still
   * empty and this tab should keep whatever it has.
   */
  const joinWorkspaceReport = useCallback(
    async (activeStore: WorkspaceStore): Promise<string | null> => {
      // A save in progress owns the document; let it finish.
      if (pushInFlight.current) return currentDashboardId();
      const localId = currentDashboardId();
      const remote = await activeStore.listDashboards();
      const newest = remote[0];
      if (!newest) return null;
      // Same report and nothing newer than what is on screen: nothing to do.
      if (newest.id === localId && newest.updatedAt <= seenUpdatedAt.current) {
        return localId;
      }
      const record = await activeStore.loadDashboard(newest.id);
      if (!record) return null;
      saveDashboardDoc(newest.id, record.doc as never);
      setCurrentDashboard(newest.id);
      applyServerDoc(record.doc, record.updatedAt);
      return newest.id;
    },
    [applyServerDoc],
  );

  /** Adopt the server's document for the dashboard this tab is showing. */
  const adoptServerDoc = useCallback(
    async (activeStore: WorkspaceStore, dashboardId: string) => {
      const record = await activeStore.loadDashboard(dashboardId);
      if (!record) return;
      applyServerDoc(record.doc, record.updatedAt);
    },
    [applyServerDoc],
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
        const identity = await store.identity();
        // An invite link carries only a token, so this is where a joined tab
        // learns which workspace it is actually in, and what to call it.
        if (!cancelled && identity.workspaceId !== session.workspaceId) {
          storeSession({
            ...session,
            workspaceId: identity.workspaceId,
            label: identity.label,
          });
        }
        // Join the workspace's report, not this browser's private one. Two
        // people who follow the same invite link must land on the SAME
        // dashboard or they will never see each other's work — each tab
        // would keep editing whatever its own localStorage last chose.
        if (!cancelled) await joinWorkspaceReport(store);
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
      try {
        // Re-check membership every tick, not once at connect. Someone who
        // opens the invite link BEFORE anyone has saved anything would
        // otherwise sit on their own blank report forever, connected and
        // alone, while the workspace filled up beside them.
        const joined = await joinWorkspaceReport(store);
        const dashboardId = joined ?? currentDashboardId();
        if (!dashboardId) {
          timer = setTimeout(tick, SYNC_POLL_MS);
          return;
        }
        const page = await store.fetchCommands(dashboardId, cursorRef.current);
        if (stopped) return;
        const remote = page.entries.filter((entry) => entry.actor !== me);
        if (remote.length > 0 && !pushInFlight.current) {
          await adoptServerDoc(store, dashboardId);
        }
        if (stopped) return;
        if (page.cursor !== cursorRef.current) setCursor(page.cursor);

        // Pending proposals, decisions and the plan travel separately from
        // the document, because a proposal is not part of the report. This
        // is what lets a DIFFERENT human review what an agent proposed.
        const shared = await store.readSession(dashboardId);
        if (shared && shared.updatedAt > seenSessionAt.current) {
          seenSessionAt.current = shared.updatedAt;
          useDashboardStore
            .getState()
            .adoptPresence(shared.state as PresenceState);
          syncedPresenceJson.current = safeJson(
            useDashboardStore.getState().presence,
          );
        }
        if (stopped) return;
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
  }, [store, state, me, adoptServerDoc, joinWorkspaceReport]);

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
    let lastPresence = useDashboardStore.getState().presence;
    let inFlight = false;

    const push = async () => {
      timer = undefined;
      if (inFlight) return;
      const dashboardId = currentDashboardId();
      if (!dashboardId) return;
      inFlight = true;
      pushInFlight.current = true;
      try {
        const snapshot = useDashboardStore.getState();

        // Never broadcast an empty report. A tab that has just joined holds a
        // blank document for a moment, and publishing it made that blankness
        // the newest thing in the workspace — so the joiner kept selecting
        // its own emptiness and could overwrite the report it came to read.
        // There is nothing to share until there is something in it.
        const hasContent =
          snapshot.doc.pages.length > 1 ||
          snapshot.doc.pages.some((page) => page.tiles.length > 0);
        if (!hasContent) return;

        const docJson = safeJson(snapshot.doc);
        const presenceJson = safeJson(snapshot.presence);
        // Nothing of ours changed: stay quiet rather than restamp the record
        // and wake every other tab up for no reason.
        if (
          docJson === syncedDocJson.current &&
          presenceJson === syncedPresenceJson.current
        ) {
          return;
        }
        const saved = await store.saveDashboard({
          id: dashboardId,
          name: snapshot.doc.title,
          updatedAt: Date.now(),
          doc: snapshot.doc as never,
        });
        // Remember our own stamp, or the next poll would treat this tab's
        // own write as a peer's and reload the report under the user.
        seenUpdatedAt.current = Math.max(seenUpdatedAt.current, saved.updatedAt);
        syncedDocJson.current = docJson;

        // Publish proposals, decisions and the plan so another human can act
        // on them. Same echo guard: our own write must not read back as a
        // peer's and re-adopt under us.
        const publishedSession = await store.writeSession(
          dashboardId,
          snapshot.presence,
        );
        seenSessionAt.current = Math.max(
          seenSessionAt.current,
          publishedSession.updatedAt,
        );
        syncedPresenceJson.current = presenceJson;

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
        pushInFlight.current = false;
      }
    };

    const unsubscribe = useDashboardStore.subscribe((snapshot) => {
      const docChanged = snapshot.doc !== lastDoc;
      const presenceChanged = snapshot.presence !== lastPresence;
      if (!docChanged && !presenceChanged) return;
      lastDoc = snapshot.doc;
      lastPresence = snapshot.presence;
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
