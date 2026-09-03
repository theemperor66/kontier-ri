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
  await expect(page.locator("body")).toContainText("The link is the only key");
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

test("the Kontier tenant button puts everyone in the same shared workspace", async ({
  page,
}) => {
  await page.goto("/");
  const response = await page.request.post("/api/workspace/tenant");
  if (response.status() === 503) {
    test.skip(true, "No demo tenant configured on this deployment.");
  }
  expect(response.status()).toBe(200);
  const tenant = (await response.json()) as { workspaceId: string; kind: string };
  expect(tenant.kind).toBe("tenant");

  await page.getByTestId("signin-tenant").click();
  await expect(page.getByTestId("load-demo")).toBeVisible({ timeout: 60_000 });
  const session = await page.evaluate(() =>
    window.localStorage.getItem("kontier-ri:ws:session"),
  );
  // Everyone who presses it lands in the SAME room - that is the point.
  expect(JSON.parse(session ?? "{}").workspaceId).toBe(tenant.workspaceId);
});
