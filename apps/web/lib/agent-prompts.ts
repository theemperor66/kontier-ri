/**
 * Canned agent prompts, surfaced as "Copy prompt for agent" entries in the
 * command palette and as suggested-prompt chips on the empty state. Kontier
 * RI is agent-native: every prompt maps onto the registered WebMCP tools.
 */

export interface AgentPrompt {
  id: string;
  /** Short palette label. */
  label: string;
  /** Full prompt text copied to the clipboard. */
  prompt: string;
}

export const AGENT_PROMPTS: AgentPrompt[] = [
  {
    id: "build-revenue",
    label: "Build a revenue dashboard",
    prompt: "Profile my data and build a revenue dashboard.",
  },
  {
    id: "mrr-churn",
    label: "Show MRR and find the churn spike",
    prompt: "Show me MRR by month and find the churn spike.",
  },
  {
    id: "churn-drilldown",
    label: "Explain the churn spike",
    prompt: "Why did churn spike? Add a drill-down chart.",
  },
  {
    id: "arpu-kpi",
    label: "Add an ARPU KPI",
    prompt: "Add a KPI for average revenue per customer.",
  },
  {
    id: "failed-payments",
    label: "Investigate failed payments",
    prompt:
      "Which payment gateway and failure codes lose us the most money? Add charts and a summary annotation.",
  },
  {
    id: "polish",
    label: "Polish this dashboard",
    prompt:
      "Review the current dashboard: tighten titles, fix layouts, and annotate the most important insight on each chart.",
  },
];
