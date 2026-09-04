import { expect, test } from "@playwright/test";

/**
 * The first thing a stranger sees.
 *
 * This product is a shared investigation workspace. A visitor who lands in a
 * browser-local report has been shown the wrong product, and their work is
 * stranded where nobody — including them, tomorrow, on another machine — can
 * reach it. So the first screen asks which workspace, and this test is the
 * one that would have caught it being skipped.
 */

test("a first-time visitor is asked to choose a workspace, not dropped into a local one", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("signin-guest")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("signin-tenant")).toBeVisible();
  await expect(page.getByTestId("signin-paste")).toBeVisible();

  // The report must NOT be behind it.
  await expect(page.getByTestId("load-demo")).toHaveCount(0);
  await expect(page.locator("[data-tile-type]")).toHaveCount(0);

  // And the consequence of a guest workspace is stated before one exists.
  await expect(page.locator("body")).toContainText("that link is the only key");
});

test("choosing a guest workspace lands in a real, server-backed report", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("signin-guest").click();

  // Straight into the product, in a workspace the server knows about.
  await expect(page.getByTestId("load-demo")).toBeVisible({ timeout: 60_000 });
  const session = await page.evaluate(() =>
    window.localStorage.getItem("kontier-ri:ws:session"),
  );
  expect(session).toBeTruthy();
  const parsed = JSON.parse(session ?? "{}") as { token?: string; workspaceId?: string };
  expect(parsed.token).toMatch(/^gst_/);
  expect(parsed.workspaceId).toMatch(/^guest_/);

  // The workspace is live, not a local pretence.
  await expect(page.getByTestId("share-workspace")).toBeVisible();
});

test("the shared demo workspace puts everyone in the same room", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.post("/api/workspace/tenant");
  if (response.status() === 503) {
    test.skip(true, "No demo workspace configured on this deployment.");
  }
  expect(response.status()).toBe(200);
  const tenant = (await response.json()) as { workspaceId: string; kind: string };
  expect(tenant.kind).toBe("tenant");

  await page.getByTestId("signin-demo").click();
  await expect(page.getByTestId("load-demo")).toBeVisible({ timeout: 60_000 });
  const session = await page.evaluate(() =>
    window.localStorage.getItem("kontier-ri:ws:session"),
  );
  // Everyone who opens it lands in the SAME room - that is the point.
  expect(JSON.parse(session ?? "{}").workspaceId).toBe(tenant.workspaceId);
});

test("Sign in with Kontier starts a real OIDC round trip against Keycloak", async ({
  page,
}) => {
  await page.goto("/");
  // Do not follow the redirect to a live identity provider in a test; assert
  // that the request we would make is the correct one. A wrong client id,
  // a missing PKCE challenge or a plain response_type would all be silent
  // failures that only show up in front of a real user.
  await page.route("https://auth.kontier.eu/**", (route) => route.abort());
  const navigation = page.waitForRequest(
    (request) => request.url().includes("auth.kontier.eu"),
    { timeout: 30_000 },
  );
  await page.getByTestId("signin-tenant").click();
  const url = new URL((await navigation).url());

  expect(url.origin + url.pathname).toBe(
    "https://auth.kontier.eu/realms/kontier/protocol/openid-connect/auth",
  );
  expect(url.searchParams.get("client_id")).toBe("kontier-web");
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")?.length ?? 0).toBeGreaterThan(20);
  expect(url.searchParams.get("scope")).toContain("openid");
  expect(url.searchParams.get("scope")).toContain("email");
  // Only scopes this realm actually grants. Asking for one it does not have
  // — `organization` was in the import file but not on the server — fails the
  // whole request with invalid_scope, which is how this was found.
  expect(url.searchParams.get("scope")).not.toContain("organization");
  expect(url.searchParams.get("redirect_uri")).toContain("/auth/callback");
  expect(url.searchParams.get("state")?.length ?? 0).toBeGreaterThan(10);
  expect(url.searchParams.get("nonce")?.length ?? 0).toBeGreaterThan(10);
});
