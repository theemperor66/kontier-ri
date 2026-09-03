import { expect, test, type Page } from "@playwright/test";
import { startGuestSession } from "./helpers/session";

/**
 * The tool call ledger: proof, on the page, that WebMCP is doing something.
 *
 * These tests call tools the way a host does — through the registered
 * `execute` — and then read the ledger the human sees.
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
  await startGuestSession(page, undefined);
  await page.goto("/");
  const demoButton = page.getByTestId("load-demo");
  await expect(demoButton).toBeEnabled({ timeout: 60_000 });
  await demoButton.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

const callTool = (page: Page, name: string, input: unknown) =>
  page.evaluate(
    async ([toolName, args]) => {
      const tools = (window as never as {
        __registeredTools: Map<string, { execute: (i: unknown) => Promise<unknown> }>;
      }).__registeredTools;
      const tool = tools.get(toolName as string);
      if (!tool) throw new Error(`tool not registered: ${String(toolName)}`);
      return tool.execute(args);
    },
    [name, input] as const,
  );

async function openActivity(page: Page) {
  await page.getByTestId("rail-tab-activity").click();
}

test("the ledger is empty until a tool is called, and explains itself", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);
  await openActivity(page);
  await expect(page.getByTestId("tool-call-log-empty")).toContainText(
    "No tool calls yet",
  );
});

test("a read call and a write call are both logged, and labelled apart", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as never as { __registeredTools: Map<string, unknown> })
              .__registeredTools.size,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(30);

  await callTool(page, "run_sql", { sql: "select count(*) as n from invoices" });
  await callTool(page, "set_dashboard_title", { title: "Ledger check" });

  await openActivity(page);
  const rows = page.getByTestId("tool-call-row");
  await expect(rows).toHaveCount(2);

  // Newest first.
  await expect(rows.first()).toHaveAttribute("data-tool-name", "set_dashboard_title");
  await expect(rows.first()).toContainText("writes");
  const readRow = page.locator('[data-testid="tool-call-row"][data-tool-name="run_sql"]');
  await expect(readRow).toContainText("read");
  // The arguments the agent actually sent are shown, not a summary.
  await expect(readRow).toContainText("select count(*)");
  await expect(page.getByTestId("tool-call-count")).toHaveText("2");
});

test("a failing call is logged with its error and marked failed", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as never as { __registeredTools: Map<string, unknown> })
              .__registeredTools.size,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(30);

  // read-only SQL is enforced in the engine, so this is a real refusal.
  await callTool(page, "run_sql", { sql: "drop table invoices" });

  await openActivity(page);
  const row = page.getByTestId("tool-call-row").first();
  await expect(row).toHaveAttribute("data-tool-name", "run_sql");
  await expect(page.getByTestId("tool-call-count")).toContainText("1 failed");
});

test("a call the host rejected on schema is logged, marked, and never ran", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as never as { __registeredTools: Map<string, unknown> })
              .__registeredTools.size,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(30);

  const before = await page.evaluate(
    () => document.querySelector("[data-dashboard-title]")?.textContent ?? "",
  );
  // Wrong shape on purpose: `title` is required, `name` is not a field.
  await callTool(page, "set_dashboard_title", { name: "nope" });

  await openActivity(page);
  const row = page.getByTestId("tool-call-row").first();
  await expect(row).toHaveAttribute("data-tool-name", "set_dashboard_title");
  await expect(row).toContainText("rejected");
  await expect(row).toContainText("Invalid input");
  // The arguments the agent actually sent are visible, so the mistake is
  // debuggable without a console.
  await expect(row).toContainText("nope");
  // And the tool body did not run.
  const after = await page.evaluate(
    () => document.querySelector("[data-dashboard-title]")?.textContent ?? "",
  );
  expect(after).toBe(before);
});
