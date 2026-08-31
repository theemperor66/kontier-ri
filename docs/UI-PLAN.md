# Kontier RI — UI Excellence Plan v1 ("out-experience, don't out-feature")
_Companion to ENGINEERING-PLAN.md. Mode: Operate (impeccable). Authored 2026-08-31._

## 0. POV
Tableau/PBI cannot be out-featured by us; they lose on EXPERIENCE: dated chrome,
ribbon/pane overload, modal hell, hard re-renders, enterprise gray, hostile
learning curve. The killers of the last decade (Linear vs Jira, Figma vs
Sketch+Zeplin, Notion vs Confluence) won on: speed-as-a-feature, direct
manipulation, calm chrome that reveals on demand, motion that explains, and one
signature move nobody else has. Ours exists already: **the agent is visible on
the canvas**. The UI plan amplifies it and removes everything that still smells
"hackathon".

## 1. Honest audit of today (from live screenshots, both themes)
| # | Defect | Severity |
|---|---|---|
| A1 | recharts default Brush = clunky gray scrollbar under every temporal chart | HIGH (screams default) |
| A2 | Legend/series labels show raw SQL aliases (`sum_amount_eur`, `count`) | HIGH |
| A3 | KPI tiles are bare number+label — no sparkline, no target context | HIGH |
| A4 | Canvas dead space: uneven tile packing, large black voids (Growth page) | MED |
| A5 | Heatmap column headers rotated, near-illegible at 100% zoom | MED |
| A6 | Top bar = 8 unlabeled icon buttons, no grouping logic | MED |
| A7 | No data-pane/schema sidebar — fields are invisible; building is modal-driven | HIGH (BI-category table stakes) |
| A8 | Filter changes hard-re-render charts (no morph), theme switch flashes | MED |
| A9 | Default recharts tooltips (small, unformatted values) | MED |
| A10 | No hover affordances on tiles (quick chart-type switch, quick filter) | MED |
| A11 | No onboarding tour; empty state teaches WebMCP but not the UI | LOW (demo covers) |
| A12 | Axis number formatting inconsistent (100K vs €83,951 vs raw) | MED |

## 2. North-star principles (pin these in every worker brief)
1. **Speed is the brand.** Every interaction paints <100ms perceived; optimistic UI everywhere; zero spinners where a shimmer or morph can live.
2. **Direct manipulation beats configuration.** If a thing is visible, you can grab it: drag a field onto canvas → chart scaffolds; drag an axis → re-bin.
3. **Data-ink over chrome-ink.** Tufte rules: chrome recedes (borders → hairlines → nothing), ink belongs to data. Labels are human words, never SQL aliases.
4. **Motion explains, never decorates.** Filter → bars MORPH to new values; layout → FLIP; agent → cursor flight. 150–300ms, reduced-motion collapses all.
5. **The agent is a colleague, visibly.** Kai's presence (cursor, plan, insights) is the signature move — every polish decision must make co-work MORE legible.
6. **Keyboard-first pro feel.** ⌘K is the front door; arrows move selection between tiles; every action reachable without mouse.

## 3. Workstreams
### U1 — Chart craft (kills A1, A2, A5, A9, A12) — 1.5d
Custom Brush replacement (minimal handle pair + range shading on a 24px strip,
Kontier hairline style); friendly series labels (spec.series[].label defaulting
to prettified measure names — `Revenue (EUR)` not `sum_amount_eur`); rich
tooltip (card-style, formatted values, % of total where sensible, muted keys);
axis formatter unification (one formatValue path: €84.0K, 70.6%, 1.2M);
heatmap: horizontal month labels every 3rd + hover column highlight.
### U2 — Tile anatomy (kills A3, A10) — 1d
KPI v2: sparkline underlay (last 12 periods), delta chip vs prev period with
▲▼ color semantics, optional target bar. Hover toolbar on every tile (chart-type
quick-switcher with live preview, duplicate, filter-to-this). Tile header
truncation + inline rename affordance (pencil on hover).
### U3 — Data pane & direct manipulation (kills A7) — 2d [post-freeze]
Left rail (collapsible, ⌘B): datasets → fields with type glyphs + mini-profile
popover (top values, null %, distribution sparkbar); DRAG a field onto empty
canvas → auto-scaffolded chart (dim → bar, temporal+measure → line, two
measures → scatter); drag onto existing tile → add as series/dim; field pill
right-click → filter/calc-field. This is THE Tableau-parity move, and the agent
can read/write the same scaffolds (`get_user_focus` gains hoveredField).
### U4 — Canvas & chrome (kills A4, A6) — 1d
Auto-compaction (gravity packing on remove/resize), alignment guides + snap
during drag, canvas fit/zoom (⌘0/⌘±); top bar regrouped: [brand] [pages] ...
[WebMCP pill] [Share ▾ (link/PNG/JSON)] [⌘K] [•••] — text labels on the two
that matter, the rest into an overflow menu; density toggle (compact mode -20%
paddings).
### U5 — Motion system (kills A8) — 1d
d3-interpolate-based value morphs in recharts (animate data prop transitions on
filter/cross-filter), number tickers on KPIs (tabular-nums, 400ms), FLIP on
grid mutations, entrance choreography (staggered 40ms tile cascade — already
half-exists via glow), theme cross-fade (240ms, no flash).
### U6 — A11y & keyboard (partial A6) — 0.5d
Tile focus ring + arrow-key spatial navigation, Enter=select/Escape=deselect,
visible focus everywhere, aria-live for agent actions ("Kai added a chart"),
axe clean run, contrast re-audit after U1 (the AA work from Kontier tokens must
not regress).
### U7 — Perceived performance — 0.5d
Skeleton = final layout silhouette (no layout shift on data land), DuckDB warm
boot moved to idle callback after first paint, per-chart-type dynamic imports
(bundle audit), theme/palette switch without re-query (color-only re-render).

## 4. Signature moves (the "only Kontier RI" list — protect these)
S1 Kai's cursor + plan card (shipped). S2 Brush-to-ask (shipped). S3 Field-drag
scaffolding with agent-readable focus (U3). S4 Morphing cross-filter (U5) —
click a slice, watch every chart REFLOW, not reload. S5 Conflict-rule chip
("Kai wants to change this — you edited it 3 min ago").

## 5. Phasing
- **Pre-freeze (Mon night → Tue 18:00), additive/safe:** U1 (whole), U2 KPI v2
  + hover toolbar, U4 top-bar regroup + auto-compaction, U5 number tickers +
  entrance stagger, U6 aria-live + focus rings. Gate: visual-QA screenshots
  before/after per surface, e2e untouched-or-extended, live deploy green.
- **Post-submission sprint (Sep 4+):** U3 data pane (the big one), U5 full
  morph system, U4 zoom/density, U6 spatial nav, U7 bundle work — then re-shoot
  hero/OG/video v3.

## 6. Execution mechanics
Workers use the impeccable skill per surface: run context.mjs once, `shape`
against this doc's workstream, then implement with craft-floor loaded; bounded
verify passes (one batched screenshot round dark+light, one fix batch, stop).
Path split: U1+U2 worker owns tiles/** + charts/** + format.ts; U4+U5(safe
subset) worker owns chrome/** + canvas frame + globals.css motion section.
Orchestrator: integration, adversarial audit, before/after evidence pack.
Acceptance per WS = its audit rows closed + no new axe violations + tests green.
