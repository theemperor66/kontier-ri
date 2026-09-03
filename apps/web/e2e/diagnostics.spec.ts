import { expect, test, type Page } from "@playwright/test";

/**
 * Agent diagnostics: the page reporting its own WebMCP state.
 *
 * This exists because the ChatGPT in-app browser has no devtools. When a tool
 * fails to register there, the page itself is the only instrument available.
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
  const demoButton = page.getByTestId("load-demo");
  await expect(demoButton).toBeEnabled({ timeout: 60_000 });
  await demoButton.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

const toolCount = (page: Page) =>
  page.evaluate(
    () =>
      (window as never as { __registeredTools: Map<string, unknown> })
        .__registeredTools.size,
  );

test("without a WebMCP runtime, diagnostics say so instead of guessing", async ({
  page,
}) => {
  await loadDemo(page);
  await page.getByTestId("webmcp-status").click();

  const dialog = page.getByTestId("agent-diagnostics");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("No WebMCP runtime in this browser");
  await expect(dialog).toContainText("Every human feature works without it");
  await expect(dialog).toContainText("document.modelContext");
  // Human mode is a real state, not an error state.
  await expect(dialog).not.toContainText("failed to register");
});

test("with a runtime, diagnostics report the live registered tool count", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  await expect.poll(() => toolCount(page), { timeout: 20_000 }).toBeGreaterThan(30);
  const registered = await toolCount(page);

  await page.getByTestId("webmcp-status").click();
  const dialog = page.getByTestId("agent-diagnostics");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("WebMCP is live");
  await expect(dialog).toContainText(`${registered} tools registered`);
  await expect(dialog).not.toContainText("failed to register");
});

test("?diag=1 opens diagnostics, so a bug report is a single URL", async ({
  page,
}) => {
  await page.goto("/?diag=1");
  await expect(page.getByTestId("agent-diagnostics")).toBeVisible({
    timeout: 30_000,
  });
});
