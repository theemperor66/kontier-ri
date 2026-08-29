#!/usr/bin/env node
/**
 * Deterministic demo-data generator for Kontier RI.
 *
 * Generates two dataset groups (docs/PLAN.md) as CSV into apps/web/public/demo/:
 *  - saas_billing: plans, customers, subscriptions, invoices (~24 months).
 *    MRR grows steadily; month index 18 has a churn spike caused by a price
 *    increase on the Growth plan (the "brush and ask why" demo moment).
 *  - payments: charges with gateway, failure codes and dunning retries.
 *
 * Deterministic: mulberry32 PRNG with a fixed seed. Re-running produces
 * byte-identical CSVs. No dependencies.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "demo");

// ---------------------------------------------------------------- PRNG ----
const SEED = 20260829;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickWeighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};

// ------------------------------------------------------------- calendar ----
// 24 months: 2024-09 .. 2026-08. Month index 0..23; churn spike at index 18 (2026-03).
const MONTHS = 24;
const START_YEAR = 2024;
const START_MONTH = 9; // September
const PRICE_INCREASE_MONTH = 18;
function ym(i) {
  const m0 = START_MONTH - 1 + i;
  const y = START_YEAR + Math.floor(m0 / 12);
  const m = (m0 % 12) + 1;
  return { y, m };
}
function monthStr(i) {
  const { y, m } = ym(i);
  return `${y}-${String(m).padStart(2, "0")}`;
}
function dateStr(i, day) {
  return `${monthStr(i)}-${String(day).padStart(2, "0")}`;
}
function daysInMonth(i) {
  const { y, m } = ym(i);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------------------------------------------------------------- plans ----
// Growth gets a price increase at month 18 -> churn spike among Growth customers.
const PLANS = [
  { plan_id: "plan_starter", name: "Starter", monthly_price_eur: 29, price_after_eur: 29 },
  { plan_id: "plan_growth", name: "Growth", monthly_price_eur: 99, price_after_eur: 149 },
  { plan_id: "plan_scale", name: "Scale", monthly_price_eur: 299, price_after_eur: 299 },
  { plan_id: "plan_enterprise", name: "Enterprise", monthly_price_eur: 999, price_after_eur: 999 },
];
function planPrice(planId, monthIdx) {
  const p = PLANS.find((x) => x.plan_id === planId);
  return monthIdx >= PRICE_INCREASE_MONTH ? p.price_after_eur : p.monthly_price_eur;
}

// ------------------------------------------------------------ customers ----
const COUNTRIES = [
  ["DE", "EUR", 30], ["FR", "EUR", 15], ["NL", "EUR", 10], ["ES", "EUR", 8],
  ["IT", "EUR", 7], ["GB", "GBP", 12], ["US", "USD", 10], ["CH", "CHF", 4],
  ["SE", "SEK", 4],
];
const FX_TO_EUR = { EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.05, SEK: 0.088 };
const ADJ = ["Acme", "Nord", "Blue", "Prime", "Quant", "Hyper", "Clear", "Bright", "Iron", "Swift", "Ever", "Alto", "Nova", "Vertex", "Delta", "Atlas", "Orbit", "Pulse", "Cedar", "Falcon"];
const NOUN = ["Labs", "Systems", "Works", "Analytics", "Digital", "Software", "Cloud", "Logistics", "Media", "Robotics", "Data", "Studio", "Networks", "Commerce", "Solutions", "Dynamics", "Industries", "Apps", "Group", "Tech"];
const SEGMENTS = [["startup", 45], ["smb", 35], ["mid_market", 15], ["enterprise", 5]];

// Growth in new signups per month: ~14 -> ~44.
function signupsForMonth(i) {
  const base = 14 + Math.round((30 * i) / (MONTHS - 1));
  return base + randInt(-3, 3);
}

const customers = [];
const subscriptions = [];
let customerSeq = 1;
let subSeq = 1;

for (let m = 0; m < MONTHS; m++) {
  const n = signupsForMonth(m);
  for (let k = 0; k < n; k++) {
    const id = `cus_${String(customerSeq++).padStart(5, "0")}`;
    const [country, currency] = pickWeighted(COUNTRIES.map(([c, cur, w]) => [[c, cur], w]));
    const segment = pickWeighted(SEGMENTS);
    const name = `${pick(ADJ)} ${pick(NOUN)} ${pick(["GmbH", "BV", "SAS", "Ltd", "Inc", "AB", "AG", "SL"])}`;
    const signupDay = randInt(1, daysInMonth(m));
    const planId = pickWeighted([
      ["plan_starter", segment === "startup" ? 55 : 20],
      ["plan_growth", 40],
      ["plan_scale", segment === "mid_market" ? 35 : 12],
      ["plan_enterprise", segment === "enterprise" ? 50 : 2],
    ]);
    customers.push({
      customer_id: id, name, country, currency, segment,
      signup_date: dateStr(m, signupDay),
    });

    // Baseline churn ~1.8%/month. At PRICE_INCREASE_MONTH, Growth customers
    // churn heavily (22%) in reaction to the 99 -> 149 price change.
    let cancelMonth = null;
    for (let cm = m + 1; cm < MONTHS; cm++) {
      let p = 0.018;
      if (cm === PRICE_INCREASE_MONTH && planId === "plan_growth") p = 0.22;
      if (cm === PRICE_INCREASE_MONTH + 1 && planId === "plan_growth") p = 0.05; // aftershock
      if (rand() < p) { cancelMonth = cm; break; }
    }
    subscriptions.push({
      subscription_id: `sub_${String(subSeq++).padStart(5, "0")}`,
      customer_id: id,
      plan_id: planId,
      start_date: dateStr(m, signupDay),
      canceled_at: cancelMonth === null ? "" : dateStr(cancelMonth, randInt(1, 28)),
      status: cancelMonth === null ? "active" : "canceled",
      startMonth: m,
      cancelMonth,
    });
  }
}

// -------------------------------------------------------------- invoices ----
const invoices = [];
let invSeq = 1;
for (const sub of subscriptions) {
  const cust = customers.find((c) => c.customer_id === sub.customer_id);
  const lastMonth = sub.cancelMonth === null ? MONTHS - 1 : sub.cancelMonth - 1;
  for (let m = sub.startMonth; m <= lastMonth; m++) {
    const amountEur = planPrice(sub.plan_id, m);
    const fx = FX_TO_EUR[cust.currency];
    const amount = Math.round((amountEur / fx) * 100) / 100;
    const issueDay = Math.min(randInt(1, 5), daysInMonth(m));
    const status = pickWeighted([["paid", 94], ["open", 3], ["uncollectible", 2], ["void", 1]]);
    invoices.push({
      invoice_id: `inv_${String(invSeq++).padStart(6, "0")}`,
      customer_id: sub.customer_id,
      subscription_id: sub.subscription_id,
      plan_id: sub.plan_id,
      invoice_date: dateStr(m, issueDay),
      month: monthStr(m),
      currency: cust.currency,
      amount,
      amount_eur: amountEur,
      status,
    });
  }
}

// -------------------------------------------------------------- payments ----
// Charges with gateway, failure codes, retries (dunning story).
const GATEWAYS = [["stripe", 60], ["adyen", 25], ["mollie", 15]];
const FAILURE_CODES = [
  ["card_declined", 35], ["insufficient_funds", 30], ["expired_card", 15],
  ["do_not_honor", 12], ["processing_error", 8],
];
const charges = [];
let chargeSeq = 1;
for (const inv of invoices) {
  if (inv.status === "void") continue;
  const gateway = pickWeighted(GATEWAYS);
  const day = Number(inv.invoice_date.slice(8, 10));
  // paid: 88% first-try success, else fail->retry chain that ends in success.
  // uncollectible: all attempts fail. open: no successful attempt yet.
  const failsFirst = inv.status !== "paid" || rand() < 0.12;
  let attempts;
  if (!failsFirst) {
    attempts = [{ ok: true, offset: 0 }];
  } else {
    const n = inv.status === "paid" ? randInt(1, 3) : randInt(2, 4);
    attempts = [];
    let offset = 0;
    for (let a = 0; a < n; a++) {
      attempts.push({ ok: false, offset });
      offset += pick([3, 5, 7]);
    }
    if (inv.status === "paid") attempts.push({ ok: true, offset });
  }
  for (let a = 0; a < attempts.length; a++) {
    const at = attempts[a];
    const d = new Date(`${inv.invoice_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + at.offset);
    charges.push({
      charge_id: `ch_${String(chargeSeq++).padStart(7, "0")}`,
      invoice_id: inv.invoice_id,
      customer_id: inv.customer_id,
      created_at: `${d.toISOString().slice(0, 10)}T${String(randInt(0, 23)).padStart(2, "0")}:${String(randInt(0, 59)).padStart(2, "0")}:00Z`,
      amount: inv.amount,
      currency: inv.currency,
      gateway,
      attempt: a + 1,
      status: at.ok ? "succeeded" : "failed",
      failure_code: at.ok ? "" : pickWeighted(FAILURE_CODES),
    });
  }
}

// ------------------------------------------------------------------ CSV ----
function toCSV(rows, columns) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(","));
  return lines.join("\n") + "\n";
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ["plans.csv", PLANS.map(({ plan_id, name, monthly_price_eur, price_after_eur }) => ({
    plan_id, name, monthly_price_eur,
    price_from_2026_03_eur: price_after_eur,
  })), ["plan_id", "name", "monthly_price_eur", "price_from_2026_03_eur"]],
  ["customers.csv", customers, ["customer_id", "name", "country", "currency", "segment", "signup_date"]],
  ["subscriptions.csv", subscriptions, ["subscription_id", "customer_id", "plan_id", "start_date", "canceled_at", "status"]],
  ["invoices.csv", invoices, ["invoice_id", "customer_id", "subscription_id", "plan_id", "invoice_date", "month", "currency", "amount", "amount_eur", "status"]],
  ["charges.csv", charges, ["charge_id", "invoice_id", "customer_id", "created_at", "amount", "currency", "gateway", "attempt", "status", "failure_code"]],
];
let total = 0;
for (const [file, rows, cols] of files) {
  const csv = toCSV(rows, cols);
  writeFileSync(join(OUT_DIR, file), csv);
  total += csv.length;
  console.log(`${file}: ${rows.length} rows, ${(csv.length / 1024).toFixed(1)} KiB`);
}
console.log(`total: ${(total / 1024 / 1024).toFixed(2)} MiB -> ${OUT_DIR}`);
