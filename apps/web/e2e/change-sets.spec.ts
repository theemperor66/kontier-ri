import { expect, test, type Page } from "@playwright/test";
import { startGuestSession } from "./helpers/session";

/**
 * Staged change sets: an agent proposes several related edits as ONE
 * reviewable set. The human edits the set before it lands, approves what
 * survives, and reverses the whole thing with a single undo. The toolbelt
 * itself changes while the set is open.
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

const toolNames = (page: Page) =>
  page.evaluate(() => [
    ...(window as never as { __registeredTools: Map<string, unknown> })
      .__registeredTools.keys(),
  ]);

async function loadDemo(page: Page) {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await startGuestSession(page, undefined);
  await page.goto("/");
  const demo = page.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 60_000 });
  await demo.click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

test("a change set is reviewed, edited, applied as one undoable step", async ({
  page,
}) => {
  await loadDemo(page);

  // The proposal bundle is NOT registered while nothing is pending.
  expect(await toolNames(page)).not.toContain("revise_change_set");

  const proposed = await executeTool(page, "propose_change_set", {
    title: "Frame the March churn spike",
    rationale:
      "Three related edits: scope the report, mark the pricing change, and add the cohort view.",
    actions: [
      {
        kind: "add_annotation",
        note: "Marks the month the Growth plan price changed.",
        payload: { tileId: "demo_chart_mrr", text: "Growth price change" },
      },
      {
        kind: "update_tile",
        note: "Name the tile after what it now shows.",
        payload: {
          tileId: "demo_chart_churn",
          patch: { title: "Churned subscriptions (March spike)" },
        },
      },
      {
        kind: "add_tile",
        note: "The cohort view the brief asks for.",
        payload: {
          type: "kpi",
          title: "Churn cohort size",
          spec: {
            dataset: "subscriptions",
            measure: "*",
            agg: "count",
            format: "number",
          },
        },
      },
    ],
  });
  expect(proposed).toMatchObject({ ok: true, status: "proposed", actions: 3 });

  // While it is open, the agent gains exactly the tools that make sense now.
  const withProposal = await toolNames(page);
  expect(withProposal).toContain("revise_change_set");
  expect(withProposal).toContain("withdraw_change_set");

  const card = page.getByTestId("change-set-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Frame the March churn spike");
  await expect(card).toContainText("3 changes");

  // The human drops one row before approving the rest.
  await card.getByTestId("change-action-2").uncheck();
  await expect(card.getByTestId("approve-change-set")).toContainText("Approve 2");
  await card.getByTestId("approve-change-set").click();

  await expect(page.getByTestId("tile-demo_chart_mrr")).toContainText(
    "Growth price change",
  );
  await expect(
    page.locator("[data-tile-type=chart]", { hasText: "March spike" }),
  ).toHaveCount(1);
  // The skipped action never ran.
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);

  // One undo reverses the whole set.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("tile-demo_chart_mrr")).not.toContainText(
    "Growth price change",
  );
  await expect(
    page.locator("[data-tile-type=chart]", { hasText: "March spike" }),
  ).toHaveCount(0);

  // The proposal tools unmount once nothing is pending.
  await expect
    .poll(async () => (await toolNames(page)).includes("revise_change_set"))
    .toBe(false);

  // The agent sees the outcome on its next orientation read.
  const context = await executeTool(page, "get_work_context", {});
  expect(context.changeSets).toEqual([
    expect.objectContaining({
      title: "Frame the March churn spike",
      status: "partially_applied",
    }),
  ]);
});

test("rejecting a change set applies nothing and closes the bundle", async ({
  page,
}) => {
  await loadDemo(page);

  await executeTool(page, "propose_change_set", {
    title: "Drop the failed-charges table",
    rationale: "It duplicates the payments page.",
    actions: [{ kind: "remove_tile", payload: { tileId: "demo_table_failed" } }],
  });

  const card = page.getByTestId("change-set-card");
  await expect(card).toBeVisible();
  await card.getByTestId("reject-change-set").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("tile-demo_table_failed")).toBeVisible();

  const context = await executeTool(page, "get_work_context", {});
  expect(context.changeSets[0]).toMatchObject({ status: "rejected" });
});
