import { expect, test, type Page } from "@playwright/test";

/**
 * Cross-user approval: an agent proposes in one browser, a DIFFERENT human
 * approves in another.
 *
 * This is the signature moment of the product and the one thing a local-only
 * tool cannot do at all, so it is tested with two real browser contexts.
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

const callTool = (page: Page, name: string, input: unknown) =>
  page.evaluate(
    async ([toolName, args]) => {
      const tool = (window as never as {
        __registeredTools: Map<string, { execute: (i: unknown) => Promise<unknown> }>;
      }).__registeredTools.get(toolName as string);
      if (!tool) throw new Error(`tool not registered: ${String(toolName)}`);
      return tool.execute(args);
    },
    [name, input] as const,
  );

async function join(page: Page, base: string, token: string) {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await page.goto(`${base}/#ws=${encodeURIComponent(token)}`);
}

const toolsReady = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as never as { __registeredTools: Map<string, unknown> })
              .__registeredTools.size,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(30);

test("an agent proposes in one browser and a different human approves in another", async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const analyst = await browser.newContext();
  const reviewer = await browser.newContext();
  const analystPage = await analyst.newPage();
  const reviewerPage = await reviewer.newPage();

  const created = await analystPage.request.post(`${base}/api/workspace/guest`, {
    data: { label: "Approval test" },
  });
  // Fail here rather than 60 seconds later on an empty page: a refused
  // workspace hands back no token, and every assertion after it lies.
  expect(created.status(), await created.text()).toBe(201);
  const token = (await created.json()).token as string;

  // The analyst opens the report and their agent proposes a change set.
  await join(analystPage, base, token);
  const demo = analystPage.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 90_000 });
  await demo.click();
  await expect(analystPage.locator("[data-tile-type]")).toHaveCount(8);
  await toolsReady(analystPage);

  await callTool(analystPage, "propose_change_set", {
    title: "Explain the March dip",
    rationale: "Two edits that show the evidence together.",
    actions: [
      {
        kind: "add_annotation",
        payload: { tileId: "demo_chart_mrr", text: "March dip starts here." },
        note: "Marks the anomaly on the chart it happened on.",
      },
      {
        kind: "add_annotation",
        payload: {
          tileId: "demo_kpi_mrr",
          text: "Recovery begins in April.",
        },
        note: "Says where the recovery starts, next to the number it moved.",
      },
    ],
  });

  // The reviewer — a different browser, no account — opens the same link.
  await join(reviewerPage, base, token);

  // The report itself has to arrive before the proposal can be judged: the
  // change set annotates tiles, and approving edits to a report you cannot
  // see is not review. The card renders the tile TITLES once both have
  // landed, which is the observable proof that they have.
  await expect(reviewerPage.locator("[data-tile-type]").first()).toBeVisible({
    timeout: 90_000,
  });

  // The proposal reaches them, and it is theirs to decide. This is the whole
  // claim: the human who approves is not the human whose agent proposed.
  const card = reviewerPage.getByTestId("change-set-card");
  await expect(card).toContainText("Explain the March dip", { timeout: 90_000 });
  await expect(card).toContainText("MRR by month", { timeout: 60_000 });
  await expect(card).toContainText("Marks the anomaly");
  await expect(card).toContainText("Says where the recovery starts");

  // They approve it, and the edits land on the report.
  await reviewerPage.getByTestId("approve-change-set").click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });

  // The applied work is recorded once, as one entry, attributed to the agent
  // that proposed it — not to the human who pressed the button.
  await reviewerPage.getByTestId("rail-tab-activity").click();
  const activity = reviewerPage.getByTestId("activity-feed");
  await expect(activity).toContainText("Applied change set", { timeout: 30_000 });
  await expect(activity).toContainText("Explain the March dip");

  await analyst.close();
  await reviewer.close();
});
