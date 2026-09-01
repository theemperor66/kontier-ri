import { expect, test, type Page } from "@playwright/test";

/**
 * Chrome e2e (U4/U5/U6): top-bar regroup (Share + overflow menus), menu
 * keyboard behavior, theme toggle without errors, aria-live agent
 * announcer, and drop-compaction + alignment guides on the grid.
 */

const MOCK_MODEL_CONTEXT = `
  window.__registeredTools = new Map();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool(tool, options) {
        window.__registeredTools.set(tool.name, tool);
        if (options && options.signal) {
          options.signal.addEventListener("abort", () => {
            window.__registeredTools.delete(tool.name);
          });
        }
        return Promise.resolve();
      },
    },
  });
`;

async function waitReady(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("load-demo")).toBeEnabled({ timeout: 60_000 });
}

async function loadDemo(page: Page) {
  await waitReady(page);
  await page.getByTestId("load-demo").click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("top bar groups: Share menu, overflow menu, Escape + outside click close", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await waitReady(page);

  // Share ▾ groups link/PNG/JSON.
  await page.getByTestId("share-menu").click();
  const shareMenu = page.getByRole("menu", { name: "Share" });
  await expect(shareMenu).toBeVisible();
  await expect(
    shareMenu.getByRole("menuitem", { name: "Copy share link" }),
  ).toBeVisible();
  await expect(
    shareMenu.getByRole("menuitem", { name: "Export as PNG" }),
  ).toBeVisible();
  await expect(
    shareMenu.getByRole("menuitem", { name: "Export as JSON" }),
  ).toBeVisible();

  // Escape closes and restores focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(shareMenu).toHaveCount(0);
  await expect(page.getByTestId("share-menu")).toBeFocused();

  // Overflow ••• holds upload / dashboards / presentation / theme / activity.
  await page.getByRole("button", { name: "More actions" }).click();
  const moreMenu = page.getByRole("menu", { name: "More actions" });
  await expect(moreMenu).toBeVisible();
  for (const name of [
    "Upload data",
    "Manage dashboards",
    "Presentation mode",
    "Toggle theme",
    "Toggle activity feed",
  ]) {
    await expect(moreMenu.getByRole("menuitem", { name })).toBeVisible();
  }

  // Outside click closes (far-left canvas padding — nothing interactive).
  await page.mouse.click(30, 300);
  await expect(moreMenu).toHaveCount(0);

  // Activity feed opens from the overflow menu.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Toggle activity feed" }).click();
  await expect(page.getByTestId("activity-feed")).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("theme toggles from the overflow menu without flash-of-error; class flips", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await waitReady(page);

  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/, {
    timeout: 5_000,
  });
  // And back.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/, { timeout: 5_000 });

  expect(pageErrors).toEqual([]);
});

test("aria-live announcer narrates agent tile adds", async ({ page }) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  const announcer = page.getByTestId("agent-announcer");
  await expect(announcer).toHaveText("");

  const result = await page.evaluate(async () => {
    const tools = (
      window as never as {
        __registeredTools: Map<
          string,
          { execute: (i: unknown, o: { signal: AbortSignal }) => Promise<unknown> }
        >;
      }
    ).__registeredTools;
    return tools.get("add_tile")!.execute(
      {
        type: "kpi",
        title: "Announced KPI",
        spec: { dataset: "charges", measure: "*", agg: "count", format: "number" },
      },
      { signal: new AbortController().signal },
    );
  });
  expect(result).toMatchObject({ ok: true });

  await expect(announcer).toContainText('Kai added kpi tile "Announced KPI"');
});

test("drop compaction packs a tile upward; alignment guides show while dragging", async ({
  page,
}) => {
  await loadDemo(page);

  // Free rows 2-7 in columns 0-7 by removing the big MRR chart.
  const chart = page.getByTestId("tile-demo_chart_mrr");
  await chart.hover();
  await chart.getByRole("button", { name: /^Remove/ }).click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(7);

  const tile = page.getByTestId("tile-demo_kpi_mrr");
  await expect(tile).toBeVisible();
  const before = await tile.boundingBox();
  expect(before).not.toBeNull();

  // Drag the KPI by its header ~4 rows down into the freed void, release:
  // gravity pulls it back up through the free space to its packed spot
  // (y=0 again — the space it vacated is free too).
  const handle = tile.locator(".cursor-grab").first();
  const hb = await handle.boundingBox();
  expect(hb).not.toBeNull();
  const startX = hb!.x + hb!.width / 2;
  const startY = hb!.y + hb!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in steps so pointermove previews (and guides) render.
  await page.mouse.move(startX, startY + 150, { steps: 6 });
  await page.mouse.move(startX, startY + 270, { steps: 6 });
  // While dragging in-column, alignment guides light up (x=0 is shared).
  await expect(page.getByTestId("snap-guide").first()).toBeVisible();
  await page.mouse.up();

  await expect(page.getByTestId("snap-guide")).toHaveCount(0);
  // Gravity: dropped ~270px into a void, the tile packs back upward to its
  // row-0 spot (±4px viewport tolerance), instead of staying at the drop.
  await expect
    .poll(
      async () => Math.abs((await tile.boundingBox())!.y - before!.y) <= 4,
      { timeout: 5_000 },
    )
    .toBe(true);
});
