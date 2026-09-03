import { expect, test, type Page } from "@playwright/test";
import { startGuestSession } from "./helpers/session";

/**
 * Data rail: the human field pane. Fields scaffold real tiles by click and by
 * drag, and the field under the pointer is published to the agent as focus
 * context — the same signal a selection or a brush produces.
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

function executeTool(page: Page, name: string, input: unknown): Promise<any> {
  return page.evaluate(
    async ({ name, input }) => {
      const tools = (
        window as never as {
          __registeredTools: Map<
            string,
            { execute: (i: unknown, o: { signal: AbortSignal }) => Promise<unknown> }
          >;
        }
      ).__registeredTools;
      const tool = tools.get(name);
      if (!tool) throw new Error(`tool ${name} not registered`);
      return tool.execute(input, { signal: new AbortController().signal });
    },
    { name, input },
  );
}

async function loadDemo(page: Page) {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await startGuestSession(page, undefined);
  await page.goto("/");
  const demo = page.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 60_000 });
  await demo.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("a field scaffolds a real tile and becomes agent focus context", async ({
  page,
}) => {
  await loadDemo(page);

  // The pane is opt-in and toggles from the report header.
  await expect(page.getByTestId("data-rail")).toHaveCount(0);
  await page.getByTestId("toggle-data-rail").click();
  const rail = page.getByTestId("data-rail");
  await expect(rail).toBeVisible();

  await rail.getByTestId("dataset-invoices").click();
  const field = rail.getByTestId("field-invoices-amount_eur");
  await expect(field).toBeVisible();

  // Hovering publishes the field to the agent, exactly like a selection.
  await field.hover();
  await expect
    .poll(async () => {
      const focus = await executeTool(page, "get_user_focus", {});
      return focus.hoveredField?.column ?? null;
    })
    .toBe("amount_eur");

  // Clicking scaffolds a KPI for a numeric field, through the human command
  // layer: it is attributed, selected, and undoable.
  await field.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(9);
  const added = page.locator("[data-tile-type=kpi]", { hasText: "amount_eur (sum)" });
  await expect(added).toHaveCount(1);
  await expect(added).toContainText("€", { timeout: 30_000 });

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);

  // A dimension scaffolds a chart instead.
  await rail.getByTestId("field-invoices-month").click();
  await expect(
    page.locator("[data-tile-type=chart]", { hasText: "amount_eur by month" }),
  ).toHaveCount(1);

  // ⌘B closes the pane again.
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.getByTestId("data-rail")).toHaveCount(0);
});
