/**
 * Workspace API route tests.
 *
 * These exercise the real route handlers against the real on-disk store in a
 * temp directory. They exist because the API became the system of record: two
 * humans and two agents now depend on it agreeing with itself about who may
 * read what, and in what order things happened.
 *
 * The two load-bearing properties are workspace isolation and command order.
 * Everything else is a round-trip check.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TOKEN_A = "tok_alpha";
const TOKEN_B = "tok_beta";
const WS_A = "ws_alpha";
const WS_B = "ws_beta";

let dataDir: string;

/** Route modules read process.env at call time, so set it before importing. */
async function loadRoutes() {
  const auth = await import("@/lib/server/auth");
  auth.__resetTokenCache();
  return {
    dashboards: await import("@/app/api/workspace/dashboards/route"),
    dashboard: await import("@/app/api/workspace/dashboards/[id]/route"),
    commands: await import(
      "@/app/api/workspace/dashboards/[id]/commands/route"
    ),
    presence: await import("@/app/api/workspace/presence/route"),
    auth,
  };
}

const ctx = <K extends string>(params: Record<K, string>) => ({
  params: Promise.resolve(params),
});

function req(
  url: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost${url}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
}

const doc = (title: string) => ({
  title,
  pages: [{ id: "p1", name: "Page 1", tiles: [] }],
});

/** PUT body is strict: exactly { name, doc } (lib/server/schemas.ts). */
const record = (_id: string, title: string) => ({
  name: title,
  doc: doc(title),
});

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kri-ws-"));
  process.env.KONTIER_WORKSPACE_DIR = dataDir;
  process.env.KONTIER_WORKSPACE_TOKENS = [
    `${TOKEN_A}:${WS_A}:Alpha team`,
    `${TOKEN_B}:${WS_B}:Beta team`,
  ].join(",");
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.KONTIER_WORKSPACE_TOKENS;
  delete process.env.KONTIER_WORKSPACE_DIR;
});

describe("authentication", () => {
  it("refuses a request with no token", async () => {
    const { dashboards } = await loadRoutes();
    const res = await dashboards.GET(req("/api/workspace/dashboards"));
    expect(res.status).toBe(401);
  });

  it("refuses an unknown token", async () => {
    const { dashboards } = await loadRoutes();
    const res = await dashboards.GET(
      req("/api/workspace/dashboards", { token: "tok_not_real" }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a configured token", async () => {
    const { dashboards } = await loadRoutes();
    const res = await dashboards.GET(
      req("/api/workspace/dashboards", { token: TOKEN_A }),
    );
    expect(res.status).toBe(200);
  });

  it("never leaks the token or the workspace path in an error body", async () => {
    const { dashboards } = await loadRoutes();
    const res = await dashboards.GET(
      req("/api/workspace/dashboards", { token: "tok_not_real" }),
    );
    const text = await res.text();
    expect(text).not.toContain("tok_not_real");
    expect(text).not.toContain(dataDir);
  });
});

describe("workspace isolation", () => {
  it("does not show one workspace's dashboards to another token", async () => {
    const { dashboard, dashboards } = await loadRoutes();

    const write = await dashboard.PUT(
      req("/api/workspace/dashboards/d1", {
        token: TOKEN_A,
        method: "PUT",
        body: record("d1", "Alpha revenue"),
      }),
      ctx({ id: "d1" }),
    );
    expect(write.status).toBeLessThan(300);

    const mine = await dashboards.GET(
      req("/api/workspace/dashboards", { token: TOKEN_A }),
    );
    expect(JSON.stringify(await mine.json())).toContain("Alpha revenue");

    // The other tenant must not see it, and must not 500 either.
    const theirs = await dashboards.GET(
      req("/api/workspace/dashboards", { token: TOKEN_B }),
    );
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(await theirs.json())).not.toContain("Alpha revenue");
  });

  it("does not serve another workspace's dashboard by id", async () => {
    const { dashboard } = await loadRoutes();
    await dashboard.PUT(
      req("/api/workspace/dashboards/secret", {
        token: TOKEN_A,
        method: "PUT",
        body: record("secret", "Alpha secret"),
      }),
      ctx({ id: "secret" }),
    );

    const res = await dashboard.GET(
      req("/api/workspace/dashboards/secret", { token: TOKEN_B }),
      ctx({ id: "secret" }),
    );
    // Not found for them - never the other tenant's document.
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Alpha secret");
  });
});

describe("command order is the server's job", () => {
  it("assigns strictly increasing seq and never rewinds the cursor", async () => {
    const { commands } = await loadRoutes();
    const entry = (label: string) => ({
      by: "human",
      actor: "actor_dana",
      label,
      at: Date.now(),
    });

    const first = await commands.POST(
      req("/api/workspace/dashboards/d1/commands", {
        token: TOKEN_A,
        method: "POST",
        body: { entries: [entry("one"), entry("two")] },
      }),
      ctx({ id: "d1" }),
    );
    expect(first.status).toBe(201);
    const cursor1 = (await first.json()).cursor as number;

    const second = await commands.POST(
      req("/api/workspace/dashboards/d1/commands", {
        token: TOKEN_A,
        method: "POST",
        body: { entries: [entry("three")] },
      }),
      ctx({ id: "d1" }),
    );
    const cursor2 = (await second.json()).cursor as number;
    expect(cursor2).toBeGreaterThan(cursor1);

    const read = await commands.GET(
      req("/api/workspace/dashboards/d1/commands?since=0", { token: TOKEN_A }),
      ctx({ id: "d1" }),
    );
    const page = (await read.json()) as {
      entries: { seq: number; label: string }[];
    };
    expect(page.entries.map((e) => e.label)).toEqual(["one", "two", "three"]);
    const seqs = page.entries.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("gives a second reader everything after its own cursor, and nothing before", async () => {
    const { commands } = await loadRoutes();
    const post = (label: string) =>
      commands.POST(
        req("/api/workspace/dashboards/d1/commands", {
          token: TOKEN_A,
          method: "POST",
          body: {
            entries: [
              { by: "agent", actor: "actor_agent", label, at: Date.now() },
            ],
          },
        }),
        ctx({ id: "d1" }),
      );

    await post("before");
    const mid = await commands.GET(
      req("/api/workspace/dashboards/d1/commands?since=0", { token: TOKEN_A }),
      ctx({ id: "d1" }),
    );
    const cursor = (await mid.json()).cursor as number;
    await post("after");

    const tail = await commands.GET(
      req(`/api/workspace/dashboards/d1/commands?since=${cursor}`, {
        token: TOKEN_A,
      }),
      ctx({ id: "d1" }),
    );
    const page = (await tail.json()) as { entries: { label: string }[] };
    expect(page.entries.map((e) => e.label)).toEqual(["after"]);
  });

  it("keeps each workspace's command stream separate", async () => {
    const { commands } = await loadRoutes();
    await commands.POST(
      req("/api/workspace/dashboards/shared-id/commands", {
        token: TOKEN_A,
        method: "POST",
        body: {
          entries: [
            { by: "human", actor: "actor_dana", label: "alpha only", at: 1 },
          ],
        },
      }),
      ctx({ id: "shared-id" }),
    );

    // Same dashboard id, different tenant: must be an empty stream.
    const res = await commands.GET(
      req("/api/workspace/dashboards/shared-id/commands?since=0", {
        token: TOKEN_B,
      }),
      ctx({ id: "shared-id" }),
    );
    const page = (await res.json()) as { entries: unknown[] };
    expect(page.entries).toEqual([]);
  });
});

describe("presence", () => {
  it("reports the other participant to each caller", async () => {
    const { presence } = await loadRoutes();
    const beat = (actor: string, label: string) =>
      presence.POST(
        req("/api/workspace/presence", {
          token: TOKEN_A,
          method: "POST",
          body: { actor, label, dashboardId: "d1" },
        }),
      );

    await beat("actor_one", "Dana");
    const res = await beat("actor_two", "Sam");
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain("Dana");
    expect(body).toContain("Sam");
  });
});
