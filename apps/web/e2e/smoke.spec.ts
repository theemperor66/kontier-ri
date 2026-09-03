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

const FAILING_MODEL_CONTEXT = `
  window.__registeredTools = new Map();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool(tool, options) {
        if (tool.name === "run_sql") {
          return Promise.reject(new Error("Security policy denied run_sql"));
        }
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

test("WebMCP registers the static tool surface, +3 while a tile is selected", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  // The static surface includes the collaboration protocol. The status must
  // reflect successful registration, not modelContext feature detection alone.
  const toolCount = () =>
    page.evaluate(
      () =>
        (window as never as { __registeredTools: Map<string, unknown> })
          .__registeredTools.size,
    );
  await expect.poll(toolCount).toBe(40);
  const staticCount = await toolCount();
  const status = page.getByTestId("webmcp-status");
  await expect(status).toContainText("Agent ready");
  await expect(status).toHaveAttribute("data-ready-count", String(staticCount));

  await page.locator("[data-tile-type=kpi]").first().click();
  await expect.poll(toolCount).toBe(staticCount + 3);
  await expect(status).toHaveAttribute("data-ready-count", String(staticCount + 3));
});

test("tools register when a WebMCP host arrives after hydration", async ({ page }) => {
  await page.goto("/");
  const status = page.getByTestId("webmcp-status");
  await expect(status).toContainText("Connect agent");
  await page.evaluate(() => {
    const registered = new Map<string, unknown>();
    (window as never as { __registeredTools: Map<string, unknown> }).__registeredTools =
      registered;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string }, options?: { signal?: AbortSignal }) {
          registered.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => registered.delete(tool.name));
          return Promise.resolve();
        },
      },
    });
  });
  await expect(status).toContainText("Agent ready", { timeout: 10_000 });
  await expect(status).toHaveAttribute("data-ready-count", "40");
});

test("registration failures are visible instead of reporting a false ready state", async ({
  page,
}) => {
  await page.addInitScript(FAILING_MODEL_CONTEXT);
  await page.goto("/");
  const status = page.getByTestId("webmcp-status");
  await expect(status).toContainText("Agent setup issue");
  await status.hover();
  await expect(
    page.getByText("Security policy denied run_sql"),
  ).toBeVisible();
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

  // Activity feed logs the agent command (lives in the ••• overflow menu).
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Activity feed" }).click();
  await expect(page.getByTestId("activity-feed")).toContainText('Added kpi tile "Agent KPI"');

  // Cmd+Z undoes the agent's change.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
});
