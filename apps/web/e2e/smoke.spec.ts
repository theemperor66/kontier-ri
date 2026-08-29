import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke tests: demo dashboard renders real data (DuckDB-WASM in-browser) and
 * the WebMCP tool surface registers against a mocked document.modelContext.
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

async function loadDemo(page: Page) {
  await page.goto("/");
  // DuckDB-WASM boot + 5 CSV imports can take a while on first load.
  const demoButton = page.getByTestId("load-demo");
  await expect(demoButton).toBeEnabled({ timeout: 60_000 });
  await demoButton.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("demo dashboard renders 8 tiles with real query results", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  // DuckDB-WASM must load self-hosted from /duckdb/ (no jsDelivr at runtime).
  const cdnRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("jsdelivr")) cdnRequests.push(req.url());
  });

  await loadDemo(page);

  // KPI resolves to a real number from invoices.csv (not the "—" fallback).
  const kpi = page.getByTestId("tile-demo_kpi_mrr");
  await expect(kpi).toContainText("€", { timeout: 30_000 });
  await expect(kpi).not.toContainText("—");

  // Line chart drew a path and the table paginates.
  await expect(
    page.locator("[data-testid=tile-demo_chart_mrr] .recharts-line-curve"),
  ).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId("tile-demo_table_failed")).toContainText("1/25");

  expect(pageErrors).toEqual([]);
  expect(cdnRequests).toEqual([]);
});

test("WebMCP registers 19 static tools, +3 while a tile is selected", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  await expect
    .poll(() => page.evaluate(() => (window as never as { __registeredTools: Map<string, unknown> }).__registeredTools.size))
    .toBe(19);
  await expect(page.getByTestId("webmcp-status")).toContainText("19 tools");

  await page.locator("[data-tile-type=kpi]").first().click();
  await expect
    .poll(() => page.evaluate(() => (window as never as { __registeredTools: Map<string, unknown> }).__registeredTools.size))
    .toBe(22);
});

test("agent add_tile shows attribution chip and activity entry; undo removes it", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  const result = await page.evaluate(async () => {
    const tools = (window as never as {
      __registeredTools: Map<
        string,
        { execute: (i: unknown, o: { signal: AbortSignal }) => Promise<unknown> }
      >;
    }).__registeredTools;
    return tools.get("add_tile")!.execute(
      {
        type: "kpi",
        title: "Agent KPI",
        spec: { dataset: "charges", measure: "*", agg: "count", format: "number" },
      },
      { signal: new AbortController().signal },
    );
  });
  expect(result).toMatchObject({ ok: true });

  await expect(page.locator("[data-tile-type]")).toHaveCount(9);
  // Attribution chip on the agent-touched tile.
  await expect(page.locator("[data-tile-type=kpi]", { hasText: "Agent KPI" })).toContainText("AI");

  // Activity feed logs the agent command.
  await page.getByRole("button", { name: "Toggle activity feed" }).click();
  await expect(page.getByTestId("activity-feed")).toContainText('Added kpi tile "Agent KPI"');

  // Cmd+Z undoes the agent's change.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
});
