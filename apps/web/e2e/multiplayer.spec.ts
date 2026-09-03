import { expect, test, type Page } from "@playwright/test";

/**
 * Two humans, one report.
 *
 * This is the claim the whole product rests on, so it is tested with two real
 * browser contexts against the real API — separate storage, separate tabs,
 * nothing shared but the invite link.
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

/** Create a guest workspace through the API the sign-in screen uses. */
async function createWorkspace(page: Page, baseURL: string): Promise<string> {
  const response = await page.request.post(`${baseURL}/api/workspace/guest`, {
    data: { label: "Two-browser test" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).token as string;
}

async function joinWithLink(page: Page, baseURL: string, token: string) {
  await page.addInitScript(MOCK_MODEL_CONTEXT);
  await page.goto(`${baseURL}/#ws=${encodeURIComponent(token)}`);
  // The credential must not stay in the address bar.
  await expect.poll(() => page.url()).not.toContain("ws=");
}

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

test("two browsers on one invite link converge on the same report", async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  const dana = await browser.newContext();
  const sam = await browser.newContext();
  const danaPage = await dana.newPage();
  const samPage = await sam.newPage();

  const token = await createWorkspace(danaPage, base);

  // Dana joins and builds something.
  await joinWithLink(danaPage, base, token);
  const demo = danaPage.getByTestId("load-demo");
  await expect(demo).toBeEnabled({ timeout: 90_000 });
  await demo.click();
  await expect(danaPage.locator("[data-tile-type]")).toHaveCount(8);

  await expect
    .poll(
      () =>
        danaPage.evaluate(
          () =>
            (window as never as { __registeredTools: Map<string, unknown> })
              .__registeredTools.size,
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(30);
  await callTool(danaPage, "set_dashboard_title", {
    title: "Churn review — shared",
  });

  // Sam opens the same link in a completely separate browser context.
  await joinWithLink(samPage, base, token);

  // Sam ends up on Dana's report without ever choosing it.
  await expect(samPage.locator("[data-tile-type]").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      async () =>
        (await samPage.getByLabel("Dashboard title").inputValue()) ?? "",
      { timeout: 60_000 },
    )
    .toContain("Churn review");

  await dana.close();
  await sam.close();
});

test("each guest workspace is private to its own link", async ({
  browser,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const one = await browser.newContext();
  const two = await browser.newContext();
  const pageOne = await one.newPage();
  const pageTwo = await two.newPage();

  const tokenOne = await createWorkspace(pageOne, base);
  const tokenTwo = await createWorkspace(pageTwo, base);
  expect(tokenOne).not.toBe(tokenTwo);

  // A workspace only ever answers for its own token.
  const mine = await pageOne.request.get(`${base}/api/workspace/dashboards`, {
    headers: { Authorization: `Bearer ${tokenOne}` },
  });
  const theirs = await pageOne.request.get(`${base}/api/workspace/dashboards`, {
    headers: { Authorization: `Bearer ${tokenTwo}` },
  });
  expect(mine.status()).toBe(200);
  expect(theirs.status()).toBe(200);
  expect(await mine.json()).not.toEqual(
    expect.objectContaining({ dashboards: [{ id: "impossible" }] }),
  );

  await one.close();
  await two.close();
});
