---
name: Kontier RI
description: A revenue investigation workspace where a human and a browser agent work the same live report.
colors:
  canvas: "#f5f6fa"
  surface: "#ffffff"
  surface-sunken: "#f1f2f7"
  hairline: "#e6e8ef"
  hairline-strong: "#d3d7e3"
  ink: "#161b2e"
  ink-muted: "#646b7d"
  ink-faint: "#626a82"
  agent-indigo: "#3d4fe0"
  agent-indigo-soft: "#eef0fd"
  agent-indigo-mid: "#c9cff7"
  navy-rail: "#0f1426"
  state-ok: "#18794e"
  state-ok-soft: "#e6f6ee"
  state-warn: "#995c12"
  state-warn-soft: "#fdf1df"
  state-danger: "#c92c2c"
  state-danger-soft: "#fce9e9"
  field-mint: "#e6f6ef"
  field-lavender: "#edeefb"
  field-peach: "#fdefdc"
  series-1: "#3d4fe0"
  series-2: "#7b8af5"
  series-3: "#c9cff7"
  series-4: "#2a3699"
  series-5: "#a8b0d9"
typography:
  page-title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  metric:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(22px, 15cqi, 34px)"
    fontWeight: 600
    lineHeight: "1"
    letterSpacing: "-0.03em"
    fontFeature: "tnum 1"
  section-title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "1.3"
  card-title:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "1.25"
  body:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "1.5"
  meta:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "1.35"
  rail-label:
    fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    letterSpacing: "0.08em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
rounded:
  control: "9.6px"
  card: "12px"
  chip: "999px"
  glyph-tile: "10px"
spacing:
  hairline-gap: "4px"
  tight: "8px"
  card: "12px"
  shell: "14px"
  page: "16px"
  card-inset: "22px"
components:
  button-primary:
    backgroundColor: "{colors.agent-indigo}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
    typography: "{typography.card-title}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "30px"
    typography: "{typography.body}"
  chip-scope:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "38px"
    typography: "{typography.body}"
  chip-scope-agent:
    backgroundColor: "{colors.agent-indigo-soft}"
    textColor: "{colors.agent-indigo}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "38px"
  tile-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  tile-kpi-mint:
    backgroundColor: "{colors.field-mint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  rail-item-active:
    backgroundColor: "rgba(255,255,255,0.1)"
    textColor: "{colors.surface}"
    rounded: "{rounded.glyph-tile}"
    padding: "0 12px"
    height: "38px"
  agent-pill:
    backgroundColor: "{colors.agent-indigo-soft}"
    textColor: "{colors.agent-indigo}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
---

# Design System: Kontier RI

## Overview

**Creative North Star: "The Operating Table"**

Kontier RI is a room where two kinds of hands work one artifact. The report is
the shared surface, so the design keeps the work in the middle and pushes every
apparatus to the edges: a navy rail on the left for where you are, a light
canvas in the centre for what is true, and a single agent column on the right
for what is proposed. Nothing floats over the work that could sit beside it.

The system is quiet by construction and precise by preference. Chrome is
hairlines and flat fields; the only saturated ink in the product is one indigo,
and it means *agency* — an agent proposal, an agent-set filter, a primary human
action. Numbers are the loudest thing on screen. Everything else recedes to
support them: 12px labels, hairline rules, and card surfaces one step above the
canvas.

Depth is tonal, not dramatic. A card is a white surface on a grey-blue canvas
with a 1px hairline and a soft two-layer shadow; a KPI field is a flat colour
with no border and no shadow at all. Dark mode is the same system with the
same rail, not a separate personality.

**Key Characteristics:**
- One family (DM Sans) with tabular numerals everywhere; mono only for SQL and formulas.
- One saturated accent, reserved for agency and primary action.
- Flat colour fields for metrics; hairline-and-shadow cards for everything else.
- A 12-column, 64px-row canvas on a 24px dot field.
- Status colour is semantic only: ok, warn, danger — never decorative.

## Colors

A cool grey-blue neutral ramp under one indigo accent, with three soft metric
fields and three semantic status inks.

### Primary
- **Agent Indigo** (`#3d4fe0`, dark `#7b8af5`): agency and primary action. Approve buttons, the active page underline, agent-set scope chips, the first chart series, focus rings. Anything an agent touched or a human must confirm.
- **Agent Indigo Soft** (`#eef0fd`): the field behind agent things — proposal pills, the "Agent pick" tag, the selected tab, `bg-accent`.
- **Agent Indigo Mid** (`#c9cff7`): the border of an agent object (proposal strips, decision cards, selected tiles) and the third chart series.

### Neutral
- **Canvas** (`#f5f6fa`, dark `#0b0e1a`): the page ground the canvas dot field sits on.
- **Surface** (`#ffffff`, dark `#141829`): cards, tiles, top bar, panels.
- **Surface Sunken** (`#f1f2f7`, dark `#1b2036`): hover fills, table row hover, quiet pills.
- **Hairline** (`#e6e8ef`) and **Hairline Strong** (`#d3d7e3`): every divider and control border.
- **Ink** (`#161b2e`, dark `#eef0f6`): primary text and metric values.
- **Ink Muted** (`#646b7d`) and **Ink Faint** (`#626a82`): secondary text and 12px meta lines.
- **Navy Rail** (`#0f1426`): the navigation rail in both themes.

### Tertiary — metric fields
- **Mint** (`#e6f6ef`), **Lavender** (`#edeefb`), **Peach** (`#fdefdc`): flat KPI washes, applied by position in the KPI band (mint, lavender, plain surface, peach) so a row reads as one sequence.

### Status
- **OK** (`#18794e`), **Warn** (`#995c12`), **Danger** (`#c92c2c`), each with a soft ground (`#e6f6ee`, `#fdf1df`, `#fce9e9`) for pills and chips.

### Named Rules
**The One Agency Ink Rule.** Indigo means an agent acted or a human must act.
It is never used to decorate, and status colour is never used to mean agency.

**The Measured Contrast Rule.** Every small-text token clears 4.5:1 against
white, the canvas, `surface-sunken` and all three metric fields. Ink values are
darkened to reach the ratio; opacity modifiers are never stacked on muted text.

**The Semantic Series Rule.** Chart series use the indigo ramp
(`#3d4fe0 → #7b8af5 → #c9cff7 → #2a3699 → #a8b0d9`). A series only turns
`danger` when the measure itself means loss (churn, failures).

## Typography

**Display / Body Font:** DM Sans (with `ui-sans-serif`, `system-ui`, `-apple-system`, `Segoe UI`, Roboto)
**Mono Font:** JetBrains Mono (with `ui-monospace`, `SFMono-Regular`, Menlo)

**Character:** One workhorse humanist sans carries the whole product. Hierarchy
comes from weight, size and ink — never from a second family. `font-variant-numeric:
tabular-nums` is on at the root so every figure column aligns without opt-in.

### Hierarchy
- **Page title** (600, 30px, 1.1, -0.02em): the report or surface name. One per screen.
- **Metric** (600, `clamp(22px, 15cqi, 34px)`, 1, -0.03em): KPI values, scaled to the tile's own width via container queries.
- **Section title** (600, 15px): card and page-section headings.
- **Card title** (500, 14px): tile titles, panel card titles, rail items.
- **Body** (400, 13px, 1.5): panel prose, table cells, dialog copy.
- **Meta** (400, 12px): tile sub-lines, table headers, timestamps — in `ink-faint`.
- **Rail label** (500, 11.5px, 0.08em, uppercase): the rail's ANALYZE / GOVERN / AGENTS group labels.
- **Code** (400, 11.5px, mono): tool names, SQL, measure formulas.

### Named Rules
**The Two-Line Title Rule.** Tile titles wrap to two lines rather than
truncating; the exact spec summary lives in the header's hover title.

**The Sub-line Is Evidence Rule.** The 12px line under a tile title is derived
from the real spec (measure, dataset, comparison, filter count). It never
carries invented context.

## Layout

The shell is a fixed three-part frame. A 256px navy rail (collapsible, overlay
on phones), then a content column with 16px padding and a 14px gap, holding a
56px top bar card above the working area. The working area is a grid: the
report and, when open, a 340px agent panel. An optional 240px field pane opens
between the rail and the canvas on large screens.

The canvas is a 12-column grid with 64px rows and a 12px gap, drawn on a 24px
radial dot field. Tiles are absolutely positioned, snap to the grid, and pack
upward on drop and on Tidy. Spacing rhythm runs 4 / 8 / 12 / 14 / 16 / 22px;
cards use 22px insets on pages and 12–16px inside tiles.

Below 720px of canvas width the editor becomes a review surface: tiles reflow
into one column (two at ≥480px for KPIs only), drag and resize are disabled,
per-tile editing controls are hidden, and the rail and agent panel become
overlays. Density is fixed; there is no compact mode.

## Elevation & Depth

Tonal first, shadow second. A card is a white surface on the grey-blue canvas
with a 1px hairline; the shadow is a soft two-layer lift that separates it from
the dot field without announcing itself. A tinted KPI field drops both border
and shadow: the colour *is* the elevation. The navy rail needs neither.

### Shadow Vocabulary
- **Card** (`0 1px 2px rgba(22,27,46,.04), 0 6px 20px -10px rgba(22,27,46,.14)`; dark `0 1px 2px rgba(0,0,0,.4), 0 10px 28px -12px rgba(0,0,0,.6)`): every surface that sits above the canvas.
- **Selected tile** (`0 0 0 3px var(--accent-soft), var(--shadow-card)`): selection is an indigo halo plus the card shadow, with an `accent-mid` border.
- **Dragging tile** (`0 24px 48px -16px rgba(22,27,46,.35)`): the only dramatic shadow in the system, and only while the pointer is down.

### Named Rules
**The One Elevation Device Rule.** A surface declares depth once: hairline plus
card shadow, or flat colour field. Never a border under a heavy shadow, and
never a shadow on a tinted field.

## Shapes

Cards and tiles are 12px; controls, chips with height and inputs are ~9.6px;
pills, avatars and status dots are fully round; small glyph tiles (rail mark,
avatar squares, kind badges) are 10px. Borders are 1px hairlines — the only
2px lines in the product are the active page-tab underline and the focus ring.
No cut corners, no hard offset shadows, no gradient fills except two functional
uses: the KPI sparkline underlay and the table's right-edge scroll fade.

## Components

### Buttons
- **Shape:** ~9.6px radius (`rounded-lg`), 30px in dense rows, 36–40px for primary actions.
- **Primary:** indigo fill, white text, `0 16px` padding, subtle hover opacity shift.
- **Outline:** transparent fill, hairline-strong border, ink text, `surface-sunken` on hover.
- **Ghost:** no border, muted ink, `surface-sunken` on hover — icon controls in the top bar.
- **Focus:** 2px `ring` at 40–60% opacity, never removed.

### Chips
- **Scope chips** (report header): 38px tall, hairline border on surface, icon plus value. An agent-set scope switches to the indigo-soft field with an indigo-mid border and a muted `by agent` by-line.
- **Status pills** (tables, severities): fully round, soft status ground with matching ink, 11.5px medium.
- **Agent pill** (tiles): fully round, indigo-soft on indigo, reading `agent`.

### Cards / Containers
- **Corner:** 12px. **Background:** surface. **Border:** 1px hairline. **Shadow:** card.
- **Internal padding:** 22px on workspace pages, 12–16px in panel cards, 14px/16px in tile headers.
- **Tinted KPI variant:** flat mint / lavender / peach field, transparent border, no shadow.

### Inputs / Fields
- **Style:** 1px hairline on surface, ~9.6px radius, 13px text, 32–36px tall.
- **Focus:** border shifts to `accent-mid` plus a 2px indigo ring at 20%.
- **Search:** icon-led, `⌘K` hint as a hairline kbd on the right.

### Navigation
- **Rail:** navy, 38px items at 14px, active item a 10% white fill with white ink; group labels 11.5px uppercase at 45% white; live status dots (ok / warn / danger / idle) on the agent rows.
- **Page tabs:** dark text over a 2px indigo underline when active, muted ink otherwise. Never a filled pill.
- **Top bar:** 56px surface card, rail toggle and breadcrumb left, command search and live agent status right.

### Agent panel (signature component)
The 340px right column is the product's signature. Two tabs (Suggestions,
Activity) over a scrolling column of cards, closed by a status footer that
reads the real WebMCP connection. Every card is the same object: an avatar
square, a source line, a scope tag, a title, a rationale, then Approve /
Reject. Decisions render their options as selectable rows with an "Agent pick"
tag; change sets render a checkbox diff the human can edit before approving.

### In-tile proposal strip (signature component)
A pending agent proposal also lands on the tile it would change: an indigo dot,
`Agent suggests:` in indigo, the rationale, then Approve / Reject inside an
`accent-mid` bordered strip. It sits in flow at the bottom of the tile, so the
chart keeps its axis and its brush.

## Do's and Don'ts

### Do:
- **Do** reserve indigo for agency and primary action, and keep status colour semantic.
- **Do** apply KPI tints by position in the band (mint, lavender, plain, peach).
- **Do** give every KPI a delta line, even when it reads "no comparison period", so value and delta baselines align across the row.
- **Do** derive tile sub-lines, chips and lineage from real state, and label synthetic demo data where a viewer could mistake it for real.
- **Do** keep agent objects reviewable in place: the tile carries the proposal, the panel carries the queue.
- **Do** check new small-text ink against white, the canvas, `surface-sunken` and all three metric fields before shipping it.

### Don't:
- **Don't** put a border under a heavy shadow, or any shadow on a tinted metric field.
- **Don't** introduce a second type family; hierarchy comes from weight, size and ink.
- **Don't** fill the active page tab; the underline is the active state.
- **Don't** shrink the 12-column editor onto a phone — stack it and disable spatial editing instead.
- **Don't** render agent presence from timers, animation or persona; only a real tool call or a human action may produce it.
- **Don't** let a bar that means "loss" use a series colour, or a healthy series use `danger`.
