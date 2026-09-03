# Kontier RI — Design Spec (from the approved product design)

Source of truth: the sponsor-provided design `Kontier RI.html`. The extracted
markup is checked out at `.design-ref/template.html` (read it for exact
values); a rendered reference is at `/tmp/design-desktop.png`.

**Rule: the design wins.** Where product truth and the design disagree, keep the
design's form and language, and change only the *facts* so nothing is claimed
that the product cannot do.

## 1. Tokens (already implemented in `apps/web/app/globals.css`)

Light is the default. The navigation rail is navy in both themes.

| Design name | CSS var | Tailwind | Light | Dark |
|---|---|---|---|---|
| bg | `--bg` | `bg-background` | `#F5F6FA` | `#0B0E1A` |
| surface | `--surface` | `bg-card` / `bg-surface` | `#FFFFFF` | `#141829` |
| surface2 | `--surface-2` | `bg-surface-2` / `bg-muted` | `#F1F2F7` | `#1B2036` |
| line | `--line` | `border-border` / `border-line` | `#E6E8EF` | `rgba(255,255,255,.08)` |
| line2 | `--line-2` | `border-line-2` | `#D3D7E3` | `rgba(255,255,255,.15)` |
| ink | `--ink` | `text-foreground` | `#161B2E` | `#EEF0F6` |
| muted | `--ink-muted` | `text-muted-foreground` | `#6B7285` | `#A0A6BA` |
| faint | `--faint` | `text-faint` | `#9AA0B3` | `#6B7285` |
| accent | `--accent-strong` | `text-accent-strong` / `bg-primary` | `#3D4FE0` | `#7B8AF5` |
| accent-soft | `--accent-soft` | `bg-accent` / `bg-accent-soft` | `#EEF0FD` | `rgba(123,138,245,.14)` |
| accent-mid | `--accent-mid` | `border-accent-mid` | `#C9CFF7` | `rgba(123,138,245,.35)` |
| ok / warn / danger | `--ok` `--warn` `--danger` | `text-ok` `text-warn` `text-danger` | `#1F9D66` `#D9821A` `#D64545` | `#3DC98A` `#F0A43A` `#F06A6A` |
| *-soft | `--ok-soft` … | `bg-ok-soft` … | tinted | alpha |
| lav / mint / peach | `--lav` `--mint` `--peach` | `bg-lav` … | `#EDEEFB` `#E6F6EF` `#FDEFDC` | alpha |
| nav | `--nav` | `bg-nav` | `#0F1426` | `#0B0E1A` |
| grid | `--grid` | — | `rgba(22,27,46,.08)` | `rgba(255,255,255,.06)` |
| shadow | `--shadow-card` | `shadow-card` | soft two-layer | deeper |

Type: DM Sans everywhere, `font-variant-numeric: tabular-nums`, mono only for
SQL/measure formulas. Radius: cards 12px (`rounded-xl`), controls 8–9px
(`rounded-lg`), pills `rounded-full`.

Canonical sizes: page title 30px/600/-.02em; page subtitle 15px muted; card
title 14px/500; card sub 12px faint; table header 12px faint; table cell 13px;
KPI value `clamp(22px,15cqi,34px)`/600/-.03em; pill text 11.5px/500.

## 2. Shell geometry

```
[ 256px navy rail ][ content column: padding 16px 16px 0, gap 14px          ]
                    [ top bar: 56px, rounded-xl, bg surface, 1px line       ]
                    [ body grid: minmax(0,1fr) | 340px agent panel, gap 14  ]
```

- Canvas grid: 12 columns, row height **64px**, gap **12px**, dotted field
  (24px spacing), tiles absolutely positioned with `.18s ease` transitions.
- Selected tile: `border: accent` + `box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-card)`.
- Dragging tile: `box-shadow: 0 24px 48px -16px rgba(22,27,46,.35)`.
- Agent panel is 340px, `rounded-t-xl`, bordered, with a status footer.

## 3. Component contracts

**Tile card.** Header: 14px/16px padding, title (14px/500) over sub (12px
faint), optional `agent` pill (11.5px, `bg-accent-soft text-accent-strong`,
rounded-full) when the tile was created or last changed by the agent.

**KPI tile.** Optional flat tint (`mint`, `lav`, `peach`) → transparent border,
no shadow (`.kpi-tint-*` classes). Title in muted, value bottom-aligned, delta
row: colored delta (`--ok` good, `--danger` bad) + muted comparison note.

**Table tile.** Header row 12px faint with bottom hairline; rows 13px, 7px/16px
padding, hairline separators, hover `bg-surface-2`; first column 500 weight,
numeric columns right-aligned; status values render as soft pills
(High → danger-soft/danger, Medium/Watch → warn-soft/warn, else ok-soft/ok).

**Chart tiles.** Legend 12px muted with 10px×2px swatches. Bars use the indigo
ramp `#3D4FE0 → #7B8AF5 → #C9CFF7`; a "bad" series uses `--danger`. Donut:
110px ring, 70px surface hole with a count label, legend rows with 8px square
swatches and muted values on the right.

**Selection toolbar.** Floating navy pill above the selected tile: chart-type
switches, divider, Duplicate, Delete (`bg-nav`, white text, radius 10px).

**Proposal overlay on a tile.** Bottom-anchored card inside the tile:
`bg-surface`, `border-accent-mid`, radius 10px, accent dot, one-line rationale
with an accent label, then Approve (solid accent) / Reject (outline).

## 4. Honesty rules for this product

The design shows a mature workspace. Keep the form; use real data only.

- Agent identity: WebMCP does not expose which agent is calling. Show the real
  connection state ("Browser agent · connected", "No agent connected") instead
  of inventing "Claude Desktop"/"ChatGPT Desktop".
- Suggestions = real `propose_insight` proposals and `request_decision`
  questions. Activity = the real command log with real undo.
- Datasets / Semantic model / Lineage / Refresh health read the live DuckDB
  datasets, calculated fields, views and tile specs. Never fabricate rows,
  refresh times, owners, or access lists.
- Anything the build cannot back with real state is omitted, not faked.
