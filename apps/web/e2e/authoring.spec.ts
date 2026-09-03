import { expect, test, type Page } from "@playwright/test";
import { startGuestSession } from "./helpers/session";

/**
 * Guided authoring: the human path to a new tile mirrors the agent's. The
 * dialog previews the real renderer against live DuckDB data, then commits
 * through the same attributed, undoable command layer.
 */

async function loadDemo(page: Page) {
  await startGuestSession(page, undefined);
  await page.goto("/");
  const demo = page.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 60_000 });
  await demo.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("Add visual previews a live tile and commits it as one undoable command", async ({
  page,
}) => {
  await loadDemo(page);

  await page.getByTestId("add-visual").click();
  const dialog = page.getByTestId("add-visual-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("add-visual-dataset").selectOption("invoices");
  await dialog.getByTestId("add-visual-kind-bar").click();
  await dialog.getByTestId("add-visual-dimension").selectOption("month");
  await dialog.getByTestId("add-visual-measure").selectOption("amount_eur");
  await dialog.getByTestId("add-visual-agg").selectOption("sum");

  // The preview runs the real query through DuckDB before anything is added.
  await expect(dialog.locator(".recharts-bar-rectangle").first()).toBeVisible({
    timeout: 30_000,
  });

  await dialog.getByTestId("add-visual-title").fill("Invoiced revenue by month");
  await dialog.getByTestId("add-visual-submit").click();
  await expect(dialog).toHaveCount(0);

  const added = page.locator("[data-tile-type=chart]", {
    hasText: "Invoiced revenue by month",
  });
  await expect(added).toHaveCount(1);
  await expect(page.locator("[data-tile-type]")).toHaveCount(9);

  // One human command: undo removes exactly the new tile.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
  await expect(added).toHaveCount(0);
});
