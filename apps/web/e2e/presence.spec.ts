import { expect, test, type Page } from "@playwright/test";

/**
 * Collaboration e2e: every visible agent state is driven by a real mocked
 * WebMCP tool call. The human-authored brief and decision answer flow back to
 * the agent through get_work_context.
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

async function loadInvestigation(page: Page) {
  await page.goto("/");
  const demoButton = page.getByTestId("load-demo");
  await expect(demoButton).toBeEnabled({ timeout: 60_000 });
  await demoButton.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
  await expect(page.getByTestId("collaboration-rail")).toBeVisible();
}

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

test("brief → plan → structured decision → completion is a two-way WebMCP loop", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadInvestigation(page);

  const initial = await executeTool(page, "get_work_context", {});
  expect(initial.session).toMatchObject({
    phase: "ready",
    objective: expect.stringContaining("March churn spike"),
  });
  expect(initial.workingAgreement.agentEdits).toContain("undoable");

  await executeTool(page, "present_plan", {
    title: "Explain the churn spike",
    steps: [
      { label: "Profile churn cohorts" },
      { label: "Compare plan changes" },
      { label: "Return reviewed evidence" },
    ],
  });
  const rail = page.getByTestId("collaboration-rail");
  await expect(rail.getByTestId("rail-plan")).toBeVisible();
  await expect(rail).toContainText("Planning");
  await expect(rail).toContainText("0 of 3 complete");

  await executeTool(page, "update_plan_step", { index: 0, status: "active" });
  await expect(rail).toContainText("Investigating");

  const request = await executeTool(page, "request_decision", {
    question: "Which baseline should define the spike?",
    context:
      "The month-over-month comparison is sharper, while the quarterly baseline is less seasonal.",
    options: [
      {
        id: "monthly",
        label: "Previous month",
        description: "Best for the immediate operational change.",
      },
      {
        id: "quarterly",
        label: "Quarterly baseline",
        description: "Reduces seasonality in the comparison.",
      },
    ],
    recommendedOptionId: "monthly",
  });
  expect(request).toMatchObject({ ok: true, status: "pending" });
  const decision = rail.getByTestId("decision-request");
  await expect(decision).toBeVisible();
  await expect(rail).toContainText("Your judgment is needed");
  await expect(rail).toContainText("Agent pick");
  await decision.getByTestId("decision-option-monthly").click();
  await expect(decision).toHaveCount(0);

  const afterAnswer = await executeTool(page, "get_work_context", {});
  expect(afterAnswer.decisions).toEqual([
    expect.objectContaining({
      id: request.decisionId,
      status: "answered",
      answer: { optionId: "monthly" },
    }),
  ]);

  for (let index = 0; index < 3; index += 1) {
    await executeTool(page, "update_plan_step", { index, status: "done" });
  }
  const completed = await executeTool(page, "complete_work", {
    summary:
      "The spike is concentrated in Growth-plan renewals after the March price change.",
    outcomes: [
      "Used the human-approved month-over-month baseline.",
      "Kept the conclusion in the shared investigation trail.",
    ],
  });
  expect(completed).toMatchObject({ ok: true, phase: "complete" });
  await expect(rail).toContainText("Complete");
  await expect(rail).toContainText("Growth-plan renewals");
  await expect(rail).toContainText("human-approved month-over-month baseline");
});

test("reviewed proposal applies through the attributed command layer and remains undoable", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadInvestigation(page);

  const result = await executeTool(page, "propose_insight", {
    title: "Annotate the pricing change",
    body: "The timing lines up with the Growth-plan renewal spike.",
    severity: "warn",
    tileId: "demo_chart_mrr",
    suggestedAction: {
      kind: "add_annotation",
      payload: { tileId: "demo_chart_mrr", text: "Growth pricing changed here" },
    },
  });
  expect(result).toMatchObject({ ok: true, state: "proposed" });

  const rail = page.getByTestId("collaboration-rail");
  await expect(rail.getByTestId("proposal-queue")).toContainText(
    "Annotate the pricing change",
  );
  await expect(page.getByTestId("tile-demo_chart_mrr")).not.toContainText(
    "Growth pricing changed here",
  );

  await rail.getByTestId("accept-rail-proposal").click();
  await expect(page.getByTestId("tile-demo_chart_mrr")).toContainText(
    "Growth pricing changed here",
  );
  await expect(rail.getByTestId("proposal-queue")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("tile-demo_chart_mrr")).not.toContainText(
    "Growth pricing changed here",
  );
});

test("agent add_tile sends the neutral Agent cursor to the changed tile", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadInvestigation(page);

  await expect(page.getByTestId("agent-cursor")).toHaveCount(0);
  const result = await executeTool(page, "add_tile", {
    type: "kpi",
    title: "Agent KPI",
    spec: { dataset: "charges", measure: "*", agg: "count", format: "number" },
  });
  expect(result).toMatchObject({ ok: true });

  const cursor = page.getByTestId("agent-cursor");
  await expect(cursor).toBeVisible();
  await expect(cursor).toContainText("Agent");
});
