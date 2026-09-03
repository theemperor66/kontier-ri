# Kontier RI — 12-Hour Domination Plan

*Written 2026-09-03. Sources: the official Chrome WebMCP docs, the Devpost
challenge pages, and this repository at `8ddb278`. Judge preferences below are
**inferences from public roles**, not private knowledge.*

---

## 1. The five facts that decide this

**F1 — Judges may never run the app.**
The Devpost Resources page states: *"Judges can test your project, but they are
not required to. The rules let them judge from your text description, images,
and demo video alone. So plan for both."*
→ Every mechanism must be **visible in a still frame**. A feature a judge cannot
see in a screenshot scores zero.

**F2 — Chrome's own docs prescribe our exact architecture.**
`developer.chrome.com/docs/ai/webmcp/best-practices`: *"Manage tool
registration. Register tools when they're useful in a certain page state, then
unregister when the tool is no longer usable."* and *"Reduce complexity: for
most applications, static registration should be the default approach."*
→ We already do static-by-default plus state-scoped bundles. **We have never
said so in the judges' own language.** Say it, and cite the doc.

**F3 — Chrome published an evals doc; almost nobody will ship evals.**
`developer.chrome.com/docs/ai/webmcp/evals` names the failure modes: wrong tool
chosen, wrong order, wrong parameters, tool fails.
→ A published eval table is the cheapest way to prove "genuine effort and a
working, non-trivial implementation" — the literal wording of criterion 1.

**F4 — `exposedTo` exists and is unused by nearly everyone.**
`developer.chrome.com/docs/ai/webmcp/secure-tools`: tools are same-origin by
default; `exposedTo` grants named origins access when embedded.
→ This is the one API that makes "the open web" thesis executable rather than
rhetorical.

**F5 — Our weakest axis is not engineering.**
The Fermi model puts us at the 97th percentile on WebMCP Leverage and the 94th
on Execution, but only ~0.78 on Impact and ~0.84 on Creativity. Marginal return:
more tools **+1.9pp**, more polish **+2.6pp**, a credible open-web reframing
**+16.6pp**.
→ **Stop building analytics features. Build the thesis.**

> ## ⚠ DEADLINE CONFLICT — RESOLVE BEFORE ANY OTHER WORK
>
> Four sources say the submission period **already closed**:
> - Official Rules: *"Submission Period: August 25th, 2026 (11:00 am Pacific
>   Time) – September 3rd, 2026 (1:00 pm Pacific Time)"*
> - `openai.com/webmcp-challenge`: *"September 3 at 1 p.m. PT — Submission deadline"*
> - Devpost submission manager: *"Deadline: Sep 3, 2026 @ 1:00pm PDT"*
> - Devpost updates post: *"Submissions close Thursday, September 3rd at 1:00 PM PT"*
>
> One source says there are ~12 hours left, which matches your own count:
> - `webmcp.devpost.com/details/dates`: *"Submissions, August 25 at 12:00PM PDT,
>   **September 04 at 1:00AM PDT**"*, and the homepage badge "Deadline Sep 4, 2026 @ 1".
>
> Judging opens September 4 at 10:00 AM PDT.
>
> **Action, in this order, before any code:**
> 1. Open the Devpost submission manager and read the live countdown.
> 2. **Submit a draft immediately** — current live URL, current repo, current
>    description, video field left for later. Devpost lets you edit a submission
>    until the deadline closes. Ten minutes of work removes 100% of the deadline
>    risk.
> 3. Only then start Block 1.
>
> An unsubmitted perfect project scores zero. A submitted rough one can be
> improved for the next twelve hours.

---

## 2. The thesis change

**Stop saying:** "Kontier RI is a revenue investigation workspace with 40 WebMCP
tools."

**Start saying:** "Kontier RI is a reference implementation of the **human–agent
contract** for the agentic web. The page is the shared memory. The agent's
permissions are a product object. Nothing changes without consent, everything is
attributed, and one keystroke reverses it. Revenue analysis is the proving
ground — deliberately the hardest case, because the agent must write SQL, build
UI, and defend a judgement call."

Why this wins on the weak axes:

- **Impact** stops being "another BI copilot" and becomes "the governance layer
  the agentic web needs before anyone trusts it".
- **Creativity** stops being judged against Power BI and starts being judged
  against a chat sidebar — which we beat outright.
- **Open web** becomes literal once the canvas is embeddable and a third-party
  page's agent can operate it (§3.4).

---

## 3. The software changes

Ordered by modelled ΔP(win) per hour, not by engineering appeal.

### S1 — First 60 seconds: show the loop, not a feature list · 2.0h · ΔP ≈ +4.6pp

The landing page currently explains the loop in three text steps. A judge must
*see* it.

**Files**
- `apps/web/components/chrome/empty-state.tsx` — replace the 3-step explainer
  with a live **Loop strip**: five protocol objects (Brief → Plan → Decision →
  Change set → Undo), each rendering its real component in miniature.
- `apps/web/lib/replay.ts` *(new)* — plays a recorded transcript through the
  **real** command layer at ~4× speed.
- `apps/web/public/replay/churn-session.json` *(new)* — captured from an actual
  agent run; never hand-written.
- `apps/web/components/chrome/replay-banner.tsx` *(new)* — persistent label:
  "Replay of a recorded session — no agent is connected."

**Honesty rule (non-negotiable).** The replay must be visibly labelled and must
never set the connection pill to "Agent connected". Violating this is the one
thing that can lose the hackathon outright if a judge notices.

**Acceptance** — `apps/web/e2e/replay.spec.ts`: pressing Replay produces ≥1 tile
via the command layer, the banner is visible throughout, `useWebMCPRegistry`
still reports `runtimeAvailable === false`, and Undo reverses the whole replay.

**Rollback** — the Replay button is one component; delete the mount.

---

### S2 — Judge-path hardening · 1.5h · ΔP ≈ +6.1pp

The largest single unknown is whether the loop works in **ChatGPT's in-app
browser** on first try.

**Files**
- `apps/web/app/diagnostics/page.tsx` *(new)* — static-export safe. Prints:
  `document.modelContext` present, `navigator.modelContext` present, registered
  tool count, per-tool status, failures with messages, `navigator.userAgent`,
  DuckDB-WASM boot time, COOP/COEP state. One screenshot answers "does it work
  here?".
- `packages/studio/src/webmcp/useWebMCPTool.ts` — the 1s re-check loop already
  exists; add a bounded retry ceiling and surface the attempt count.
- `apps/web/components/agent/connection-pill.tsx` — link the pill to
  `/diagnostics`.

**Manual gate (do it, do not assume)**
1. Open the live URL in the ChatGPT in-app browser.
2. Confirm the pill reads "Agent connected · N tools".
3. Select a tile; confirm the count rises by 3.
4. Ask the agent to run `get_work_context`, then `propose_change_set`.
5. If dynamic bundles fail there, set the static catalogue to always-register
   and demote scoping to a labelled toggle. **Working beats clever.**

**Acceptance** — `/diagnostics` renders in the static export with no server, and
the five manual steps pass in the ChatGPT browser and in Chrome with the flag.

---

### S3 — The Tool Call Ledger: make WebMCP visible · 2.0h · ΔP ≈ +3–5pp

Today a judge must *believe* that tools are firing. Make it undeniable.

**Files**
- `packages/studio/src/webmcp/useWebMCPTool.ts` — `makeToolExecute` is already
  the single choke point for every call. Emit
  `{ name, args, startedAt, durationMs, ok, error, resultSummary }`.
- `packages/studio/src/webmcp/call-log.ts` *(new)* — capped ring buffer (200),
  subscribable, no React dependency.
- `apps/web/components/agent/tool-call-log.tsx` *(new)* — renders in the
  Activity tab: tool name, argument preview, duration in ms, status dot, and a
  `readOnly` / `writes` badge from the annotations.
- `packages/studio/test/call-log.test.ts` *(new)*.

**Why it scores triple.** It is the best screenshot in the submission; it makes
the video self-explanatory; and it is exactly what a protocol author
(Alex Nahas) and a browser platform lead (Justin Rushing) look for first.

**Acceptance** — e2e with a mock `document.modelContext`: invoke `run_sql` and
`propose_insight`, assert two ledger rows with names, non-zero durations, and
correct read/write badges.

---

### S4 — `exposedTo`: the open web, executed · 2.0h · ΔP ≈ +7pp on the weak axis

This is the card almost nobody else will play, and it is the difference between
claiming "open web" and demonstrating it.

**Files**
- `packages/studio/src/webmcp/useWebMCPTool.ts` — pass through
  `exposedTo?: string[]`; omit the key entirely when unset so older runtimes are
  unaffected.
- `packages/studio/src/webmcp/tools.ts` — new `buildEmbedTools()`: a **read-only
  subset** (`get_dashboard_state`, `describe_tile`, `get_dataset_schema`,
  `profile_column`, `run_sql`), every one `readOnlyHint: true` and
  `untrustedContentHint: true`. **No write tool is ever exposed cross-origin.**
- `apps/web/app/embed/page.tsx` *(new)* — a minimal read-only canvas that loads
  a shared report from the URL hash.
- `apps/web/public/embed-demo.html` *(new)* — a plain HTML page on another path
  that iframes the canvas, proving a third-party site can host an
  agent-operable report.
- `docs/EMBEDDING.md` *(new)*.

**The line for the description:** *"Publish a report, embed it on any site, and
the visitor's own agent can interrogate it — read-only, same-origin-safe, and
the raw rows still never leave their browser."*

**Risk** — `exposedTo` may be unimplemented in the judge's runtime. It must
degrade to same-origin silently. Ship the embed page regardless; it stands alone
as a demonstration.

---

### S5 — `/tools`: the public contract page · 1.0h · ΔP ≈ +2pp

**Files**
- `apps/web/app/tools/page.tsx` *(new)* — generated at build time from
  `buildStaticTools()` and the scoped bundles. Per tool: name, description, JSON
  Schema (rendered), `readOnlyHint`, `untrustedContentHint`, and **the state
  that mounts it**.
- Link it from the README and the connection pill.

Serves F1 directly: a judge who never runs the app can still audit the
implementation. It is also the cheapest possible answer to "how thoroughly does
this use WebMCP?".

---

### S6 — Evals: prove the tools are usable, not just present · 3.0h · ΔP ≈ +2pp

Lowest ΔP because Leverage is already ~97th percentile — but it is the highest
*credibility* item with this specific panel, and it is the only item that
survives a sceptical code read.

**Files**
- `packages/studio/evals/scenarios/*.json` *(new)* — each scenario:
  `{ intent, setup, expectedTools[], forbiddenTools[], assertions[] }`.
  Minimum set: churn investigation, ambiguous-metric decision, destructive-edit
  refusal, SQL-injection attempt, conflict with a recent human edit.
- `packages/studio/evals/run.mjs` *(new)* — two modes:
  - **offline (default, CI-safe)**: executes the expected sequence against the
    real tool implementations and asserts document state, read-only SQL
    enforcement, row caps, the 10-minute conflict rule, and change-set
    atomicity.
  - **model mode (`--model`, needs a key)**: sends the real JSON Schemas and
    scores tool-selection accuracy.
- `docs/EVALS.md` *(new)* + a results table in the README.

**Acceptance** — `pnpm eval` exits 0 with no network and no API key.

---

## 4. The 12-hour schedule

| Block | Hours | Work | Stop rule |
|---|---|---|---|
| **0** | 0.0–0.5 | **SUBMIT A DRAFT NOW** (see the deadline warning above). Then tag `pre-final` and deploy current `main` to a second host (Vercel, root basePath). | Nothing else starts until a submission exists on Devpost. |
| **1** | 0.5–2.0 | **S2 judge-path hardening.** Test in the ChatGPT browser *first*, before writing anything new. | If dynamic bundles fail there: make the catalogue always-register, then continue. |
| **2** | 2.0–4.0 | **S3 tool call ledger.** | If the ledger is not rendering by 4.0, ship the data layer only and put it in the Activity tab as raw rows. |
| **3** | 4.0–6.0 | **S1 first 60 seconds.** Record the real transcript first, then build the replay. | If the recording is not clean by 5.0, ship the Loop strip without replay. |
| **4** | 6.0–7.0 | **S5 `/tools` page.** | Hard cut at 7.0. |
| **5** | 7.0–9.0 | **S4 embed + `exposedTo`.** | **Do not start after 8.0.** Skip entirely if any earlier block overran. |
| **6** | 9.0–10.0 | **Rewrite the Devpost description** against the four criteria, in the judges' vocabulary (§5). Capture 6 screenshots. | Non-negotiable. Never cut. |
| **7** | 10.0–11.0 | Full gate: unit, e2e, typecheck, production build, static export. Deploy both hosts. Verify both URLs in the ChatGPT browser. | Any red test → revert that feature, do not debug. |
| **8** | 11.0–12.0 | **Freeze.** Tag the release. Submit. S6 evals only if this hour is genuinely free. | Code freeze is absolute at 11.0. |

**Reserve rule:** if at any checkpoint the remaining work exceeds the remaining
time, cut from the bottom of §3, never from Block 6 or 7.

---

## 5. The description rewrite (Block 6)

Write four paragraphs, each opening with the criterion's own words.

1. **WebMCP Leverage.** Lead with the *contract*, not the count: one zod schema
   generating both `inputSchema` and runtime validation; static registration as
   the default with state-scoped bundles that mount and unmount with the work —
   *quoting Chrome's own best-practice guidance*; `readOnlyHint` and
   `untrustedContentHint` on every read tool; `exposedTo` for the embedded
   read-only surface; a real registration lifecycle driving the connection UI;
   and the tool-call ledger showing every invocation live.
2. **Execution.** The gate numbers: 298 unit tests, 35 Playwright tests, strict
   TypeScript, WCAG 2.2 AA, mobile layout, static export with no server.
3. **Potential Impact.** The governance argument, not the BI argument. *Before
   agents can act on the web, someone has to solve consent, attribution, and
   reversal. This is that, working.*
4. **Creativity & Ambition.** The negotiated change set: an agent proposes eight
   edits, the human rejects one, the rest apply as a single undoable
   transaction. Name it as the thing no chat sidebar can do.

**Six screenshots, in this order:** the loop strip → a staged change set with
one row unchecked → the tool call ledger mid-run → a structured decision
awaiting an answer → `/tools` → `/diagnostics` in the ChatGPT browser showing
"Agent connected · N tools".

---

## 6. Cut list — what NOT to build

| Cut | Why |
|---|---|
| **Workspace server backend** (`packages/workspace`, `apps/web/app/api/**`, `apps/web/lib/server/**`, `apps/web/lib/workspace.ts`) | Contradicts the local-first thesis, adds hosting and auth risk, and buys ≈2pp. Move to branch `feat/workspace-backend`, keep `main` clean, mention it in the README as optional and out of scope for the demo. |
| More chart types, more views | Execution is already 94th percentile. Zero marginal return. |
| Multi-user presence | Cannot be demonstrated honestly by one judge in one browser. |
| Any new agent persona or identity | Fabricated identity is the fastest way to lose credibility with this panel. |

---

## 7. Risk register

| Risk | Likelihood | Response |
|---|---|---|
| Dynamic bundles fail in the ChatGPT browser | Medium | Always-register fallback; scoping becomes a labelled toggle (Block 1). |
| DuckDB-WASM slow or blocked on the judge's network | Medium | `/diagnostics` shows boot time; demo data must render < 3s; keep the "Human mode ready" state honest. |
| Replay mistaken for a live agent | Low, severe | Permanent banner; connection pill stays false; e2e asserts it. |
| Single host fails at judging time | Low | Two hosts, both linked in the submission. |
| Late refactor breaks a passing gate | Medium | Freeze at 11.0; revert rather than debug. |

---

## 8. What "domination" actually looks like

A judge opens the Devpost page and, **without running anything**, sees: a live
tool-call ledger, a change set with one row rejected, a generated tool contract
page, and a diagnostics screenshot proving it runs in their own browser. They
read four paragraphs written in the vocabulary of their own rubric. If they do
open the URL, it works in the first ten seconds and shows the loop before they
have to click anything.

That is the whole plan. Everything else is a distraction.
