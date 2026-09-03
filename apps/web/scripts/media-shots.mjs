
// Regenerate the product images used by the README and the OG card.
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = `
  window.__registeredTools = new Map();
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool(tool, options) { window.__registeredTools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => window.__registeredTools.delete(tool.name));
      return Promise.resolve(); } } });
`;
const run = (page, name, input) => page.evaluate(async ({ name, input }) => {
  const t = window.__registeredTools.get(name);
  if (!t) throw new Error("missing tool " + name);
  return t.execute(input, { signal: new AbortController().signal });
}, { name, input });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.addInitScript(MOCK);
await page.goto(BASE);
const demo = page.getByTestId("load-demo");
await demo.waitFor({ state: "visible", timeout: 120000 });
await page.waitForFunction(() => !document.querySelector('[data-testid="load-demo"]')?.hasAttribute("disabled"), null, { timeout: 120000 });
await demo.click();
await page.waitForFunction(() => document.querySelectorAll("[data-tile-type]").length >= 8, null, { timeout: 90000 });
await page.waitForTimeout(2500);
await page.mouse.move(1590, 995);
await page.screenshot({ path: "../../docs/media/kri-workspace.png" });

await run(page, "present_plan", { title: "Explain the March churn spike", steps: [
  { label: "Profile churn by plan", status: "done" },
  { label: "Compare the pricing change window", status: "active" },
  { label: "Return reviewed evidence" }] });
await run(page, "request_decision", {
  question: "Which baseline should define the spike?",
  context: "Month over month is sharper for the operational change. The quarterly baseline removes seasonality.",
  options: [
    { id: "monthly", label: "Previous month", description: "Matches the pricing change window." },
    { id: "quarterly", label: "Quarterly baseline", description: "Less seasonal noise." }],
  recommendedOptionId: "monthly" });
await run(page, "propose_insight", {
  title: "Annotate the Growth-plan price change",
  body: "Churn doubles in the month after the Growth-plan increase. Worth a callout on the MRR trend.",
  severity: "warn", tileId: "demo_chart_mrr",
  suggestedAction: { kind: "add_annotation", payload: { tileId: "demo_chart_mrr", text: "Growth price change" } } });
await page.waitForTimeout(1500);
await page.screenshot({ path: "../../docs/media/kri-agent-loop.png" });

await page.getByTestId("rail-governance").click();
await page.waitForTimeout(1200);
await page.screenshot({ path: "../../docs/media/kri-governance.png" });
await ctx.close();

// OG card: the canvas at 1200x630.
const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const ogPage = await og.newPage();
await ogPage.goto(BASE);
const ogDemo = ogPage.getByTestId("load-demo");
await ogDemo.waitFor({ state: "visible", timeout: 120000 });
await ogPage.waitForFunction(() => !document.querySelector('[data-testid="load-demo"]')?.hasAttribute("disabled"), null, { timeout: 120000 });
await ogDemo.click();
await ogPage.waitForFunction(() => document.querySelectorAll("[data-tile-type]").length >= 8, null, { timeout: 90000 });
await ogPage.waitForTimeout(2500);
await ogPage.mouse.move(1190, 620);
await ogPage.screenshot({ path: "public/og.png" });
await browser.close();
console.log("media regenerated");
