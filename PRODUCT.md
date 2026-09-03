# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Inferred from the explicit brief and repository evidence.** The primary user is a SaaS operator, finance lead, or revenue owner who needs to investigate a business signal without waiting for a data team. A secondary audience is the OpenAI WebMCP hackathon judge evaluating whether the product demonstrates a credible new human-agent workflow rather than a scripted web demo.

## Product Purpose

Kontier RI is a local-first revenue investigation workspace. A human and a browser agent work on the same live dashboard: the human points, brushes, arranges, and approves; the agent profiles data, queries it, drafts evidence, and explains its work through WebMCP. Success means a first-time user can move from a visible anomaly to a reviewed, editable conclusion in one short session while staying in control.

## Positioning

Unlike a chatbot that returns disposable charts or a BI copilot that hides behind a prompt box, Kontier RI turns the live artifact itself into shared context. Human gestures change what the agent can see and do. Agent actions return to that same canvas with attribution, review, conflict protection, and undo.

## Operating Context

- The product runs as a Next.js web app and registers imperative WebMCP tools from the top-level document.
- A browser agent in ChatGPT or a compatible Chrome runtime invokes those tools.
- DuckDB-WASM runs SQL inside the tab. CSV and Parquet uploads stay in browser memory.
- Users may start from synthetic demo billing data, templates, a 100M-row remote Parquet demo, or their own files.
- The primary workflow is: frame a question → indicate focus → share a plan → investigate → request human judgment where needed → review proposed changes → commit evidence to the dashboard.

## Capabilities and Constraints

- Existing capabilities include multi-page dashboards, 12 chart types, KPIs, tables, cross-filtering, brushing, annotations, calculated fields, SQL views, export, share links, local persistence, command history, and dynamic tile-scoped tools.
- Every agent mutation must remain attributed, undoable, and subject to the recent-human-edit conflict rule.
- Read tools must remain row-capped. SQL must remain read-only. Raw uploaded data must not leave the tab.
- Presence must be driven by real WebMCP calls or explicit human input. The interface must not simulate agent activity.
- WebMCP is not available in every browser. The product must explain that state without blocking human exploration.
- **Open decision:** the identity of the connected browser agent is not exposed reliably by WebMCP, so the interface uses the neutral label “Agent” rather than inventing a persona.

## Brand Commitments

Preserve the Kontier name and logo, the existing brand blue, and the agent-violet attribution language. The voice is calm, exact, candid, and product-led. It avoids AI hype and treats user control as a working mechanism rather than a slogan.

## Evidence on Hand

- Working product implementation under `apps/web`, `packages/studio`, and `packages/datasource`.
- Unit and end-to-end tests for WebMCP registration, schemas, query guards, store commands, presence, and core workbench flows.
- Real product screenshots in `docs/media/`.
- Tool contracts in `docs/TOOLS.md` and API research in `docs/webmcp-api-notes.md`.
- Synthetic SaaS billing demo data. No customer testimonials or external performance claims should be invented.

## Product Principles

1. The canvas is the conversation. Human focus and agent work meet on one editable artifact.
2. Agency must be legible. Show the goal, plan, current focus, proposed changes, decisions, and provenance.
3. Approval is a product object. Important uncertainty becomes a structured handoff, not buried chat text.
4. Local-first is a trust boundary. Query in the tab and expose only compact, intentional tool results.
5. Useful without magic. The human workbench remains complete when WebMCP is unavailable.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Every agent state, decision, proposal, and status change needs a keyboard path and a screen-reader equivalent. Mobile is a review and exploration surface with stacked tiles, not a compressed desktop grid.
