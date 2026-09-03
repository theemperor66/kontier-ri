// Review capture: first run, canvas, a full agent loop (plan -> decision ->
// proposal -> completion), dark mode, and the mobile review layout.
// Usage: BASE_URL=http://localhost:3000 node scripts/review-shots.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK = `
  window.__registeredTools = new Map();
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool(tool, options) { window.__registeredTools.set(tool.name, tool);
      options?.signal?.addEventListener("abort", () => window.__registeredTools.delete(tool.name));
      return Promise.resolve(); } } });
`;
const browser = await chromium.launch();
const out = process.env.SHOT_DIR ?? ".impeccable/review";
const shot = async (page, name) => page.screenshot({ path: `${out}/${name}.png` });

async function boot(page, withMock = true) {
  if (withMock) await page.addInitScript(MOCK);
  await page.goto(BASE);
  const demo = page.getByTestId("load-demo");
  await demo.waitFor({ state: "visible", timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="load-demo"]')?.hasAttribute("disabled"), null, { timeout: 120000 });
  return demo;
}
const waitForTools = (page) =>
  page.waitForFunction(
    () => (window.__registeredTools?.size ?? 0) >= 40,
    null,
    { timeout: 60000 },
  );

const run = (page, name, input) => page.evaluate(async ({ name, input }) => {
  const t = window.__registeredTools.get(name);
  if (!t) throw new Error("missing tool " + name);
  return t.execute(input, { signal: new AbortController().signal });
}, { name, input });

// --- desktop: empty -> demo -> agent loop
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const demo = await boot(page);
await shot(page, "01-first-run");
await demo.click();
await page.waitForFunction(() => document.querySelectorAll("[data-tile-type]").length >= 8, null, { timeout: 90000 });
await page.waitForTimeout(2500);
await page.mouse.move(1590, 995);
// Hero reproduction checkpoint: the first viewport only, at the comp frame.
await page.screenshot({ path: `${out}/hero-repro.png`, clip: { x: 0, y: 0, width: 1600, height: 620 } });
await shot(page, "02-canvas");

await waitForTools(page);
// The agent narrows the report's scope: the header chip must show who did it.
await run(page, "set_global_filter", { column: "plan_id", op: "eq", value: "plan_growth" });
await page.waitForTimeout(800);
await run(page, "present_plan", { title: "Explain the March churn spike", steps: [
  { label: "Profile churn by plan", status: "done" },
  { label: "Compare pricing change window", status: "active" },
  { label: "Return reviewed evidence" }] });
await run(page, "request_decision", {
  question: "Which baseline should define the spike?",
  context: "Month-over-month is sharper for the operational change; the quarterly baseline removes seasonality.",
  options: [
    { id: "monthly", label: "Previous month", description: "Matches the pricing change window." },
    { id: "quarterly", label: "Quarterly baseline", description: "Less seasonal noise." }],
  recommendedOptionId: "monthly" });
await run(page, "propose_insight", {
  title: "Annotate the Growth-plan price change",
  body: "Churn doubles in the month after the Growth-plan increase. Worth a callout on the MRR trend.",
  severity: "warn", tileId: "demo_chart_mrr",
  suggestedAction: { kind: "add_annotation", payload: { tileId: "demo_chart_mrr", text: "Growth price change" } } });
await page.waitForTimeout(1200);
await shot(page, "03-agent-panel");

await page.getByTestId("decision-option-monthly").click();
await page.getByTestId("accept-rail-proposal").click();
await page.waitForTimeout(1200);
await run(page, "complete_work", { summary: "The spike is concentrated in Growth-plan renewals after the March price change.", outcomes: ["Used the human-approved month-over-month baseline.", "Annotated the MRR trend with the pricing change."] });
await page.waitForTimeout(1200);
await shot(page, "04-completed");

// dark mode
await page.getByRole("button", { name: "Toggle theme" }).click();
await page.waitForTimeout(1500);
await shot(page, "05-dark");
await page.getByRole("button", { name: "Toggle theme" }).click();
await page.waitForTimeout(1200);
await ctx.close();

// --- mobile
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const mp = await m.newPage();
const mdemo = await boot(mp, false);
await shot(mp, "06-mobile-first-run");
await mdemo.click();
await mp.waitForFunction(() => document.querySelectorAll("[data-tile-type]").length >= 8, null, { timeout: 90000 });
await mp.waitForTimeout(2500);
await shot(mp, "07-mobile-panel");
await mp.getByTestId("collaboration-rail").getByRole("button", { name: "Close agent workspace" }).click();
await mp.waitForTimeout(800);
await shot(mp, "08-mobile-canvas");
await m.close();
await browser.close();
console.log("done");
