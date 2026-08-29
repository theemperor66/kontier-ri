import type { DashboardDoc } from "@/lib/dashboard-store";

/** Demo dashboard seeded from the public/demo CSVs (24 months of SaaS billing). */
export function buildDemoDoc(mode: "dark" | "light"): DashboardDoc {
  return {
    title: "SaaS revenue overview",
    theme: { mode },
    filters: { filters: [], dateRange: null },
    tiles: [
      {
        id: "demo_kpi_mrr",
        type: "kpi",
        title: "MRR (paid)",
        layout: { x: 0, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "invoices",
          sql: "WITH pm AS (SELECT month, CAST(sum(amount_eur) AS DOUBLE) AS v FROM invoices WHERE status = 'paid' GROUP BY 1) SELECT max(CASE WHEN rn = 1 THEN v END) AS value, max(CASE WHEN rn = 2 THEN v END) AS prev FROM (SELECT month, v, row_number() OVER (ORDER BY month DESC) AS rn FROM pm)",
          format: "currency",
          compare: "prev_period",
        },
        annotations: [],
      },
      {
        id: "demo_kpi_subs",
        type: "kpi",
        title: "Active subscriptions",
        layout: { x: 3, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "subscriptions",
          sql: "SELECT count(*) AS value FROM subscriptions WHERE status = 'active'",
          format: "number",
        },
        annotations: [],
      },
      {
        id: "demo_kpi_success",
        type: "kpi",
        title: "Payment success rate",
        layout: { x: 6, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "charges",
          sql: "SELECT sum(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)::DOUBLE / count(*) AS value FROM charges",
          format: "percent",
        },
        annotations: [],
      },
      {
        id: "demo_kpi_customers",
        type: "kpi",
        title: "Total customers",
        layout: { x: 9, y: 0, w: 3, h: 2 },
        spec: {
          dataset: "customers",
          sql: "SELECT count(*) AS value FROM customers",
          format: "number",
        },
        annotations: [],
      },
      {
        id: "demo_chart_mrr",
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
        },
        annotations: [],
      },
      {
        id: "demo_chart_planmix",
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
        },
        annotations: [],
      },
      {
        id: "demo_chart_churn",
        type: "chart",
        title: "Churned subscriptions by month",
        layout: { x: 0, y: 7, w: 5, h: 5 },
        spec: {
          dataset: "subscriptions",
          query: {
            sql: "SELECT strftime(canceled_at, '%Y-%m') AS month, count(*) AS churned FROM subscriptions WHERE canceled_at IS NOT NULL GROUP BY 1 ORDER BY 1",
          },
          chartType: "bar",
          xKey: "month",
          color: "var(--chart-5)",
        },
        annotations: [],
      },
      {
        id: "demo_table_failed",
        type: "table",
        title: "Recent failed charges",
        layout: { x: 5, y: 7, w: 7, h: 5 },
        spec: {
          dataset: "charges",
          sql: "SELECT strftime(CAST(created_at AS TIMESTAMP), '%Y-%m-%d') AS date, customer_id, round(amount, 2) AS amount, currency, gateway, failure_code, attempt FROM charges WHERE status = 'failed' ORDER BY created_at DESC LIMIT 200",
          pageSize: 8,
        },
        annotations: [],
      },
    ],
  };
}
