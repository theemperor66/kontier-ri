import { expect, test } from "@playwright/test";
import { startGuestSession } from "./helpers/session";

/**
 * 100M-row scale proof (docs/ENGINEERING-PLAN.md §E1).
 *
 * NETWORK DEPENDENCY: this spec talks to the real dataset host
 * (https://theemperor66.github.io/kontier-scale-data — 24 hive-partitioned
 * parquet files, 100,000,000 rows). DuckDB-WASM range-reads footers + the
 * row groups each tile needs, so the test moves tens of MB, not 511 MB.
 * Timeouts are generous accordingly.
 */

test("scale button registers the remote 100M-row dataset and renders 3 live tiles", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await startGuestSession(page, undefined);

  await page.goto("/");

  // DuckDB-WASM boot + demo CSV seed gate the whole empty state.
  const scaleButton = page.getByTestId("load-scale-demo");
  await expect(scaleButton).toBeEnabled({ timeout: 60_000 });
  await scaleButton.click();

  // Registration runs a real remote count(*) before any tile appears.
  await expect(page.locator("[data-tile-type=chart]")).toHaveCount(3, {
    timeout: 120_000,
  });

  // Honest copy: the tile title carries the count(*) result, not a slogan.
  await expect(page.getByTestId("tile-scale_tile_events")).toContainText(
    "100,000,000",
  );

  // All three tiles render real query results (line path + bar rects).
  await expect(
    page.locator("[data-testid=tile-scale_tile_events] .recharts-line-curve"),
  ).toHaveCount(1, { timeout: 180_000 });
  await expect(
    page
      .locator("[data-testid=tile-scale_tile_revenue] .recharts-bar-rectangle")
      .first(),
  ).toBeVisible({ timeout: 180_000 });
  await expect(
    page
      .locator("[data-testid=tile-scale_tile_failrate] .recharts-bar-rectangle")
      .first(),
  ).toBeVisible({ timeout: 180_000 });

  // 10 countries, 4 gateways — the bars come from data, not placeholders.
  await expect(
    page.locator("[data-testid=tile-scale_tile_revenue] .recharts-bar-rectangle"),
  ).toHaveCount(10);
  await expect(
    page.locator("[data-testid=tile-scale_tile_failrate] .recharts-bar-rectangle"),
  ).toHaveCount(4);

  expect(pageErrors).toEqual([]);
});
