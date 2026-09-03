# Kontier RI — Product Overhaul Plan

_Status: Phase A delivered. Phase B delivered in large part (staged change sets,
phase-scoped tool bundles, guided human authoring, the data rail with
agent-readable field focus, version history, investigation records). What
remains of Phase B needs a backend; Phase C is the roadmap._

## 1. Product decision

Kontier RI is a **Revenue Investigation Workspace**. Its signature workflow is
an investigative pull request:

1. A human writes a brief and points at a signal on the dashboard.
2. The agent reads the live brief, selection, brush, filters, recent human
   edits, and working agreement through WebMCP.
3. The agent publishes a plan and works visibly.
4. Ambiguity becomes a structured decision card with options, rationale, and a
   recommendation.
5. Changes that need judgment arrive as reviewable proposals, single or staged
   as a change set. Accepted work goes through the normal attributed, undoable
   command layer.
6. The agent closes the session with a durable summary of what changed and what
   remains uncertain.

This is a stronger WebMCP demonstration than an embedded chat box. The page does
not imitate an agent. It exposes the live product state and renders only real
calls and explicit human decisions.

## 2. Experience architecture

### Persistent collaboration rail
- Shared brief and session phase.
- Connected-runtime diagnostics based on actual tool registration, not API
  presence alone.
- "What the agent sees" focus capsule: active page, selected tile, brush,
  cross-filter, and edit protection.
- Live plan with explicit progress.
- Review queue for insights and structured decision requests.
- Session close-out and compact provenance trail.

### Context-aware canvas
- Human focus ribbon appears when a tile, mark, filter, or date range is active.
- Desktop keeps direct manipulation.
- Mobile reflows tiles into a readable stack and removes drag/resize handles
  that cannot work reliably on touch.

### First-run journey
- One primary action: open the investigation demo.
- Three-beat explanation: point -> investigate locally -> review and commit.
- Advanced proofs (templates, own data, 100M rows) remain available but stop
  competing with the main story.
- Browser setup appears as contextual status, not hero copy.

## 3. Agent protocol

Three collaboration tools sit around the existing command surface:

- `get_work_context` — the mandatory orientation call. Returns the human brief,
  working agreement, live focus, plan, pending reviews, answered decisions, and
  recent actions.
- `request_decision` — creates a structured, agent-readable human decision with
  2 to 5 options, rationale, recommendation, and impact. The agent observes the
  answer on its next context read.
- `complete_work` — closes the visible loop with a concise summary and outcome
  list.

- `propose_change_set` — stages 1 to 8 related edits as one reviewable set with
  a reason per row. Nothing runs until the human approves; the human can drop
  rows first, and the approved rows become one undo step. Delivered in
  Phase B, together with the phase-scoped bundles `revise_change_set`,
  `withdraw_change_set` and `withdraw_decision`.

`present_plan`, `update_plan_step`, and `propose_insight` remain the execution
and review primitives. Tool descriptions teach the expected sequence without
requiring a proprietary orchestrator.

## 4. Trust and production hardening

- Track registration lifecycle per tool: unavailable, registering, ready,
  failed, or unregistered.
- Surface registration failures with actionable diagnostics.
- Keep all schemas strict and generated from the same Zod contracts used at
  execution.
- Keep decisions and plans ephemeral to the live working session; keep committed
  dashboard edits in the existing persistence and undo model.
- Remove invented agent identity. Use "Browser agent" unless the host can
  provide a verified name.
- Test the full collaboration state machine at store, schema, tool, and
  Playwright levels.
- Validate desktop and mobile layouts, reduced motion, keyboard focus,
  empty/error states, and production static export.

## 5. Delivery phases

### Phase A — DELIVERED

What shipped:

- **Work-session state machine** in the studio store: `startWorkSession`,
  `pauseWorkSession`, `resumeWorkSession`, `requestDecision`, `answerDecision`,
  `dismissDecision`, `completeWork`, with the phases `ready`, `planning`,
  `working`, `review`, `complete`, `paused`.
- **Three collaboration tools**: `get_work_context`, `request_decision`,
  `complete_work`. Static surface was **39 tools** at the end of Phase A, plus
  3 selection-scoped tools for 42 while a tile is selected. Phase B raised
  this to 40 static and up to 46 registered.
- **Working agreement** returned by `get_work_context`: attributed and undoable
  agent edits, 10-minute protection for human edits, local-only raw data, and
  approval before uncertain or high-impact changes.
- **Untrusted-content annotations**: every read tool now carries
  `readOnlyHint` and `untrustedContentHint`.
- **Agent panel (340px)** with Suggestions and Activity tabs, brief editor,
  session phase, live plan, decision cards, review queue, and a status footer.
- **Honest registration health**: per-tool lifecycle reporting, "Agent ready"
  only on verified success, "Agent setup issue" with the failing tool names,
  and a retry for hosts that inject `modelContext` after hydration.
- **Product shell from the design spec**: 256px navy navigation rail (Home,
  Reports, Approvals, Datasets, Semantic model, Data health, Audit log, live
  agent status), light theme by default, top bar, status footer.
- **Six live-state workspace views**: Home, Approvals, Datasets, Semantic model
  (calculated fields, SQL views, engine tables), Data health and lineage (tile
  to dataset, derived from tile specs), Audit log. No invented refresh times,
  owners, or access lists.
- **Focus ribbon** over the canvas showing what the agent can read.
- **Responsive canvas**: below 720px of canvas width the grid becomes a stacked
  review layout with drag and resize disabled.
- **Persona removal**: the "Kai" identity is gone. WebMCP does not expose agent
  identity, so the UI says "Browser agent".
- **Tests**: at the end of Phase A, 226 unit tests and 30 Playwright tests,
  including the full brief -> plan -> decision -> proposal -> complete loop,
  late-host registration, visible registration failure, and the mobile review
  layout. The suite is now 253 unit tests (packages/datasource 40,
  packages/studio 213) and 33 Playwright tests.
- **Docs**: README, `docs/TOOLS.md`, `docs/SUBMISSION.md` and
  `docs/DESIGN-SPEC.md` rewritten around the investigation loop.

### Phase B — DELIVERED (first slice)

What shipped:

- **Staged multi-action change sets.** `propose_change_set` stages 1 to 8
  actions (`add_tile`, `update_tile`, `remove_tile`, `add_annotation`,
  `set_filter`, `set_tile_filters`), each with an optional note. Nothing runs
  on propose. The review card renders the set as a diff, the human can skip
  individual rows, and approving runs the kept rows through the normal command
  layer and collapses them into ONE undo entry and ONE activity entry. Partial
  approval is recorded as `partially_applied` with `appliedActionIndexes`. A
  failure mid-apply restores the document AND the history exactly and leaves
  the set `proposed`. The store caps the queue at 10 sets.
- **Phase-scoped tool bundles.** The toolbelt now follows the state of the
  work: 3 selection-scoped tools while a tile is selected, 2 proposal-scoped
  tools (`revise_change_set`, `withdraw_change_set`) while a change set is
  `proposed`, and 1 decision-scoped tool (`withdraw_decision`) while a question
  is unanswered. Each bundle is a React component that registers on mount and
  unregisters on unmount, with descriptions that name the live ids. Surface:
  **40 static, up to 46 registered.**
- **Change sets in the context read.** `get_work_context` also returns
  `changeSets` (status, per-action kinds and notes, `appliedActionIndexes`), so
  the agent observes the human's verdict on its next read.
- **Guided human authoring.** The "Add visual" dialog walks dataset ->
  group-by -> measure and aggregate -> visual type, with a live preview that
  uses the real renderer and the real query engine. Adding commits one
  undoable human command. It is the human mirror of the agent's `add_tile`.
- **Investigation records.** A completed work session (brief, summary,
  outcomes, the decisions the human made) is written to this browser and shown
  on Home as "Past investigations". The history is local only, capped at 50
  records, read-only, and clearable.

- **Data rail with drag-to-scaffold.** ⌘B or the "Fields" button opens the
  field pane: live datasets with row counts, columns with a role glyph
  (measure / time / dimension) read from the DuckDB type, field search, and a
  right-click profile (distinct, nulls, top values) against live data. Click
  scaffolds a tile (numeric -> KPI, dimension or date -> chart grouped by that
  field with the best-ranked measure); drag drops the same scaffold at the grid
  cell under the pointer. Both paths commit one undoable human command.
- **Hovered field as agent context.** Hovering, focusing or dragging a field
  publishes `{dataset, column, type}` to `get_user_focus` and
  `get_work_context.focus`. It is pure UI state: never undoable, never
  activity-logged, cleared on a document switch.
- **Version history.** Named document snapshots in this browser (20 per
  dashboard), opened from the overflow menu or ⌘K. One is taken automatically
  before a staged change set is applied, and restoring snapshots what it
  replaces, so agent work always has a restore point.

### Phase B — remaining
- Tool bundles keyed to named work phases (`explore`, `investigate`, `review`,
  `commit`), on top of the current queue-driven bundles.
- Investigation records and version snapshots that survive beyond one browser
  (a workspace backend, not local storage).

### Phase C — enterprise path
- Authenticated workspace connector with server-enforced row-level security.
- Multi-user command ordering and presence.
- Policy-controlled approvals, audit export, SSO, observability, and recovery
  playbooks.

## 6. Acceptance criteria

- A new user understands the shared-workflow mechanism in the first viewport.
- A human can start a brief, an agent can read it, ask a question, receive a
  structured answer, publish progress, propose a reviewed action, and complete
  the session.
- No agent presence appears without a real tool call or human-authored brief.
- Tool status means successful registration, not mere feature detection.
- The dashboard is readable and operable at 390px and 1440px.
- Unit tests, type checks, production build, and focused Playwright flows pass.
