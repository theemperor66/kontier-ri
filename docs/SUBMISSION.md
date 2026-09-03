# Devpost Submission Kit

## Project name
Kontier RI — Revenue Investigation Workspace

## Tagline
Write a brief, point at the anomaly, approve the work: a browser agent
investigates your revenue data on the same live dashboard, and nothing changes
until you say yes.

## Text description (maps 1:1 to judging criteria)

**Why this use case is a strong fit for WebMCP (WebMCP Leverage).**
Revenue investigation is a deep-UI problem. The question ("why did churn spike
in March?") needs schema knowledge, SQL, chart construction and human judgment
about which explanation counts. An agent clicking through a BI UI fails. A
headless API removes the human from the loop. WebMCP puts the agent inside the
same live document the human is looking at. Kontier RI registers 40 static
tools from the page through `document.modelContext`, plus three small bundles
that mount and unmount with the state of the work: 3 selection-scoped tools
while a tile is selected, 2 while a change set waits for review
(`revise_change_set`, `withdraw_change_set`), and 1 while a question waits
(`withdraw_decision`) — up to 46 registered. Each bundle is a React component,
so the names the agent can see describe what it can do right now. Every tool
input is a zod v4 schema: `z.toJSONSchema()` produces the protocol `inputSchema` and
`safeParse` re-validates the same shape inside `execute`, so the contract
cannot drift. SQL runs in-page through DuckDB-WASM, so `run_sql` is a real
analytics engine while raw rows never leave the tab.

**How it creates a better user experience (Execution).**
The product implements a collaboration protocol, not a chat box. A human writes
a brief. The agent calls `get_work_context` first and receives the brief, the
plan, pending reviews, answered decisions, the human's live focus (selected
tile, brushed range, cross-filter, recent edits), the last commands, and a
four-rule working agreement. It publishes a plan with `present_plan` and ticks
steps with `update_plan_step`. When something is genuinely ambiguous it calls
`request_decision` with 2 to 5 options and an optional recommendation, and the
human answers in the Approvals view. Findings arrive as `propose_insight`
proposals with Approve and Reject buttons. **Nothing is applied until the human
approves.** Approved actions run through the same command layer as human edits:
attributed to the agent, logged, undoable, and blocked from overwriting any
property the human touched in the last 10 minutes. Larger work arrives as a
staged change set: `propose_change_set` groups 1 to 8 related edits with a
reason per row, nothing runs on propose, the human skips the rows they do not
want, and the approved rows land as ONE undo entry and ONE activity entry. A
partial approval is recorded as `partially_applied` with the exact rows that
ran, and a failure mid-apply restores the document and the history exactly.
`complete_work` closes the session with a summary and outcomes. Completed
sessions are kept in the browser and listed on Home as past investigations.

**What people and agents can do together that was difficult or impossible
before (Potential Impact).**
Human gestures become agent context, and agent output becomes reviewable
product state. Brush a revenue dip, share a brief, and the agent reads that
exact range, investigates with SQL, asks which definition of churn you want,
and returns a drill-down tile and an annotation as one staged change set. You
keep the rows you agree with. The result is not a chat transcript. It is an
edited dashboard with an audit trail, a record of what you approved and what
you dropped, and one-keystroke undo. Audience: SaaS operators, finance leads and revenue owners
who need answers without waiting for a data team. Built by a billing-SaaS team
(Kontier) as the future analytics engine of our product.

**How we implemented WebMCP.**
`useWebMCPTool` is a React hook: it resolves `document.modelContext` (with a
`navigator.modelContext` fallback), converts zod v4 to JSON Schema, re-validates
input, tolerates hosts that call `execute(input)` without an options object, and
unregisters through an `AbortController` on unmount. The same hook gives the
adaptive toolbelt: `SelectedTileTools` and `PhaseScopedTools` are components
that mount with a selection, a pending change set or an unanswered question,
so their tools register and unregister with the work, and their descriptions
name the live ids. It also reports a real
registration lifecycle per tool (`unavailable`, `registering`, `ready`,
`failed`), which is what the connection pill displays: "Agent ready" only when
every expected tool registered, "Agent setup issue" with the failing tool names
otherwise. If a host injects `modelContext` after hydration, the hook re-checks
once per second and then registers. Read tools carry `readOnlyHint` and
`untrustedContentHint`, because their results echo dataset values and human
text. Monorepo: `packages/datasource` (DataSource interface + DuckDB-WASM),
`packages/studio` (store, command layer, tools, hook), `apps/web` (Next.js 16
shell, canvas, workspace views).

## Demo script (<3:00)

| t | Shot | Beat |
|---|---|---|
| 0:00–0:20 | The workspace: navy rail, light canvas, agent panel on the right | "This is a revenue investigation workspace. The dashboard is the shared context, not a chat window." |
| 0:20–0:40 | Type the brief "Explain the March churn spike and show the evidence", press Share brief | "I give the work a finish line. The brief becomes a work session my agent can read." |
| 0:40–1:05 | Agent calls `get_work_context`, then `present_plan`; steps tick over | "It orients first: the brief, my selection, my recent edits, and the working agreement. Then it publishes a plan and works in the open." |
| 1:05–1:35 | A decision card appears with options; pick one and add a note | "When the answer depends on my judgment, it asks a structured question instead of guessing. My answer flows back on its next context read." |
| 1:35–2:05 | A staged change set appears with one diff row per action; untick one row; press Approve; the tiles land with an agent chip; one Cmd+Z removes the whole set | "Bigger work arrives as one change set, not as edits. I read it as a diff, drop the row I do not want, and approve the rest. It goes through the same command layer as my own edits: attributed, logged, and undoable as a single step." |
| 2:05–2:25 | Edit a title, then let the agent try to change it; conflict result | "It cannot overwrite what I just touched. Ten-minute protection. It has to ask." |
| 2:25–2:45 | Approvals, Audit log, Data health lineage, Datasets | "Every governance surface reads live state. No fake refresh times, no invented owners." |
| 2:45–3:00 | Status pill, repo, AGPL badge | "Forty tools, up to forty-six while work is open, real registration health, local DuckDB. AGPL open source." |

## Submission form checklist
- [ ] Devpost registration + team (user account)
- [ ] Live URL — verified in the ChatGPT in-app browser AND Chrome 149+ with the flag
- [ ] Repo URL github.com/theemperor66/kontier-ri — license visible in About ✓ (AGPL-3.0 detected)
- [ ] Video: YouTube public, <3:00, audio demo, no third-party marks/music
- [ ] Text description (above, trimmed to form limits)
- [ ] Testing instructions: Chrome flag steps + ChatGPT browser steps + suggested prompts
- [ ] No credentials needed (public app)

## Pre-submit hardening
- [x] Self-host duckdb-wasm bundles (drop the jsDelivr runtime dependency) —
      copied to public/duckdb/ at build time, same-origin with a CDN fallback;
      e2e asserts zero jsDelivr requests
- [x] Honest registration health — per-tool status, visible failures, and an
      e2e test that a failed registration never reports a ready state
- [x] Late-host registration — an e2e test injects `modelContext` after
      hydration and asserts the tools still register
- [ ] Re-run a fresh-profile check of the live URL (cold cache): DuckDB boots,
      the demo tiles render, and no CDN requests are made. The checker exists:
      `VERIFY_URL=<live-url> node apps/web/scripts/verify-live.mjs`
- [x] README, tool catalog and design spec rewritten for the investigation loop
- [x] OG meta tags + favicon (judges share links)
- [ ] R1 verified: dynamic tool mount/unmount inside the ChatGPT browser
      (fallback ready: keep them always registered and error "no tile selected")

## Live URL
GitHub Pages: https://theemperor66.github.io/kontier-ri/ — deployed on every
push to main via .github/workflows/deploy.yml (static export, basePath
/kontier-ri). Root-path deploys need no env changes.

## Voice-over script (verbatim, ~2:50 at normal pace)

**[0:00 — the workspace, light canvas, agent panel open]**
"This is Kontier RI: a revenue investigation workspace. On the left, the real
navigation of a BI product. In the middle, a live dashboard. On the right, the
agent panel. There is no chat window, because the dashboard is the conversation.
The page registers forty WebMCP tools that any browser agent can call, and
the data loads into DuckDB inside my browser. Raw rows never leave the page."

**[0:22 — type the brief, press Share brief]**
"I start by giving the work a finish line: explain the March churn spike and
show the evidence. That brief becomes a work session."

**[0:40 — agent picks it up: get_work_context, then a plan]**
"My agent calls get_work_context first. It gets the brief, my current selection,
my recent edits, the open review queue, and a working agreement: agent edits are
attributed and undoable, my edits from the last ten minutes are protected, raw
data stays local, and uncertain changes need my approval. Then it publishes a
plan, and I watch the steps tick over."

**[1:05 — the decision card]**
"Here is the part I care about. It hits a real ambiguity: do we count churn by
subscription or by revenue? Instead of guessing, it calls request_decision. Two
clear options, its own recommendation, and space for my note. I answer, and the
answer flows back to the agent on its next context read."

**[1:35 — change set, skip a row, approve, undo]**
"Its work arrives as a change set, not as edits. Four related changes, each with
its reason, and nothing has touched my dashboard yet. I drop the one I do not
want and approve the rest. Only now do the tiles land, marked as the agent's
work, in the activity log, and undoable with one keystroke — the whole set, in
one step. On its next read, the agent sees exactly which rows I kept.

**[2:05 — conflict rule]**
"And it cannot run me over. I just retitled this tile. When the agent tries to
change the same property, it gets a conflict and has to ask."

**[2:25 — Approvals, Audit log, Data health]**
"Approvals, the audit log, datasets, the semantic model, lineage: every one
reads live state. No invented refresh schedules, no fake owners, no assistant
persona, because WebMCP does not tell the page which agent is calling."

**[2:45 — status pill, repo]**
"The status pill reports real registration results, not feature detection.
Forty tools, and up to forty-six: the toolbelt grows while a tile is selected
or a review is open. AGPL open source, built
on the stack of our billing product. This is what a shared workspace looks like
when the human stays in charge."

## Judge testing instructions (paste into the submission form)

Option A — ChatGPT in-app browser (recommended, zero setup):
1. Open the ChatGPT app, open its built-in browser, and go to: <LIVE_URL>
2. The status pill in the top bar reads "Agent ready". Hover it: the tooltip
   states how many tools registered. It reports real registration results, so a
   failure shows "Agent setup issue" with the failing tool names.
3. Load the demo dashboard (24 months of synthetic SaaS billing data), pick a
   template, or upload your own CSV or Parquet. Your file stays in the browser.
4. In the agent panel on the right, type a brief and press **Share brief**, for
   example: "Explain the March churn spike and show the evidence."
5. Tell the agent: "Pick up the active brief in Kontier RI. Read
   get_work_context first, share a plan, and use request_decision when my
   judgment is needed." (The panel has a "Copy handoff prompt" button with
   exactly this text.)
6. Watch the loop: the plan appears in the Suggestions tab; open **Approvals**
   in the left rail to answer any decision and to approve or reject proposals.
   Nothing touches the dashboard until you approve.
7. Try the staged change set. Ask: "Group the rest of the work into one change
   set with propose_change_set, with a note per action." A review card appears
   with one diff row per action. **Untick one row**, then press Approve: only
   the kept rows are applied, the set is marked partially applied, and ONE
   Cmd+Z reverts the whole set. Ask the agent to read `get_work_context` again
   — it sees your verdict and which rows ran. If you comment instead of
   approving, the agent can call `revise_change_set`; that tool exists only
   while the set is open.
8. Check control: approved changes appear in **Audit log** attributed to the
   agent, with undo. Edit a tile title yourself, then ask the agent to change
   the same title. It gets a conflict and must ask you.
9. Author something yourself: press **Add visual**, pick a dataset, a group-by
   field, a measure and a visual type. The preview runs the real query. Adding
   commits one undoable human command — the same command layer the agent
   uses. When the session completes, it is listed on Home under **Past
   investigations** (local to your browser, clearable).
10. Check the guard rails: ask it to DROP a table (the SELECT-only guard
   refuses), or send a malformed tile spec (strict zod schemas reject it with a
   readable error).
11. Optional depth: watch the toolbelt change. Select a tile and 3
   selection-scoped tools register (40 -> 43); while a change set waits for
   review, 2 more register; while a question waits, 1 more — 46 at the
   maximum, and each bundle disappears when its queue empties. Then
   brush a date range or click a bar to cross-filter, open ⌘K, visit the
   "Growth drivers" page for combo, scatter, heatmap and a calculated-field KPI,
   and look at **Data health** for tile-to-dataset lineage.

Option B — Google Chrome 149+:
1. chrome://flags/#enable-webmcp-testing -> Enabled -> restart Chrome.
2. Open <LIVE_URL> and drive it with a WebMCP-capable agent or the Model
   Context Tool Inspector extension. Same flow as above.

Without a WebMCP host, the workspace still works as a human BI tool: the status
pill reads "Connect agent" and every surface stays usable.

No login, no credentials, free of charge. All SQL runs locally through
DuckDB-WASM; the agent only sees the row-capped results of tools it calls.

## Reproducible checks
```bash
pnpm install
pnpm -r test                # 253 unit tests (datasource 40, studio 213)
pnpm --filter web test:e2e  # 33 Playwright tests, including the full
                            # brief -> plan -> decision -> change set -> complete loop
pnpm -r typecheck
pnpm -r build
```
