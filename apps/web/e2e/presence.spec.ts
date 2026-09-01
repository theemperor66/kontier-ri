import { expect, test, type Page } from "@playwright/test";

/**
 * Agent presence e2e (E2): plan card, insight tray and the synthetic Kai
 * cursor render ONLY from real WebMCP tool calls (mocked modelContext,
 * same harness as smoke.spec.ts) — never from timers.
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

function executeTool(page: Page, name: string, input: unknown): Promise<unknown> {
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

test("present_plan renders Kai's plan card; steps tick; clear_plan removes it", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  // Honesty rule: no presence UI before any tool call.
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await expect(page.getByTestId("insight-tray")).toHaveCount(0);

  const result = await executeTool(page, "present_plan", {
    title: "Find churn drivers",
    steps: [{ label: "Scan invoices" }, { label: "Chart refunds" }],
  });
  expect(result).toMatchObject({ ok: true, steps: 2 });

  const card = page.getByTestId("plan-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Kai");
  await expect(card).toContainText("Find churn drivers");
  await expect(card).toContainText("0/2");
  await expect(page.getByTestId("plan-step-0")).toHaveAttribute(
    "data-status",
    "pending",
  );

  await executeTool(page, "update_plan_step", { index: 0, status: "active" });
  await expect(page.getByTestId("plan-step-0")).toHaveAttribute(
    "data-status",
    "active",
  );
  await executeTool(page, "update_plan_step", { index: 0, status: "done" });
  await expect(page.getByTestId("plan-step-0")).toHaveAttribute(
    "data-status",
    "done",
  );
  await expect(card).toContainText("1/2");

  // Plan events land in the activity feed (logged, but NOT undoable).
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Toggle activity feed" }).click();
  await expect(page.getByTestId("activity-feed")).toContainText(
    "Agent shared a plan",
  );

  await executeTool(page, "clear_plan", {});
  await expect(card).toHaveCount(0);
});

test("propose_insight chip: Accept applies the suggested annotation (undoable); Dismiss waves one away", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  const result = await executeTool(page, "propose_insight", {
    title: "Refund spike",
    body: "Refunds doubled quarter-over-quarter — worth a callout on the MRR trend.",
    severity: "warn",
    tileId: "demo_chart_mrr",
    suggestedAction: {
      kind: "add_annotation",
      payload: { tileId: "demo_chart_mrr", text: "Refund spike here" },
    },
  });
  expect(result).toMatchObject({ ok: true, state: "proposed" });

  const chip = page.getByTestId("insight-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Refund spike");
  await expect(chip).toHaveAttribute("data-severity", "warn");

  // Nothing is applied until the human accepts.
  await expect(page.getByTestId("tile-demo_chart_mrr")).not.toContainText(
    "Refund spike here",
  );

  await chip.getByTestId("accept-insight").click();
  await expect(page.getByTestId("tile-demo_chart_mrr")).toContainText(
    "Refund spike here",
  );
  await expect(chip).toHaveCount(0);

  // The applied action went through the command layer: ⌘Z removes it.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("tile-demo_chart_mrr")).not.toContainText(
    "Refund spike here",
  );

  // Dismiss path: chip disappears without touching the dashboard.
  await executeTool(page, "propose_insight", {
    title: "Card fees look high",
    body: "Stripe fees are 3.1% of gross this month.",
  });
  const chip2 = page.getByTestId("insight-chip");
  await expect(chip2).toBeVisible();
  await chip2.getByTestId("dismiss-insight").click();
  await expect(chip2).toHaveCount(0);
});

test("agent add_tile sends Kai's synthetic cursor flying to the tile", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  await expect(page.getByTestId("agent-cursor")).toHaveCount(0);

  const result = await executeTool(page, "add_tile", {
    type: "kpi",
    title: "Agent KPI",
    spec: { dataset: "charges", measure: "*", agg: "count", format: "number" },
  });
  expect(result).toMatchObject({ ok: true });

  const cursor = page.getByTestId("agent-cursor");
  await expect(cursor).toBeVisible();
  await expect(cursor).toContainText("Kai");
});
