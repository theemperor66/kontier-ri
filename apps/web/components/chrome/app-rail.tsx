"use client";

import { useState } from "react";

/**
 * Navigation rail (product design: 256px navy column). Every entry maps to a
 * surface this build can actually render from live state — no placeholder
 * destinations, and no invented agent identities.
 */

import {
  CaretUpDown,
  ChartBar,
  CheckSquareOffset,
  Database,
  Graph,
  Plus,
  Pulse,
  Scroll,
  SquaresFour,
  ArrowsLeftRight,
  SignOut,
} from "@phosphor-icons/react";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { useUiState, type WorkspaceView } from "@/lib/ui-state";
import { useWebMCPRegistry } from "@/lib/webmcp-registry";
import { useWorkspace } from "@/lib/workspace-sync";
import { clearSession } from "@/lib/workspace-session";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";

interface NavItem {
  view: WorkspaceView;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const PRIMARY: NavItem[] = [
  { view: "home", label: "Home", Icon: SquaresFour },
  { view: "canvas", label: "Reports", Icon: ChartBar },
  { view: "approvals", label: "Approvals", Icon: CheckSquareOffset },
];

const ANALYZE: NavItem[] = [
  { view: "datasets", label: "Datasets", Icon: Database },
  { view: "model", label: "Semantic model", Icon: Graph },
];

const GOVERN: NavItem[] = [
  { view: "governance", label: "Data health", Icon: Pulse },
  { view: "audit", label: "Audit log", Icon: Scroll },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-white/45">
      {children}
    </div>
  );
}

function RailButton({
  item,
  badge,
}: {
  item: NavItem;
  badge?: number;
}) {
  const view = useUiState((s) => s.view);
  const setView = useUiState((s) => s.setView);
  const active = view === item.view;
  return (
    <button
      type="button"
      data-testid={`rail-${item.view}`}
      aria-current={active ? "page" : undefined}
      onClick={() => setView(item.view)}
      className={cn(
        "flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
        active
          ? "bg-white/10 text-white"
          : "text-white/70 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <item.Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-primary px-[7px] py-px text-[11px] font-semibold text-primary-foreground">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function AgentRuntimeRows() {
  const { runtimeAvailable, readyCount, registeringCount, failedTools } =
    useWebMCPRegistry();
  const failed = failedTools.length > 0;
  const state = failed
    ? "error"
    : runtimeAvailable && readyCount > 0
      ? "connected"
      : registeringCount > 0
        ? "connecting"
        : "offline";

  return (
    <div className="flex h-9 items-center gap-3 px-3 text-sm text-white/70">
      <span
        className={cn(
          "mx-0.5 size-2 shrink-0 rounded-full",
          state === "connected"
            ? "bg-ok"
            : state === "error"
              ? "bg-danger"
              : state === "connecting"
                ? "animate-pulse bg-warn"
                : "bg-white/25",
        )}
      />
      <span className="min-w-0 flex-1 truncate">
        {state === "offline" ? "No agent connected" : "Browser agent"}
      </span>
      <span className="shrink-0 text-[11px] text-white/45">
        {state === "connected"
          ? `${readyCount} tools`
          : state === "error"
            ? "error"
            : state === "connecting"
              ? "…"
              : "Web MCP"}
      </span>
    </div>
  );
}

export function AppRail() {
  const setView = useUiState((s) => s.setView);
  const setTemplatesOpen = useUiState((s) => s.setTemplatesOpen);
  const railCollapsed = useUiState((s) => s.railCollapsed);
  const title = useDashboardStore((s) => s.doc.title);
  const pendingApprovals = useDashboardStore(
    (s) =>
      s.presence.insights.filter((insight) => insight.state === "proposed").length +
      s.presence.decisions.filter((decision) => decision.status === "pending").length +
      s.presence.changeSets.filter((set) => set.status === "proposed").length,
  );
  const { status } = useDataSource();
  const setSignInOpen = useUiState((s) => s.setSignInOpen);
  const { session, state, others } = useWorkspace();

  // Name the room you are in, not the product. "Kontier RI" is on every
  // screen; which workspace this is, is not.
  const workspaceName = session
    ? session.kind === "tenant"
      ? session.label.replace(/^Kontier · /, "")
      : "Guest workspace"
    : "Kontier RI";

  // The engine line used to read "Local engine live" on a server-backed
  // workspace, which was true of DuckDB and false of the product. Say what
  // the workspace is doing; the query engine is an implementation detail.
  const engineTone =
    status === "error" || state === "error"
      ? "danger"
      : status === "ready" && (state === "live" || !session)
        ? "ok"
        : "warn";
  const engineLabel =
    status === "error"
      ? "Engine error"
      : status !== "ready"
        ? "Starting engine"
        : !session
          ? "This browser only"
          : state === "live"
            ? others.length > 0
              ? `Live · ${others.length + 1} here`
              : "Live"
            : state === "error"
              ? "Workspace offline"
              : "Connecting…";

  if (railCollapsed) return null;

  return (
    <nav
      data-testid="app-rail"
      aria-label="Workspace"
      className="flex min-h-0 w-64 shrink-0 flex-col bg-nav text-white"
    >
      {/* Workspace switcher. The mark is the platform's own favicon, not a
          letter set in the UI font — Kontier RI is part of Kontier, and two
          different "k"s in one tab strip say otherwise. */}
      <button
        type="button"
        data-testid="workspace-switcher"
        onClick={() => setSignInOpen(true)}
        aria-label="Switch workspace"
        className="flex cursor-pointer items-center gap-3 px-5 pb-[18px] pt-5 text-left transition-colors hover:bg-white/[0.04]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={withBasePath("/icon.svg")}
          alt=""
          width={36}
          height={36}
          className="size-9 shrink-0 rounded-[10px]"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">
            {workspaceName}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-white/60">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                engineTone === "ok"
                  ? "bg-ok"
                  : engineTone === "danger"
                    ? "bg-danger"
                    : "bg-warn",
              )}
            />
            <span className="truncate">{engineLabel}</span>
          </span>
        </span>
        <CaretUpDown className="size-4 shrink-0 text-white/50" />
      </button>

      <div className="px-4 pb-3.5">
        <button
          type="button"
          data-testid="rail-create"
          onClick={() => {
            setView("canvas");
            setTemplatesOpen(true);
          }}
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-white/15 bg-white/[0.06] text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          <Plus className="size-4" />
          Create new
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {PRIMARY.map((item) => (
          <RailButton
            key={item.view}
            item={item}
            {...(item.view === "approvals" ? { badge: pendingApprovals } : {})}
          />
        ))}
        <div className="mx-1 my-2.5 h-px bg-nav-line" />
        <SectionLabel>Analyze</SectionLabel>
        {ANALYZE.map((item) => (
          <RailButton key={item.view} item={item} />
        ))}
        <SectionLabel>Govern</SectionLabel>
        {GOVERN.map((item) => (
          <RailButton key={item.view} item={item} />
        ))}
        <SectionLabel>Agents</SectionLabel>
        <AgentRuntimeRows />
      </div>

      <RailAccount />
    </nav>
  );
}

/**
 * Who you are, and the way out.
 *
 * A rail that ends in "Local session" tells the user nothing and gives them
 * nowhere to go. This names the identity the workspace actually holds and
 * puts sign-out where every product puts it.
 */
function RailAccount() {
  const { session } = useWorkspace();
  const setSignInOpen = useUiState((s) => s.setSignInOpen);
  const [open, setOpen] = useState(false);

  const name = session
    ? session.kind === "tenant"
      ? session.label.replace(/^Kontier · /, "")
      : "Guest"
    : "Not signed in";
  const detail = session
    ? session.kind === "tenant"
      ? "Signed in with Kontier"
      : "Anyone with the link"
    : "Choose a workspace";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="relative border-t border-nav-line px-3 py-3">
      {open ? (
        <div
          className="absolute inset-x-3 bottom-[calc(100%-6px)] z-20 overflow-hidden rounded-[10px] border border-white/10 bg-nav shadow-2xl"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="rail-switch-workspace"
            className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-white/85 transition-colors hover:bg-white/[0.06]"
            onClick={() => {
              setOpen(false);
              setSignInOpen(true);
            }}
          >
            <ArrowsLeftRight className="size-3.5" /> Switch workspace
          </button>
          {session ? (
            <button
              type="button"
              role="menuitem"
              data-testid="rail-sign-out"
              className="flex w-full cursor-pointer items-center gap-2 border-t border-white/10 px-3.5 py-2.5 text-left text-[13px] text-white/85 transition-colors hover:bg-white/[0.06]"
              onClick={() => {
                clearSession();
                // Full reload: every store in the tab holds data belonging to
                // the workspace being left.
                window.location.assign("/");
              }}
            >
              <SignOut className="size-3.5" /> Sign out
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        data-testid="rail-account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value: boolean) => !value)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-accent-mid">
          {initials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-[12.5px] text-white/50">{detail}</span>
        </span>
        <CaretUpDown className="size-3.5 shrink-0 text-white/40" />
      </button>
    </div>
  );
}
