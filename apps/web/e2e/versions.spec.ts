import { expect, test, type Page } from "@playwright/test";

/**
 * Version history: the report can be rolled back to a snapshot, and agent
 * change sets always leave a restore point behind them.
 */

async function loadDemo(page: Page) {
  await page.goto("/");
  const demo = page.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 60_000 });
  await demo.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("a saved version restores the report after later edits", async ({ page }) => {
  await loadDemo(page);

  await page.getByTestId("more-actions").click();
  await page.getByTestId("open-versions").click();
  const dialog = page.getByTestId("version-history");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("save-version").click();
  await expect(dialog.getByTestId("version-entry")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Change the report after the snapshot.
  const title = page.getByLabel("Dashboard title");
  await title.fill("Edited after the snapshot");
  await title.press("Enter");
  const tile = page.getByTestId("tile-demo_kpi_mrr");
  await tile.hover();
  await tile.getByRole("button", { name: /^Remove/ }).click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(7);

  // Restore: the document comes back exactly as saved.
  await page.getByTestId("more-actions").click();
  await page.getByTestId("open-versions").click();
  await page.getByTestId("version-history").getByTestId("restore-version").first().click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8, { timeout: 30_000 });
  await expect(page.getByLabel("Dashboard title")).toHaveValue("SaaS revenue overview");

  // Restoring also snapshots what it replaced, so the edit is not lost.
  await page.getByTestId("more-actions").click();
  await page.getByTestId("open-versions").click();
  await expect(
    page.getByTestId("version-history").getByTestId("version-entry"),
  ).toHaveCount(2);
});
