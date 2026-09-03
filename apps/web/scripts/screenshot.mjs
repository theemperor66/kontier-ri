import { chromium } from "@playwright/test";

const base = process.env.VERIFY_URL ?? "http://localhost:3299";
const out = process.env.SHOT_OUT ?? "/tmp/kri-shot.png";
const width = Number(process.env.SHOT_W ?? 1440);
const height = Number(process.env.SHOT_H ?? 900);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
await page.goto(base, { waitUntil: "domcontentloaded" });
const btn = page.getByTestId("load-demo");
await btn.waitFor({ state: "visible", timeout: 90000 });
await page.waitForFunction(
  () => !document.querySelector('[data-testid="load-demo"]')?.hasAttribute("disabled"),
  null, { timeout: 90000 },
);
await btn.click();
await page.waitForFunction(
  () => document.querySelectorAll("[data-tile-type]").length === 8,
  null, { timeout: 60000 },
);
// Wait for real values: currency KPI, chart path, table pager.
await page.waitForFunction(() => {
  const kpi = document.querySelector('[data-testid="tile-demo_kpi_mrr"]');
  const line = document.querySelector('[data-testid="tile-demo_chart_mrr"] .recharts-line-curve');
  const churn = document.querySelector('[data-testid="tile-demo_chart_churn"] .recharts-bar');
  const table = document.querySelector('[data-testid="tile-demo_table_failed"]');
  return kpi?.textContent?.includes("€") && line && churn && table?.textContent?.includes("1/");
}, null, { timeout: 60000 });
await page.waitForTimeout(1200); // let chart animations settle
await page.mouse.move(0, 0);
await page.screenshot({ path: out });
console.log(`saved ${out} (${width}x${height}@2x)`);
await browser.close();
