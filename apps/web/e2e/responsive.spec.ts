import { expect, test } from "@playwright/test";

test("mobile becomes a readable review surface instead of a compressed desktop grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Start an investigation" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    )
    .toBe(true);

  const demo = page.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 60_000 });
  await demo.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);

  const rail = page.getByTestId("collaboration-rail");
  await expect(rail).toHaveAttribute("aria-hidden", "false");
  await rail.getByRole("button", { name: "Close agent workspace" }).click();
  await expect(rail).toHaveAttribute("aria-hidden", "true");

  const canvas = page.getByTestId("grid-canvas");
  await expect(canvas).toHaveAttribute("data-layout-mode", "stacked");

  // On a phone every tile owns the full width and the band reads top to
  // bottom — a two-across KPI row squeezes the metric name at 390px.
  const kpis = page.locator("[data-tile-type=kpi]");
  const first = await kpis.nth(0).boundingBox();
  const second = await kpis.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first!.width).toBeGreaterThan(320);
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 2);
  // Full metric names survive: no clipped KPI title.
  await expect(kpis.nth(1)).toContainText("Active subscriptions");

  // A wider tablet-ish viewport still pairs the KPI band before the desktop
  // editor takes over at 720px.
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(500);
  const wideFirst = await kpis.nth(0).boundingBox();
  const wideSecond = await kpis.nth(1).boundingBox();
  expect(Math.abs(wideFirst!.y - wideSecond!.y)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);

  const chart = await page.locator("[data-tile-type=chart]").first().boundingBox();
  expect(chart).not.toBeNull();
  expect(chart!.width).toBeGreaterThan(350);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    )
    .toBe(true);

  // Pages move to their own scrollable row instead of forcing top-bar actions
  // outside the viewport.
  await expect(page.locator('[data-testid="page-tabs"]:visible')).toBeVisible();
  await expect(page.getByTestId("agent-workspace-button")).toBeVisible();
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
});
