/**
 * Guest workspace tests.
 *
 * The guest path is the front door: no account, one button, and the invite
 * link is the credential. That makes it the only unauthenticated route that
 * allocates disk, so these tests care as much about the refusals as the
 * happy path.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir: string;

async function load() {
  const guests = await import("@/lib/server/guests");
  const auth = await import("@/lib/server/auth");
  guests.__resetGuestRateLimit();
  auth.__resetTokenCache();
  return {
    guests,
    auth,
    route: await import("@/app/api/workspace/guest/route"),
    dashboard: await import("@/app/api/workspace/dashboards/[id]/route"),
    dashboards: await import("@/app/api/workspace/dashboards/route"),
  };
}

const post = (body?: unknown) =>
  new Request("http://localhost/api/workspace/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kri-guest-"));
  process.env.KONTIER_WORKSPACE_DIR = dataDir;
  delete process.env.KONTIER_WORKSPACE_TOKENS;
  delete process.env.KONTIER_WORKSPACE_GUESTS;
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.KONTIER_WORKSPACE_DIR;
  delete process.env.KONTIER_WORKSPACE_GUESTS;
});

describe("creating a guest workspace", () => {
  it("works with no tenant tokens configured at all", async () => {
    // The public demo serves guests only. That deployment must be functional,
    // not "not configured".
    const { route, auth } = await load();
    expect(auth.isWorkspaceApiConfigured()).toBe(true);
    const res = await route.POST(post({ label: "Dana's review" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; workspaceId: string; label: string };
    expect(body.token).toMatch(/^gst_/);
    expect(body.workspaceId).toMatch(/^guest_/);
    expect(body.label).toBe("Dana's review");
  });

  it("accepts a missing body and names the workspace honestly", async () => {
    const { route } = await load();
    const res = await route.POST(
      new Request("http://localhost/api/workspace/guest", { method: "POST" }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).label).toBe("Guest workspace");
  });

  it("never returns the same token or workspace id twice", async () => {
    const { route } = await load();
    const tokens = new Set<string>();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const body = (await (await route.POST(post())).json()) as {
        token: string;
        workspaceId: string;
      };
      tokens.add(body.token);
      ids.add(body.workspaceId);
    }
    expect(tokens.size).toBe(5);
    expect(ids.size).toBe(5);
  });

  it("stores only a digest, so the file is not a list of live credentials", async () => {
    const { route } = await load();
    const body = (await (await route.POST(post())).json()) as { token: string };
    const raw = fs.readFileSync(path.join(dataDir, "guests.json"), "utf8");
    expect(raw).not.toContain(body.token);
    expect(raw).toContain("digest");
  });

  it("refuses when guests are turned off", async () => {
    process.env.KONTIER_WORKSPACE_GUESTS = "off";
    const { route } = await load();
    const res = await route.POST(post());
    expect(res.status).toBe(503);
  });

  it("rate-limits creation", async () => {
    const { route, guests } = await load();
    for (let i = 0; i < guests.GUEST_CREATE_LIMIT; i += 1) {
      expect((await route.POST(post())).status).toBe(201);
    }
    const res = await route.POST(post());
    expect(res.status).toBe(429);
  });
});

describe("a guest link is a credential", () => {
  it("authenticates the holder into its own workspace and nobody else's", async () => {
    const { route, dashboard, dashboards } = await load();

    const dana = (await (await route.POST(post({ label: "Dana" }))).json()) as {
      token: string;
    };
    const sam = (await (await route.POST(post({ label: "Sam" }))).json()) as {
      token: string;
    };

    const write = await dashboard.PUT(
      new Request("http://localhost/api/workspace/dashboards/d1", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${dana.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Dana churn", doc: { title: "Dana churn" } }),
      }),
      { params: Promise.resolve({ id: "d1" }) },
    );
    expect(write.status).toBeLessThan(300);

    const danaSees = await dashboards.GET(
      new Request("http://localhost/api/workspace/dashboards", {
        headers: { Authorization: `Bearer ${dana.token}` },
      }),
    );
    expect(JSON.stringify(await danaSees.json())).toContain("Dana churn");

    // Sam holds a valid guest token for a DIFFERENT workspace.
    const samSees = await dashboards.GET(
      new Request("http://localhost/api/workspace/dashboards", {
        headers: { Authorization: `Bearer ${sam.token}` },
      }),
    );
    expect(samSees.status).toBe(200);
    expect(JSON.stringify(await samSees.json())).not.toContain("Dana churn");
  });

  it("lets two holders of the SAME link share one workspace", async () => {
    // This is the collaboration primitive: the link is the workspace.
    const { route, dashboard, dashboards } = await load();
    const created = (await (await route.POST(post({ label: "Shared" }))).json()) as {
      token: string;
    };

    await dashboard.PUT(
      new Request("http://localhost/api/workspace/dashboards/shared", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${created.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Shared report", doc: { title: "Shared report" } }),
      }),
      { params: Promise.resolve({ id: "shared" }) },
    );

    // A second person, same link, no account.
    const second = await dashboards.GET(
      new Request("http://localhost/api/workspace/dashboards", {
        headers: { Authorization: `Bearer ${created.token}` },
      }),
    );
    expect(JSON.stringify(await second.json())).toContain("Shared report");
  });

  it("rejects a token that was never issued", async () => {
    const { dashboards } = await load();
    const res = await dashboards.GET(
      new Request("http://localhost/api/workspace/dashboards", {
        headers: { Authorization: "Bearer gst_not_a_real_token" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an expired guest token", async () => {
    const { guests } = await load();
    const created = guests.createGuestWorkspace("Old", Date.now());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const later = Date.now() + guests.GUEST_TTL_MS + 1;
    expect(guests.findGuestWorkspace(created.guest.token, later)).toBeNull();
  });
});
