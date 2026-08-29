import { expect, test, type Page } from "@playwright/test";

/**
 * Shell e2e: command palette, templates, page tabs, persistence (build ->
 * reload -> everything back), presentation mode, cross-filter chip,
 * missing-dataset UX after reload.
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
  // DuckDB-WASM boot + demo CSV imports gate everything.
  await expect(page.getByTestId("load-demo")).toBeEnabled({ timeout: 60_000 });
}

async function loadDemo(page: Page) {
  await waitReady(page);
  await page.getByTestId("load-demo").click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("command palette adds a tile; presentation mode hides chrome", async ({
  page,
}) => {
  await waitReady(page);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  await palette.getByPlaceholder("Type a command or search…").fill("add kpi");
  await palette.getByText("Add KPI tile").click();
  await expect(page.locator("[data-tile-type=kpi]")).toHaveCount(1);
  await expect(palette).toHaveCount(0);

  // Presentation mode: F hides top bar + tabs, exit button restores.
  await page.keyboard.press("f");
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.getByTestId("exit-presentation")).toBeVisible();
  await page.getByTestId("exit-presentation").click();
  await expect(page.locator("header")).toHaveCount(1);
});

test("template instantiates from empty state; page tabs add/switch", async ({
  page,
}) => {
  await waitReady(page);

  // Templates gallery from the teaching empty state.
  await page.getByTestId("browse-templates").click();
  await page.getByTestId("template-revenue-overview").click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
  await expect(page.getByLabel("Dashboard title")).toHaveValue(
    "Revenue overview",
  );
  // Template tiles resolve real demo data (not error states).
  await expect(
    page.locator("[data-tile-type=kpi]").first(),
  ).toContainText("€", { timeout: 30_000 });

  // Pages: add -> new empty active page, switch back -> tiles return.
  await page.getByTestId("add-page").click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(0);
  await expect(page.getByTestId("page-tabs")).toContainText("Page 2");
  await page.getByTestId("page-tabs").getByText("Overview").click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
});

test("P0 persistence: dashboard survives reload with live data", async ({
  page,
}) => {
  await loadDemo(page);

  // Rename so we can prove the doc (not just the demo default) came back.
  const title = page.getByLabel("Dashboard title");
  await title.fill("Persistence proof");
  await title.press("Enter");

  // Debounced save (400ms) + a margin before reload.
  await page.waitForTimeout(900);
  await page.reload();

  // Full rehydration: title, tiles, and re-queried data (demo datasets
  // re-import at boot; tiles must resolve numbers again, not spinners).
  await expect(page.locator("[data-tile-type]")).toHaveCount(8, {
    timeout: 60_000,
  });
  await expect(page.getByLabel("Dashboard title")).toHaveValue(
    "Persistence proof",
  );
  await expect(page.getByTestId("tile-demo_kpi_mrr")).toContainText("€", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("tile-demo_table_failed")).toContainText("1/25");
});

test("cross-filter: clicking a tile value sets the chip; clearing restores", async ({
  page,
}) => {
  await loadDemo(page);

  // Click a gateway cell in the failed-charges table (5th column) ->
  // crossFilter {gateway, …} chip appears in the filter bar.
  const table = page.getByTestId("tile-demo_table_failed");
  const gatewayCell = table.locator("tbody tr").first().locator("td").nth(4);
  await expect(gatewayCell).toBeVisible({ timeout: 30_000 });
  const gateway = (await gatewayCell.innerText()).trim();
  await gatewayCell.click();

  const chip = page.getByTestId("cross-filter-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(`gateway = ${gateway}`);
  await expect(chip).toContainText("Recent failed charges");

  await page.getByTestId("clear-cross-filter").click();
  await expect(chip).toHaveCount(0);
});

test("uploaded dataset does not survive reload; tile explains re-upload", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await waitReady(page);

  // Upload an in-memory CSV (in-memory DuckDB: it cannot survive a reload).
  await page
    .locator('input[type=file][accept=".csv,.parquet"]')
    .first()
    .setInputFiles({
      name: "ephemeral.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b\n1,2\n3,4\n"),
    });

  // Agent adds a KPI on the uploaded dataset; it resolves live data (2 rows).
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const tools = (
          window as never as {
            __registeredTools: Map<
              string,
              { execute: (i: unknown, o: { signal: AbortSignal }) => Promise<unknown> }
            >;
          }
        ).__registeredTools;
        const t = tools.get("add_tile");
        if (!t) return "no-tool";
        const r = (await t.execute(
          {
            type: "kpi",
            title: "Ephemeral rows",
            spec: { dataset: "ephemeral", measure: "*", agg: "count", format: "number" },
          },
          { signal: new AbortController().signal },
        )) as { ok?: boolean };
        return r.ok ? "ok" : JSON.stringify(r);
      }),
    )
    .toBe("ok");
  const tile = page.locator("[data-tile-type=kpi]", { hasText: "Ephemeral rows" });
  await expect(tile).toContainText("2", { timeout: 30_000 });

  // Reload: the dashboard doc persists, the uploaded table is gone. The tile
  // must explain itself instead of spinning or dumping a raw catalog error.
  await page.waitForTimeout(900); // autosave debounce
  await page.reload();
  const restored = page.locator("[data-tile-type=kpi]", { hasText: "Ephemeral rows" });
  await expect(restored).toHaveCount(1, { timeout: 60_000 });
  await expect(restored).toContainText("Re-upload ephemeral", { timeout: 30_000 });
});
