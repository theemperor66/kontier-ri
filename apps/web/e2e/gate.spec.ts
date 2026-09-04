import { expect, test } from "@playwright/test";

/**
 * The gate must never leave a blank page.
 *
 * It used to render nothing until a probe answered, so one slow or hanging
 * request produced an empty screen for as long as it took. "Loads forever" is
 * the worst failure a first screen can have, because there is nothing to
 * read and nothing to press.
 */

test("a hanging workspace API still shows a usable sign-in screen", async ({
  page,
}) => {
  // Never answers. The old gate waited on exactly this.
  await page.route("**/api/workspace/dashboards", () => {
    /* deliberately no fulfil, no abort */
  });

  await page.goto("/");
  await expect(page.getByTestId("signin-guest")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("signin-tenant")).toBeVisible();
});

test("a returning visitor paints the report without waiting for any request", async ({
  page,
  baseURL,
}) => {
  const base = baseURL ?? "http://localhost:3000";
  const created = await page.request.post(`${base}/api/workspace/guest`, {
    data: { label: "gate" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { token, workspaceId } = (await created.json()) as {
    token: string;
    workspaceId: string;
  };
  await page.addInitScript(
    ([t, id]) => {
      window.localStorage.setItem(
        "kontier-ri:ws:session",
        JSON.stringify({ token: t, workspaceId: id, label: "gate", kind: "guest" }),
      );
    },
    [token, workspaceId] as const,
  );
  // Even with every workspace request hanging, a signed-in visitor works.
  await page.route("**/api/workspace/**", () => {});

  await page.goto("/");
  await expect(page.getByTestId("app-rail")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("signin-guest")).toHaveCount(0);
});
