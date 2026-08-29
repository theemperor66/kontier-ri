import { chromium } from "@playwright/test";

const base = process.env.VERIFY_URL ?? "http://localhost:3299";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const hosts = new Map();
const duckdbReqs = [];
page.on("request", (req) => {
  const u = new URL(req.url());
  hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
  if (u.pathname.includes("duckdb")) duckdbReqs.push(u.pathname);
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
// grab KPI texts for demo-content check
const kpis = await page.evaluate(() =>
  [...document.querySelectorAll("[data-tile-type=kpi]")].map((el) => el.textContent),
);
console.log("HOSTS:", JSON.stringify([...hosts.entries()]));
console.log("DUCKDB_REQS:", JSON.stringify(duckdbReqs));
console.log("KPIS:", JSON.stringify(kpis));
const jsdelivr = [...hosts.keys()].filter((h) => h.includes("jsdelivr"));
if (jsdelivr.length) { console.error("FAIL: jsdelivr requests:", jsdelivr); process.exit(1); }
console.log("PASS: no jsdelivr requests");
await browser.close();
