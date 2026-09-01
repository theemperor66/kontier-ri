import { expect, test, type Page } from "@playwright/test";

/**
 * Component interaction pack e2e: direct manipulation on tiles.
 * - legend toggle / shift-isolate (session state, not in the doc)
 * - table header sort round-trip (ORDER BY re-query)
 * - mark context menu Keep only + undo (setTileFilters, origin human)
 * - temporal granularity select (strftime rewrite via updateTile)
 * - donut slice legend with session persistence across page switches
 */

async function loadDemo(page: Page) {
  await page.goto("/");
  const demoButton = page.getByTestId("load-demo");
  await expect(demoButton).toBeEnabled({ timeout: 60_000 });
  await demoButton.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("legend click toggles a series, shift-click isolates; session-only (no activity entry)", async ({
  page,
}) => {
  await loadDemo(page);
  await page.getByTestId("page-tab-demo_page_growth").click();
  const combo = page.getByTestId("tile-demo_chart_combo");
  await expect(combo.locator(".recharts-line-curve")).toHaveCount(1, {
    timeout: 30_000,
  });
  const barsBefore = await combo.locator(".recharts-bar-rectangle").count();
  expect(barsBefore).toBeGreaterThan(0);

  const legend = combo.locator("[role=group][aria-label='Toggle series']");
  const countItem = legend.getByRole("button", { name: /Count/ });
  const amountItem = legend.getByRole("button", { name: /Amount/ });

  // Click hides the series; the item dims (aria-pressed=false).
  await countItem.click();
  await expect(combo.locator(".recharts-line-curve")).toHaveCount(0);
  await expect(countItem).toHaveAttribute("aria-pressed", "false");
  await countItem.click();
  await expect(combo.locator(".recharts-line-curve")).toHaveCount(1);

  // Shift-click isolates: every OTHER series hides.
  await countItem.click({ modifiers: ["Shift"] });
  await expect(combo.locator(".recharts-bar-rectangle")).toHaveCount(0);
  await expect(combo.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(amountItem).toHaveAttribute("aria-pressed", "false");
  // Shift-click the isolated series again: everything returns.
  await countItem.click({ modifiers: ["Shift"] });
  await expect(combo.locator(".recharts-bar-rectangle")).toHaveCount(barsBefore);

  // Session-only: legend toggles never reach the activity feed.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Toggle activity feed" }).click();
  const feed = page.getByTestId("activity-feed");
  await expect(feed).toBeVisible();
  await expect(feed).not.toContainText("Count");
  await expect(feed).not.toContainText("legend");
});

test("table header sort cycles asc -> desc -> none with ORDER BY re-query", async ({
  page,
}) => {
  await loadDemo(page);
  const table = page.getByTestId("tile-demo_table_failed");
  await expect(table).toContainText("1/25", { timeout: 30_000 });

  const amountHeader = table.getByRole("button", { name: /^Amount/ });
  const amountTh = table.locator("th").nth(2);
  const amounts = async () => {
    const cells = await table
      .locator("tbody tr td:nth-child(3)")
      .allInnerTexts();
    return cells.map((t) => Number(t.replace(/[^0-9.-]/g, "")));
  };

  await amountHeader.click();
  await expect(amountTh).toHaveAttribute("aria-sort", "ascending");
  await expect
    .poll(async () => {
      const a = await amounts();
      return a.every((v, i) => i === 0 || a[i - 1]! <= v);
    })
    .toBe(true);
  // Whole-result sort (server-side ORDER BY), not a page-local sort.
  await expect(table.getByText("page sorted")).toHaveCount(0);

  await amountHeader.click();
  await expect(amountTh).toHaveAttribute("aria-sort", "descending");
  await expect
    .poll(async () => {
      const a = await amounts();
      return a.every((v, i) => i === 0 || a[i - 1]! >= v);
    })
    .toBe(true);

  await amountHeader.click();
  await expect(amountTh).toHaveAttribute("aria-sort", "none");
});

test("mark context menu: Keep only filters the tile; undo restores it", async ({
  page,
}) => {
  await loadDemo(page);
  const churn = page.getByTestId("tile-demo_chart_churn");
  await expect(
    churn.locator(".recharts-bar-rectangle").first(),
  ).toBeVisible({ timeout: 30_000 });
  const before = await churn.locator(".recharts-bar-rectangle").count();
  expect(before).toBeGreaterThan(5);

  const box = (await churn.locator(".recharts-surface").first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6, {
    button: "right",
  });
  const menu = page.getByTestId("mark-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("month");
  await menu.getByRole("menuitem", { name: /^Keep only/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(churn.locator(".recharts-bar-rectangle")).toHaveCount(1, {
    timeout: 30_000,
  });

  // setTileFilters went through the command layer: Cmd+Z restores.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(churn.locator(".recharts-bar-rectangle")).toHaveCount(before, {
    timeout: 30_000,
  });
});

test("temporal granularity select re-bins months into quarters (undoable)", async ({
  page,
}) => {
  await loadDemo(page);
  const churn = page.getByTestId("tile-demo_chart_churn");
  await expect(
    churn.locator(".recharts-bar-rectangle").first(),
  ).toBeVisible({ timeout: 30_000 });
  const before = await churn.locator(".recharts-bar-rectangle").count();

  await churn.hover();
  const select = churn.locator("select[aria-label^='Time granularity']");
  await expect(select).toHaveValue("month");
  await select.selectOption("quarter");

  // Fewer bars, and the x axis now shows quarter labels (2025-Q1 ...).
  await expect
    .poll(() => churn.locator(".recharts-bar-rectangle").count(), {
      timeout: 30_000,
    })
    .toBeLessThan(before);
  await expect(
    churn.locator(".recharts-cartesian-axis-tick-value", {
      hasText: /-Q\d/,
    }).first(),
  ).toBeVisible();

  // updateTile (origin human) is undoable.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(churn.locator(".recharts-bar-rectangle")).toHaveCount(before, {
    timeout: 30_000,
  });
});

test("donut slice legend hides slices and persists across page switches (session state)", async ({
  page,
}) => {
  await loadDemo(page);
  await page.getByTestId("page-tab-demo_page_growth").click();
  const donut = page.getByTestId("tile-demo_chart_donut");
  await expect(donut.locator(".recharts-pie-sector")).toHaveCount(4, {
    timeout: 30_000,
  });

  const slices = donut.locator("[role=group][aria-label='Toggle slices'] button");
  await slices.first().click();
  await expect(donut.locator(".recharts-pie-sector")).toHaveCount(3);

  // Session state keyed by tile: survives leaving and re-entering the page.
  await page.getByTestId("page-tab-demo_page_overview").click();
  await page.getByTestId("page-tab-demo_page_growth").click();
  await expect(donut.locator(".recharts-pie-sector")).toHaveCount(3, {
    timeout: 30_000,
  });
  await slices.first().click();
  await expect(donut.locator(".recharts-pie-sector")).toHaveCount(4);
});
