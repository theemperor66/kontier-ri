import type { DashboardDoc, Tile, TileType } from "@/lib/dashboard-store";
import { genId, migrateDoc } from "@/lib/dashboard-store";

/**
 * Templates gallery: doc JSON factories instantiated against the bundled
 * demo datasets (plans, customers, subscriptions, invoices, charges).
 * Entry points: empty state, command palette, dashboard manager.
 */

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Tile-type mix shown as mini preview in the gallery card. */
  preview: TileType[];
  build: (mode: "dark" | "light") => DashboardDoc;
}

type TileSeed = Omit<Tile, "id" | "annotations">;

function makeTiles(seeds: TileSeed[]): Tile[] {
  return seeds.map((seed) => ({ ...seed, id: genId("tile"), annotations: [] }));
}

function buildRevenueOverview(mode: "dark" | "light"): DashboardDoc {
  return migrateDoc({
    title: "Revenue overview",
    theme: { mode },
    filters: { filters: [], dateRange: null },
    tiles: makeTiles([
      {
        type: "kpi",
        title: "MRR (paid)",
        layout: { x: 0, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "invoices",
          sql: "WITH pm AS (SELECT month, CAST(sum(amount_eur) AS DOUBLE) AS v FROM invoices WHERE status = 'paid' GROUP BY 1) SELECT max(CASE WHEN rn = 1 THEN v END) AS value, max(CASE WHEN rn = 2 THEN v END) AS prev FROM (SELECT month, v, row_number() OVER (ORDER BY month DESC) AS rn FROM pm)",
          format: "currency",
          compare: "prev_period",
        },
      },
      {
        type: "kpi",
        title: "ARPU (latest month)",
        layout: { x: 3, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "invoices",
          sql: "SELECT CAST(sum(amount_eur) AS DOUBLE) / count(DISTINCT customer_id) AS value FROM invoices WHERE status = 'paid' AND month = (SELECT max(month) FROM invoices)",
          format: "currency",
        },
      },
      {
        type: "kpi",
        title: "Paying customers",
        layout: { x: 6, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "invoices",
          sql: "SELECT count(DISTINCT customer_id) AS value FROM invoices WHERE status = 'paid' AND month = (SELECT max(month) FROM invoices)",
          format: "number",
        },
      },
      {
        type: "kpi",
        title: "Invoices collected",
        layout: { x: 9, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "invoices",
          sql: "SELECT CAST(sum(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS value FROM invoices",
          format: "percent",
        },
      },
      {
        type: "chart",
        title: "MRR by month (EUR)",
        layout: { x: 0, y: 2, w: 7, h: 5 },
        spec: {
          dataset: "invoices",
          query: {
            sql: "SELECT month, CAST(round(sum(amount_eur)) AS DOUBLE) AS mrr_eur FROM invoices WHERE status = 'paid' GROUP BY 1 ORDER BY 1",
          },
          chartType: "line",
          xKey: "month",
          analytics: { trendline: true },
          format: { value: "currency" },
        },
      },
      {
        type: "chart",
        title: "MRR by plan",
        layout: { x: 7, y: 2, w: 5, h: 5 },
        spec: {
          dataset: "invoices",
          query: {
            sql: "SELECT month, CAST(round(sum(CASE WHEN plan_id = 'plan_starter' THEN amount_eur ELSE 0 END)) AS DOUBLE) AS starter, CAST(round(sum(CASE WHEN plan_id = 'plan_growth' THEN amount_eur ELSE 0 END)) AS DOUBLE) AS growth, CAST(round(sum(CASE WHEN plan_id = 'plan_scale' THEN amount_eur ELSE 0 END)) AS DOUBLE) AS scale, CAST(round(sum(CASE WHEN plan_id = 'plan_enterprise' THEN amount_eur ELSE 0 END)) AS DOUBLE) AS enterprise FROM invoices WHERE status = 'paid' GROUP BY 1 ORDER BY 1",
          },
          chartType: "bar",
          stacked: true,
          xKey: "month",
          format: { value: "currency" },
        },
      },
      {
        type: "chart",
        title: "Revenue by customer segment",
        layout: { x: 0, y: 7, w: 5, h: 4 },
        spec: {
          dataset: "invoices",
          query: {
            sql: "SELECT c.segment, CAST(round(sum(i.amount_eur)) AS DOUBLE) AS revenue_eur FROM invoices i JOIN customers c USING (customer_id) WHERE i.status = 'paid' GROUP BY 1 ORDER BY 2 DESC",
          },
          chartType: "donut",
          xKey: "segment",
          format: { value: "currency" },
        },
      },
      {
        type: "table",
        title: "Top customers by revenue",
        layout: { x: 5, y: 7, w: 7, h: 4 },
        spec: {
          dataset: "invoices",
          sql: "SELECT c.name, c.country, c.segment, CAST(round(sum(i.amount_eur)) AS DOUBLE) AS revenue_eur, count(*) AS invoices FROM invoices i JOIN customers c USING (customer_id) WHERE i.status = 'paid' GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 100",
          pageSize: 8,
        },
      },
    ]),
  });
}

function buildChurnRetention(mode: "dark" | "light"): DashboardDoc {
  return migrateDoc({
    title: "Churn & retention",
    theme: { mode },
    filters: { filters: [], dateRange: null },
    tiles: makeTiles([
      {
        type: "kpi",
        title: "Active subscriptions",
        layout: { x: 0, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "subscriptions",
          sql: "SELECT count(*) AS value FROM subscriptions WHERE status = 'active'",
          format: "number",
        },
      },
      {
        type: "kpi",
        title: "Total churned",
        layout: { x: 3, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "subscriptions",
          sql: "SELECT count(*) AS value FROM subscriptions WHERE canceled_at IS NOT NULL",
          format: "number",
        },
      },
      {
        type: "kpi",
        title: "Churn rate (all-time)",
        layout: { x: 6, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "subscriptions",
          sql: "SELECT CAST(sum(CASE WHEN canceled_at IS NOT NULL THEN 1 ELSE 0 END) AS DOUBLE) / count(*) AS value FROM subscriptions",
          format: "percent",
        },
      },
      {
        type: "kpi",
        title: "Median customer age (days)",
        layout: { x: 9, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "subscriptions",
          sql: "SELECT CAST(median(date_diff('day', CAST(start_date AS DATE), coalesce(CAST(canceled_at AS DATE), current_date))) AS DOUBLE) AS value FROM subscriptions",
          format: "number",
        },
      },
      {
        type: "chart",
        title: "Churned subscriptions by month",
        layout: { x: 0, y: 2, w: 7, h: 5 },
        spec: {
          dataset: "subscriptions",
          query: {
            sql: "SELECT strftime(CAST(canceled_at AS DATE), '%Y-%m') AS month, count(*) AS churned FROM subscriptions WHERE canceled_at IS NOT NULL GROUP BY 1 ORDER BY 1",
          },
          chartType: "bar",
          xKey: "month",
          color: "var(--destructive)",
        },
      },
      {
        type: "chart",
        title: "Subscription status by plan",
        layout: { x: 7, y: 2, w: 5, h: 5 },
        spec: {
          dataset: "subscriptions",
          query: {
            sql: "SELECT p.name AS plan, sum(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) AS active, sum(CASE WHEN s.status <> 'active' THEN 1 ELSE 0 END) AS churned FROM subscriptions s JOIN plans p USING (plan_id) GROUP BY 1 ORDER BY 2 DESC",
          },
          chartType: "stacked100",
          xKey: "plan",
          legend: true,
        },
      },
      {
        type: "chart",
        title: "New vs churned per month",
        layout: { x: 0, y: 7, w: 7, h: 4 },
        spec: {
          dataset: "subscriptions",
          query: {
            sql: "WITH new_subs AS (SELECT strftime(CAST(start_date AS DATE), '%Y-%m') AS month, count(*) AS started FROM subscriptions GROUP BY 1), churned AS (SELECT strftime(CAST(canceled_at AS DATE), '%Y-%m') AS month, count(*) AS churned FROM subscriptions WHERE canceled_at IS NOT NULL GROUP BY 1) SELECT n.month, n.started, coalesce(c.churned, 0) AS churned FROM new_subs n LEFT JOIN churned c USING (month) ORDER BY 1",
          },
          chartType: "area",
          xKey: "month",
        },
      },
      {
        type: "markdown",
        title: "How to read this",
        layout: { x: 7, y: 7, w: 5, h: 4 },
        spec: {
          content:
            "### Churn playbook\n\n- **Churned by month** is the alarm tile — spikes mean a cohort or billing problem.\n- Cross-check spikes against **payment failures** (Payments ops template).\n- Ask your agent: *\"Why did churn spike? Add a drill-down chart.\"*",
        },
      },
    ]),
  });
}

function buildPaymentsOps(mode: "dark" | "light"): DashboardDoc {
  return migrateDoc({
    title: "Payments ops",
    theme: { mode },
    filters: { filters: [], dateRange: null },
    tiles: makeTiles([
      {
        type: "kpi",
        title: "Payment success rate",
        layout: { x: 0, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "charges",
          sql: "SELECT sum(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)::DOUBLE / count(*) AS value FROM charges",
          format: "percent",
        },
      },
      {
        type: "kpi",
        title: "Failed charges",
        layout: { x: 3, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "charges",
          sql: "SELECT count(*) AS value FROM charges WHERE status = 'failed'",
          format: "number",
        },
      },
      {
        type: "kpi",
        title: "Failed volume (EUR est.)",
        layout: { x: 6, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "charges",
          sql: "SELECT CAST(round(sum(amount)) AS DOUBLE) AS value FROM charges WHERE status = 'failed'",
          format: "currency",
        },
      },
      {
        type: "kpi",
        title: "Avg attempts per charge",
        layout: { x: 9, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "charges",
          sql: "SELECT CAST(avg(attempt) AS DOUBLE) AS value FROM charges",
          format: "number",
        },
      },
      {
        type: "chart",
        title: "Charge outcomes by month",
        layout: { x: 0, y: 2, w: 7, h: 5 },
        spec: {
          dataset: "charges",
          query: {
            sql: "SELECT strftime(CAST(created_at AS TIMESTAMP), '%Y-%m') AS month, sum(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded, sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM charges GROUP BY 1 ORDER BY 1",
          },
          chartType: "bar",
          stacked: true,
          xKey: "month",
        },
      },
      {
        type: "chart",
        title: "Failure codes",
        layout: { x: 7, y: 2, w: 5, h: 5 },
        spec: {
          dataset: "charges",
          query: {
            sql: "SELECT coalesce(failure_code, 'unknown') AS failure_code, count(*) AS failures FROM charges WHERE status = 'failed' GROUP BY 1 ORDER BY 2 DESC",
          },
          chartType: "pie",
          xKey: "failure_code",
        },
      },
      {
        type: "chart",
        title: "Failed volume by gateway",
        layout: { x: 0, y: 7, w: 5, h: 4 },
        spec: {
          dataset: "charges",
          query: {
            sql: "SELECT gateway, CAST(round(sum(amount)) AS DOUBLE) AS failed_amount FROM charges WHERE status = 'failed' GROUP BY 1 ORDER BY 2 DESC",
          },
          chartType: "bar",
          xKey: "gateway",
          color: "var(--destructive)",
        },
      },
      {
        type: "table",
        title: "Recent failed charges",
        layout: { x: 5, y: 7, w: 7, h: 4 },
        spec: {
          dataset: "charges",
          sql: "SELECT strftime(CAST(created_at AS TIMESTAMP), '%Y-%m-%d') AS date, customer_id, round(amount, 2) AS amount, currency, gateway, failure_code, attempt FROM charges WHERE status = 'failed' ORDER BY created_at DESC LIMIT 200",
          pageSize: 8,
        },
      },
    ]),
  });
}

export const TEMPLATES: TemplateDef[] = [
  {
    id: "revenue-overview",
    name: "Revenue overview",
    description: "MRR, ARPU, plan mix and top customers from your billing data.",
    preview: ["kpi", "kpi", "chart", "chart", "table"],
    build: buildRevenueOverview,
  },
  {
    id: "churn-retention",
    name: "Churn & retention",
    description: "Churn spikes, plan-level retention and new-vs-lost trends.",
    preview: ["kpi", "kpi", "chart", "chart", "markdown"],
    build: buildChurnRetention,
  },
  {
    id: "payments-ops",
    name: "Payments ops",
    description: "Success rates, failure codes and gateways that lose you money.",
    preview: ["kpi", "kpi", "chart", "chart", "table"],
    build: buildPaymentsOps,
  },
];

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
