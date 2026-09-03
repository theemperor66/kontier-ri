# Kontier RI — Devpost submission (ready to paste)

*Every number in this file was read from the code in this repository or from a
live HTTP response on 2026-09-03. Nothing here is estimated.*

---

## Project name

**Kontier RI — shared investigation workspace**

## Tagline (114 chars)

A shared investigation workspace where people and agents edit one live report:
consent, attribution, one-key undo.

## Thesis (one paragraph, for the top of the Devpost description)

Kontier RI is a shared investigation workspace. Several humans and several
agents work the same live report at the same time, under one enforced
human–agent contract: nothing changes without consent, every change is
attributed, and one keystroke reverses it. The agent does not drive a chat
sidebar. It registers WebMCP tools on the page and edits the same document the
humans are looking at. Kontier RI is the analytics workspace of Kontier, a
production multi-tenant billing platform, so the problem is one we hit in
production. The public demo runs on deterministic synthetic billing data with
the same shape.

---

## 1. WebMCP Leverage

> *"How thoroughly and skillfully does the project use WebMCP? Does the code
> reflect genuine effort and a working, non-trivial implementation?"*

The page registers **40 static tools**, plus three small bundles that mount and
unmount with the state of the work: **3** while a tile is selected, **2** while
a change set waits for review, **1** while a question waits for an answer.
**46 tools at the maximum.** The lists are code, not prose:
`STATIC_TOOL_NAMES`, `DYNAMIC_TOOL_NAMES`, `PROPOSAL_TOOL_NAMES` and
`DECISION_TOOL_NAMES` in `packages/studio/src/webmcp/tools.ts`.

This follows Chrome's own guidance rather than inventing a pattern. Chrome
writes: *"static registration should be the default approach"* and *"Register
tools when they're useful in a certain page state, then unregister when the
tool is no longer usable."* Static is our default. The three dynamic bundles are
React components: mounting registers, unmounting unregisters through an
`AbortController`. Their descriptions are rebuilt on every mount and name the
live change-set and decision ids, so the agent never guesses which proposal it
is revising.

**One schema per tool, used twice.** Each tool has one zod v4 schema.
`z.toJSONSchema()` produces the protocol `inputSchema`, and the *same* schema
re-validates the arguments with `safeParse` inside `execute`. The declared
contract and the enforced contract cannot drift.

**Hints are declared on every tool, and a test holds the line.** 13 read tools
declare `readOnlyHint: true` **and** `untrustedContentHint: true`, because their
results echo dataset values, dashboard copy and human notes. The other 33
declare `readOnlyHint: false` explicitly. Silence on a mutating tool is a
missing declaration, not a neutral one, so
`packages/studio/test/tool-hints.test.ts` fails the build if any tool declares
nothing or declares the wrong hint.

**Chrome's character budgets are a test, not a hope.** Chrome publishes 30
characters per tool name and parameter name, 500 per tool description, 150 per
parameter description. `packages/studio/test/tool-budgets.test.ts` enforces all
four, plus a 20-character floor so a description cannot be trimmed into
uselessness. `add_tile` was 888 characters when that test was written.

**A tool call ledger, including calls the host rejected.** WebMCP is invisible
by design: a tool runs and the result goes into a model's context, leaving no
trace on the page. `packages/studio/src/webmcp/call-log.ts` is a 200-entry ring
buffer written from inside `execute`. It records the tool name, an argument
preview, duration in ms, the read/write badge taken from the same serialized
annotations used at registration, and — the part that matters — **schema
failures the host rejected before the tool body ran**, marked `rejected`. Those
calls are invisible everywhere else: nothing changed, so no document edit and no
activity entry exist to hint at them.

**The page reports its own WebMCP state.** The ChatGPT in-app browser has no
devtools, so `apps/web/components/chrome/agent-diagnostics.tsx` prints a
copyable report: `document.modelContext` present, `navigator.modelContext`
present, expected vs `ready` vs `registering` vs `failed` vs never-reported tool
counts with the failure message per tool, secure context, cross-origin
isolation, WebAssembly, `SharedArrayBuffer`, and the data-engine status. `?diag=1`
opens it, so a bug report is one URL.

**Host reality is handled, not assumed.** The hook resolves
`document.modelContext` with a `navigator.modelContext` fallback; if a host
injects `modelContext` after hydration it re-checks once per second and
registers on the first real attempt; it tolerates hosts that call
`execute(input)` with no options object and falls back to the
registration-lifetime `AbortSignal`; and it turns a thrown error into
`{ error }` so the model reads actionable text instead of an opaque failure.

**353 unit tests pass** across 22 files (`packages/studio` 234, `packages/workspace`
79, `packages/datasource` 40), next to 43 Playwright end-to-end tests in 14 spec
files. 28,150 lines of source and 7,718 lines of tests.

---

## 2. Execution

> *"Does the project deliver a working or runnable project that has a complete,
> coherent product experience — not just a technical proof of concept?"*

Kontier RI is the analytics workspace of **Kontier**, a production multi-tenant
billing platform. It is not a standalone demo, and the workspace is not a toy
state container.

**The server is the system of record.** `packages/workspace` defines one
`WorkspaceStore` seam covering dashboards, version snapshots, investigation
records, an ordered command log and presence. Two implementations exist —
`LocalWorkspaceStore` and `HttpWorkspaceStore` — and both are proved by the
*same* shared conformance suite, `describeWorkspaceStoreContract`. That is what
makes the seam real: the identical contract is driven once against browser
storage and once against the REST API through a mock server — 79 passing tests
in total (39 local, 40 HTTP).

**Ordering is a server property.** `seq` is assigned by the server, never by a
client. It is strictly increasing from 1 per dashboard, which gives every
participant — human or agent — the *same total order* of events. `at` is a
client clock and is kept for display only. A reader polls
`GET /api/workspace/dashboards/:id/commands?since=<cursor>` and applies entries
in `seq` order. The cursor stays monotonic even after the 1000-entry log evicts
its oldest rows. 6 route files, 13 handlers, bearer-token auth with a
constant-time digest compare, one token = one workspace, atomic
temp-file-plus-rename writes, and a per-workspace promise chain so two requests
can never interleave a read-modify-write.

**The signature moment.** An agent calls `propose_change_set` with 1 to 8
related edits and a written reason per row. **Nothing runs on propose.** A
different human opens the card, unticks the rows they disagree with, and
approves the rest. What happens then is the whole point:

- The approved rows run through the same command layer as human edits.
- A version snapshot named `Before "<title>"` is saved first, automatically.
- The result collapses into **one undo entry and one activity entry**,
  attributed to the agent — Cmd+Z reverses the entire approved set.
- The set is recorded as `applied` or `partially_applied` **with the exact row
  indexes that ran**, so the agent can see on its next read what the human kept
  and what they dropped.
- If any row fails mid-apply, the document, undo stack, redo stack, activity
  log and selection are all restored exactly, and nothing is applied.

**The contract is enforced, not advertised.** A human edit is protected for 10
minutes: an agent tool that would overwrite a property the human just touched
returns a conflict notice telling the agent to ask, unless the human explicitly
approved it. `get_work_context` is the tool an agent must call first; it returns
the brief, the shared plan, pending reviews, decisions at every status, the
change sets with their verdicts, the human's live focus (active page, selection,
hover, cross-filter, brushed range, recent human edits), the last 10 actions,
and
a four-rule working agreement in plain text.

**Queries are fast because of a deliberate accelerator, not because of the
thesis.** DuckDB-WASM runs in the tab and range-reads remote Parquet over HTTP.
The live proof — synthetic billing events, verified against the hosting
manifest: **100,000,000 rows, 510,748,390 bytes, 8 hive-partitioned quarterly
files, ZSTD, 4,000,000-row row groups**. Predicates prune 7 of 8 files; the page fetches megabytes, not half a
gigabyte, and the "MB fetched" figure comes from byte-level accounting of the
worker's own requests. This is a performance choice. Swap the engine and the
product still works.

Stack: Next.js 16.1.6, React 19.2, zod 4.3, zustand 5, TypeScript 5.9.3, pnpm
workspace, AGPL-3.0-only. Deployment target: a Node container at
**https://ri.kontier.eu**.

---

## 3. Potential Impact

> *"Does the project make a credible, specific case for solving a real problem
> for a real audience — and does the solution actually address that problem
> based on what's demonstrated?"*

**The audience is specific.** Revenue and finance owners at subscription
businesses, and the data people who serve them. We are one of them: Kontier is a
billing platform, and revenue investigation — "why did churn spike in March?" —
is the request our own customers cannot self-serve.

**The problem is specific.** Every agent-plus-analytics product today makes the
same trade. Either the agent writes into your document and you cannot tell what
it changed, or it hands you a chat transcript and you do the work again by hand.
Neither survives contact with a team, because a team needs to know *who* changed
*what*, *who approved it*, and *how to undo it*. That is not a model problem. It
is a missing consent primitive.

**Kontier RI ships that primitive.** The WebMCP draft points at this gap with
`requestUserInteraction()`: pause a tool call and ask the user. Our approval
queue is a working version of the same idea, and it goes further — consent
survives the call. It is durable, batched, partial, and reviewable by someone
other than the person who started the agent. Today an agent that wants to
change a page either just changes it, or asks in text nobody can audit. Here,
consent is a product
object with an id, a status, a rationale per row, a recorded verdict (`applied`,
`partially_applied` or `rejected`) with the exact rows that ran, and an
automatic version snapshot.

**What people and agents can do together that was hard or impossible before:**

1. **A human reviews another actor's proposal, row by row.** The proposer is an
   agent; the reviewer is a different person; the approval is partial. Chat UIs
   cannot express "approve rows 1, 2 and 4, drop row 3", and a headless API
   cannot ask.
2. **Human gestures become agent context.** Brush a date range or cross-filter a
   bar, and `get_user_focus` / `get_work_context` hand the agent exactly what you
   are pointing at. You stop describing what you mean.
3. **Agents work under an order everyone shares.** The server assigns `seq`, so
   two agents and two humans editing the same report converge on the same
   history instead of racing on wall-clock timestamps.
4. **Agent work is reversible as one act.** Eight approved edits are one undo
   entry. Reviewing stops being scary, so people actually let agents do work.
5. **The failures are visible.** The call ledger shows tool calls the host
   rejected on schema validation. Anyone can tell a working integration from a
   broken one without a debugger.

Kontier RI is AGPL open source, and the shape generalizes: any web app that
wants agents to write to it needs propose → review → attributed apply → undo.

---

## 4. Creativity & Ambition

> *"How creative and novel is the concept and does the project differ from
> existing concepts?"*

Most WebMCP work so far wires an agent to an existing UI. Kontier RI asks the
next question: **what does a document look like when it is co-owned by people
and agents?**

The novel moves:

- **Consent is a first-class object, not a modal.** A change set has an id, 1–8
  rows, a reason per row, a status, applied row indexes, a snapshot, and an undo
  entry. It is data an agent can read back, revise (`revise_change_set`), or
  retract (`withdraw_change_set`).
- **The toolbelt is a function of page state.** Registration is not a static
  catalog. Tools appear because a tile is selected, a proposal is pending, or a
  question is unanswered — and vanish when that state ends. There is also a
  phase-keyed toolbelt (`PHASE_TOOL_SCOPES`) with six phases: `ready`,
  `planning`, `working`, `review`, `complete`, `paused`. Reads are never scoped
  away, because an agent must always be able to orient itself.
- **The page audits the protocol.** A tool ledger and a diagnostics report make
  an invisible protocol visible to the human sitting in front of it. We have not
  seen another WebMCP project do this.
- **Two implementations behind one seam, proved by one suite.** Browser storage
  and a REST API pass identical conformance tests, so "shared workspace" is a
  deployment choice and never a different product.
- **The hard case on purpose.** Revenue investigation forces the agent to read
  schemas, write SQL, build UI, and defend a judgement call. A to-do app would
  have been easier and would have proved nothing.

Ambition check: this is not a weekend prototype bolted onto a demo. It is the
analytics surface of a production billing platform, with 353 unit tests, 43
end-to-end tests, and a documented tool catalog (`docs/TOOLS.md`).

---

## What to try in 60 seconds

Open **https://ri.kontier.eu** in Chrome 149+ with
`chrome://flags/#enable-webmcp-testing` enabled, or in the ChatGPT in-app
browser.

| # | Time | Do this | What proves it worked |
|---|---|---|---|
| 1 | 0:00 | Look at the status pill in the top bar. | It reads "Agent ready", or "Connecting N/40", or "Agent setup issue" with the failing tool names. Hover it for the registered count; click it, or add `?diag=1`, for the full per-tool report. |
| 2 | 0:10 | Ask the agent: *"Call get_work_context, then propose a change set that adds a churn drill-down and annotates the March dip."* | A change-set card appears in the agent rail (**Suggestions** tab) with one row per edit and a reason per row. Nothing on the canvas moved. |
| 3 | 0:25 | Untick one row. Press **Approve**. | Only the ticked rows land. The tiles carry an agent chip. The activity log gains **one** entry, not four. |
| 4 | 0:40 | Press **Cmd+Z** once. | The entire approved set reverses in one step. |
| 5 | 0:50 | Open the agent rail's **Activity** tab and scroll to the tool call log. | Every call the agent made, with duration in ms, a read/write badge, and any call the host rejected on schema validation. |
| 6 | 0:55 | Click a tile to select it. | The expected tool count in the pill rises by 3. Deselect and it drops back. |

Bonus (10 seconds): open the **100M-row scale proof** page and watch three
charts resolve against 511 MB of remote Parquet over HTTP range reads.

---

## How WebMCP was implemented

**Files that matter**

| Path | What it does |
|---|---|
| `packages/studio/src/webmcp/useWebMCPTool.ts` | The hook. Resolves `document.modelContext`, zod → JSON Schema, re-validation inside `execute`, `AbortController` unregistration, per-tool lifecycle status, ledger hook. |
| `packages/studio/src/webmcp/tools.ts` | All 46 tool definitions, plus `STATIC_TOOL_NAMES` / `DYNAMIC_TOOL_NAMES` / `PROPOSAL_TOOL_NAMES` / `DECISION_TOOL_NAMES` and `PHASE_TOOL_SCOPES`. |
| `packages/studio/src/webmcp/WebMCPTools.tsx` | Mounts the static 40 from the top-level page (one hook call per tool). |
| `packages/studio/src/webmcp/SelectedTileTools.tsx` | Selection-scoped bundle (3 tools): mounts on select, unmounts on deselect. |
| `packages/studio/src/webmcp/PhaseScopedTools.tsx` | Proposal-scoped (2) and decision-scoped (1) bundles, keyed on the live review queue. |
| `packages/studio/src/webmcp/call-log.ts` | The 200-entry tool call ledger, including host-rejected calls. |
| `packages/studio/src/store.ts` | Command layer: attribution, undo/redo, activity log, `proposeChangeSet` / `applyChangeSet(skipIndexes)`, 10-minute human-edit protection. |
| `packages/workspace/src/` | The `WorkspaceStore` seam, `HttpWorkspaceStore`, and `describeWorkspaceStoreContract`. |
| `apps/web/app/api/workspace/**` | The REST API: dashboards, versions, the ordered command log, investigations, presence. |
| `apps/web/components/presence/change-set-card.tsx` | The review UI: per-row tick boxes, Approve, Reject. |
| `apps/web/components/chrome/agent-diagnostics.tsx` | The live WebMCP self-report. |
| `docs/TOOLS.md` | The full tool catalog. |

**The registration call itself** (`packages/studio/src/webmcp/useWebMCPTool.ts`):

```ts
mc.registerTool(
  {
    name,
    description,
    inputSchema: JSON.parse(schemaKey) as object,   // z.toJSONSchema(zodSchema)
    annotations: JSON.parse(annotationsKey) as {
      readOnlyHint?: boolean;
      untrustedContentHint?: boolean;
    },
    execute: makeToolExecute(
      () => zodRef.current,                        // same zod schema, re-validated
      (input, signal) => executeRef.current(input as z.output<S>, signal),
      controller.signal,                           // fallback when the host omits options
      (entry) => recordToolCall({ name, ...entry }), // ledger, including rejects
    ),
  },
  { signal: controller.signal },                    // unmount unregisters
)
  .then(() => onStatusChangeRef.current?.("ready"))
  .catch((err) => {
    if (controller.signal.aborted) return;          // unmount race: expected
    onStatusChangeRef.current?.("failed", err);
  });
```

And the validation seam every call passes through (`makeToolExecute`, same file):

```ts
const parsed = getSchema().safeParse(rawInput);
if (!parsed.success) {
  const error = `Invalid input: ${parsed.error.message}`;
  onCall?.({ args: rawInput, startedAt: attemptedAt, durationMs: 0,
             thrown: error, rejected: true });      // rejected calls are logged too
  return { error };
}
```

---

## Screenshot shot list

Capture these exact UI states. Each one has to read on its own, because judges
may score from images alone.

1. **The change-set card, mid-review.** Agent rail, **Suggestions** tab. One
   row unticked and greyed, the rest ticked, the "AI · Browser agent" chip
   visible, the rationale visible, Approve and Reject buttons in frame.
2. **The same report one second after Approve.** New tiles on the canvas with
   agent attribution chips, and the activity feed showing **one** entry reading
   `Applied change set: "<title>" (N changes)`.
3. **The tool call log.** Agent rail, **Activity** tab, below the activity
   feed. At least 6 rows: a read with a read-only badge, a write, a non-zero
   duration in ms, and **one rejected row** from a schema failure. This is the
   single most convincing image in the submission.
4. **The agent diagnostics dialog.** `?diag=1`. `document.modelContext: true`,
   the expected/ready/failed counts, the user agent line showing the host.
5. **Tool count changing with selection.** Two frames side by side: nothing
   selected, then one tile selected and the count 3 higher.
6. **A decision card with options.** The structured question, 2–5 options, the
   recommended one marked, and the note field.
7. **The 10-minute conflict.** The agent's conflict result telling it to ask,
   next to the title the human just edited.
8. **The 100M-row scale proof page.** Three charts resolved, with the row count
   and the MB-fetched readout in frame.
9. **Version history after an approval.** The auto-saved `Before "<title>"`
   restore point at the top of the list.
10. **The workspace header showing the shared workspace it is attached to**,
    with more than one participant listed.

---

## Verified numbers (source for every figure above)

| Figure | Value | Where it was read |
|---|---|---|
| Static tools | 40 | `STATIC_TOOL_NAMES`, `packages/studio/src/webmcp/tools.ts` |
| Dynamic bundles | 3 + 2 + 1 | `DYNAMIC_TOOL_NAMES`, `PROPOSAL_TOOL_NAMES`, `DECISION_TOOL_NAMES` |
| Maximum registered | 46 | sum of the four lists |
| Read tools | 13 | `annotations: READ_ONLY` occurrences; `READS` set in `tool-hints.test.ts` |
| Write tools | 33 | 46 − 13 |
| Chrome budgets | 30 / 500 / 150 | `packages/studio/test/tool-budgets.test.ts` |
| Ledger capacity | 200 entries | `MAX_CALL_LOG_ENTRIES`, `call-log.ts` |
| Change-set size | 1–8 actions | `proposeChangeSetInput` / `applyChangeSetInput`, `packages/studio/src/schemas.ts` |
| Human-edit protection | 10 minutes | `HUMAN_EDIT_WINDOW_MS`, `packages/studio/src/store.ts` |
| Command log cap | 1000 entries | `MAX_COMMAND_ENTRIES`, `apps/web/lib/server/workspace-store.ts` |
| Presence TTL | 30 s | `PRESENCE_TTL_MS`, same file |
| API surface | 6 route files, 13 handlers | `apps/web/app/api/workspace/**` |
| Unit tests | 353 in 22 files | `pnpm -r test` (studio 234, workspace 79, datasource 40) |
| E2E tests | 43 in 14 spec files | `apps/web/e2e/` |
| Source lines | 28,150 | `packages/*/src` + `apps/web/{app,components,lib}` |
| Test lines | 7,718 | `packages/*/test` + `apps/web/e2e` |
| Scale dataset | 100,000,000 rows | live `manifest.json` on the data host |
| Scale bytes | 510,748,390 (511 MB) | same manifest |
| Scale files | 8 hive partitions, ZSTD, 4M-row row groups | same manifest + `scripts/generate-scale-data.sh` |
| Next.js | 16.1.6 | `apps/web/package.json` |

---

## Claims to re-verify before pasting (delete this section before submitting)

These statements are **not** provable from this repository as of the last read.
Check each one, or cut it.

1. **`https://ri.kontier.eu` does not resolve yet** (curl returned no HTTP
   status). The deploy work is in flight: `Dockerfile`, `docker-compose.yml`
   and `docs/DEPLOY.md` exist but are still untracked. Every "open the URL"
   instruction depends on this landing.
2. **"Joins a shared demo workspace as a guest, no signup" is not implemented.**
   `apps/web/lib/workspace.ts` goes remote only when
   `NEXT_PUBLIC_WORKSPACE_API` is set **and** a human has pasted a bearer token
   into local storage. There is no guest path in the code, and
   `docker-compose.yml` does not set `NEXT_PUBLIC_WORKSPACE_API` at all — so
   the container would currently boot in browser-only mode.
3. **The multiplayer loop is not wired into the UI.** `packages/workspace`
   implements and tests `appendCommands`, `fetchCommands` and `heartbeat`, and
   the REST routes exist, but no component calls `useWorkspace()`,
   `fetchCommands()` or `heartbeat()`. Presence today is driven by the local
   store. Shot 10 and the phrase "more than one participant listed" cannot be
   captured until this lands.
4. **The production platform details are outside this repo.** `https://api.kontier.eu/v1`
   answers `401` (live and authenticated) and `https://kontier.eu` answers `200`.
   The Go API, Kubernetes on Scaleway, Keycloak SSO and TimescaleDB claims are
   not evidenced by any file here.
5. **`get_work_context` still tells the agent "Raw data stays local in the
   browser."** That line lives in `packages/studio/src/webmcp/tools.ts`. It is
   true of query results, but it reads like the old local-first positioning.
6. **`apps/web` has a `test` script but no test files right now**, so
   `pnpm -r test` exits non-zero at the last package. The 353 figure is the sum
   of the three packages that do have tests.
