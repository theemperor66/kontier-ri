import { expect, test, type Page } from "@playwright/test";

/**
 * Tile inspector e2e (Component Interaction Pack): open/close affordances,
 * live spec editing through the command layer (undoable), tile filters
 * changing real query results, and the human-edit conflict rule blocking a
 * subsequent agent update_tile on the same property.
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
  await expect(page.getByTestId("load-demo")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("load-demo").click();
  await expect(page.locator("[data-tile-type]")).toHaveCount(8);
}

function executeTool(page: Page, name: string, input: unknown) {
  return page.evaluate(
    async ({ name, input }) => {
      const tools = (
        window as never as {
          __registeredTools: Map<
            string,
            {
              execute: (
                i: unknown,
                o: { signal: AbortSignal },
              ) => Promise<unknown>;
            }
          >;
        }
      ).__registeredTools;
      return tools.get(name)!.execute(input, {
        signal: new AbortController().signal,
      });
    },
    { name, input },
  );
}

/** Add a structured bar chart (agent-origin) and return its tile id. */
async function addStructuredChart(page: Page): Promise<string> {
  const result = (await executeTool(page, "add_tile", {
    type: "chart",
    title: "Revenue by plan",
    spec: {
      dataset: "invoices",
      query: {
        dims: ["plan_id"],
        measures: [{ col: "amount_eur", agg: "sum" }],
      },
      chartType: "bar",
      xKey: "plan_id",
    },
  })) as { ok?: boolean; tileId?: string };
  expect(result.ok).toBe(true);
  const tileId = result.tileId!;
  await expect(
    page.locator(`[data-testid=tile-${tileId}] .recharts-bar-rectangle`),
  ).toHaveCount(4, { timeout: 30_000 });
  return tileId;
}

/** Select a tile via its header (avoids chart-body cross-filter clicks). */
async function openInspectorFor(page: Page, tileId: string) {
  // Click the tile body's left padding: selects without hitting the header
  // drag handle (stops propagation) or the recharts surface (cross-filter).
  await page
    .getByTestId(`tile-${tileId}`)
    .click({ position: { x: 8, y: 45 } });
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.getByTestId("tile-inspector")).toBeVisible();
}

test("inspector opens via double-click, ⌘E and the ⚙ pill; Escape closes it", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await loadDemo(page);

  // Double-click a KPI body opens the panel on that tile.
  await page.getByTestId("tile-demo_kpi_subs").dblclick();
  const panel = page.getByTestId("tile-inspector");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("inspector-title")).toHaveValue(
    "Active subscriptions",
  );

  // Focus lands inside the panel (focus trap entry) and Escape closes it
  // without deselecting the tile.
  await expect(panel).toHaveAttribute(
    "aria-label",
    "Tile inspector: Active subscriptions",
  );
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // ⌘E reopens on the still-selected tile.
  await page.keyboard.press("ControlOrMeta+e");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // The ⚙ control lives INSIDE the one selection bar (three separate
  // floating controls used to stack on top of each other) and opens the
  // panel.
  const toolbar = page.getByTestId("selection-toolbar");
  const pill = toolbar.getByTestId("open-inspector");
  await expect(pill).toBeVisible();
  const bar = await toolbar.boundingBox();
  const pillBox = await pill.boundingBox();
  expect(pillBox!.x).toBeGreaterThan(bar!.x);
  expect(pillBox!.x + pillBox!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 1);
  await pill.click();
  await expect(panel).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "true");

  // Panel follows the selection to another tile.
  await page
    .getByTestId("tile-demo_kpi_mrr")
    .click({ position: { x: 8, y: 45 } });
  await expect(panel.getByTestId("inspector-title")).toHaveValue("MRR (paid)");

  expect(pageErrors).toEqual([]);
});

test("chart type change from the inspector live-updates the tile and is undoable", async ({
  page,
}) => {
  await loadDemo(page);
  const line = page.locator(
    "[data-testid=tile-demo_chart_mrr] .recharts-line-curve",
  );
  await expect(line).toHaveCount(1, { timeout: 30_000 });

  await openInspectorFor(page, "demo_chart_mrr");
  await page.getByTestId("inspector-chart-type").selectOption("bar");

  // Live preview: the line becomes bars without a reload.
  await expect(line).toHaveCount(0);
  await expect(
    page
      .locator("[data-testid=tile-demo_chart_mrr] .recharts-bar-rectangle")
      .first(),
  ).toBeVisible();

  // The change went through the command layer: activity-logged + undoable.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(line).toHaveCount(1);
});

test("adding a tile filter in the inspector changes the tile's data", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);
  const tileId = await addStructuredChart(page);
  await openInspectorFor(page, tileId);

  await page.getByTestId("inspector-add-filter").click();
  await page.getByTestId("inspector-filter-column-0").selectOption("plan_id");
  await page.getByTestId("inspector-filter-value-0").fill("plan_starter");

  // 4 plan bars collapse to 1 once the tile-level filter applies (300ms
  // debounce + re-query).
  await expect(
    page.locator(`[data-testid=tile-${tileId}] .recharts-bar-rectangle`),
  ).toHaveCount(1, { timeout: 30_000 });

  // Clearing the value is invalid -> inline error, filter stays applied.
  await page.getByTestId("inspector-filter-value-0").fill("");
  await expect(
    page.getByTestId("inspector-filters").getByRole("alert"),
  ).toContainText("Enter a value");
  await expect(
    page.locator(`[data-testid=tile-${tileId}] .recharts-bar-rectangle`),
  ).toHaveCount(1);
});

test("editing a measure aggregation updates the chart", async ({ page }) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);
  const tileId = await addStructuredChart(page);
  await openInspectorFor(page, tileId);

  const bars = page.locator(
    `[data-testid=tile-${tileId}] .recharts-bar-rectangle path`,
  );
  // Signature = bar HEIGHTS only (the semantic under test). Path "d"
  // strings also encode x positions, which shift when the canvas
  // relayouts mid-test (inspector dock padding transition) — that made
  // the undo comparison flaky-fail on identical bar heights.
  const sig = () =>
    bars.evaluateAll((els) =>
      els
        .map((e) => (e as SVGPathElement).getBBox().height.toFixed(2))
        .join("|"),
    );
  // Wait for the entry animation to settle so signatures are comparable.
  const settled = async () => {
    let prev = "__none";
    await expect
      .poll(
        async () => {
          const cur = await sig();
          // Bars render 0-height before the entry animation starts —
          // never accept that as a settled state.
          const painted = cur !== "" && !/^0\.00(\|0\.00)*$/.test(cur);
          const same = painted && cur === prev;
          prev = cur;
          return same;
        },
        { timeout: 30_000, intervals: [400] },
      )
      .toBe(true);
    return prev;
  };

  const before = await settled();

  // sum(amount_eur) -> avg(amount_eur): per-plan invoice counts differ, so
  // the relative bar heights must change.
  await page.getByTestId("inspector-measure-agg-0").selectOption("avg");
  const after = await settled();
  expect(after).not.toBe(before);
  await expect(bars).toHaveCount(4);

  // The edit went through the command layer: one undo restores the sums.
  await page.keyboard.press("ControlOrMeta+z");
  const restored = await settled();
  expect(restored).toBe(before);
});

test("human inspector edit blocks a conflicting agent update_tile (10-min rule)", async ({
  page,
}) => {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await loadDemo(page);

  await page.getByTestId("tile-demo_kpi_subs").dblclick();
  const panel = page.getByTestId("tile-inspector");
  await expect(panel).toBeVisible();

  // Human renames the tile through the inspector (debounced 300ms commit).
  await panel.getByTestId("inspector-title").fill("Subscriptions (mine)");
  await expect(page.getByTestId("tile-demo_kpi_subs")).toContainText(
    "Subscriptions (mine)",
    { timeout: 5_000 },
  );

  // Agent tries to overwrite the same property -> conflict, nothing applied.
  const result = (await executeTool(page, "update_tile", {
    tileId: "demo_kpi_subs",
    patch: { title: "Agent title" },
  })) as { conflict?: boolean; properties?: string[] };
  expect(result.conflict).toBe(true);
  expect(result.properties).toContain("title");
  await expect(page.getByTestId("tile-demo_kpi_subs")).toContainText(
    "Subscriptions (mine)",
  );
  await expect(page.getByTestId("tile-demo_kpi_subs")).not.toContainText(
    "Agent title",
  );

  // force: true is the agent's documented escape hatch — it must still work.
  const forced = (await executeTool(page, "update_tile", {
    tileId: "demo_kpi_subs",
    patch: { title: "Agent title" },
    force: true,
  })) as { ok?: boolean };
  expect(forced.ok).toBe(true);
  await expect(page.getByTestId("tile-demo_kpi_subs")).toContainText(
    "Agent title",
  );
});
