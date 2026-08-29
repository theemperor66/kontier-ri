# Devpost Submission Kit (draft — finalize Tue Sep 2)

## Project name
Kontier RI — Revenue Intelligence Studio

## Tagline
Your AI agent gets hands inside your BI tool: build revenue dashboards together,
on the same canvas, with your data never leaving the browser.

## Text description (maps 1:1 to judging criteria)

**Why this use case is a strong fit for WebMCP (WebMCP Leverage).**
BI tools are the canonical "deep UI" problem: dozens of menus, query builders,
chart editors. Agents guessing their way through that UI fail; a headless API
loses the human. WebMCP is the only architecture where the agent operates the
*same live document* the human is looking at. Kontier RI registers 19 static +
3 selection-scoped dynamic tools from the page (`document.modelContext`), all
zod-defined (one schema = runtime validation + JSON Schema), with tools mounted
and unmounted by React component lifecycle. SQL runs in-page via DuckDB-WASM,
so `run_sql` gives the agent a real analytics engine — while raw data never
leaves the browser; the agent sees only the aggregates it asks for.

**How it creates a better user experience (Execution).**
Every agent edit is visible, attributed, and reversible: tiles glow when the
agent touches them, an activity feed shows who did what, every command has
one-click undo, and the agent may not silently overwrite anything the human
just changed (conflict rule -> it must ask). The human keeps drag/drop, resize,
restyle; the agent does the grunt work: profiling data, drafting tiles,
drilling down.

**What people and agents can do together that was difficult or impossible
before (Potential Impact).**
The human's gestures are agent context. Brush a revenue dip with the mouse, ask
"why?" — the agent reads the brushed range via `get_user_focus`, investigates
with SQL, and answers with a drill-down tile + annotation, placed next to the
chart. That loop (point -> ask -> investigate -> materialize on canvas) exists
in no BI product. Audience: every SaaS operator who needs Tableau-grade answers
without a data team. Built by a billing-SaaS team (Kontier) as the future
analytics engine of our product — this is not a toy, it is our roadmap.

**How we implemented WebMCP.**
`useWebMCPTool(name, desc, zodSchema, execute)` React hook: feature-detects
`document.modelContext`, converts zod v4 -> JSON Schema, re-validates input,
unregisters via AbortController on unmount. Static toolset mounts with the
studio; `edit_selected_tile` tools mount only while a tile is selected. All
mutating tools dispatch through a command layer (attribution, undo, conflict
detection, glow). Read tools are row-capped; `run_sql` passes a SELECT-only
guard. Monorepo: `packages/datasource` (DataSource interface + DuckDB-WASM),
`packages/studio` (store, tools, hook), `apps/web` (Next.js 16 canvas).

## Video storyboard (<3:00, audio VO, no music/trademarks)
| t | Shot | VO beat |
|---|---|---|
| 0:00–0:20 | Split screen: tangled BI menus vs chatbot spitting a static chart | "BI tools bury you in menus. Chatbots give you charts you can't touch. Neither lets you *work together*." |
| 0:20–0:35 | Empty canvas, WebMCP badge green, drop CSV | "Kontier RI: an open-source studio where your agent works *inside* the page. Data loads into DuckDB in your browser — it never leaves." |
| 0:35–1:10 | ChatGPT browser: "profile this data and build a revenue dashboard" — tiles glow in one by one | "22 structured tools. The agent profiles the schema, writes SQL, lays out KPI, trend, breakdown tiles — every edit attributed and undoable." |
| 1:10–1:30 | Human drags a tile, recolors a chart; agent's next edit respects it | "I stay in control. I move, restyle — and the agent may not overwrite what I just touched. It has to ask." |
| 1:30–2:10 | THE moment: brush the March dip, type "why?", agent reads focus, adds drill-down + annotation | "I brush the dip and just ask why. The agent reads my selection, investigates, and answers *on the canvas*: the Growth plan's price increase drove 40 cancellations." |
| 2:10–2:30 | Activity feed scroll, one-click undo, selection-scoped tools appearing in DevTools | "Selection-scoped tools mount and unmount with the UI. Full audit trail. One-click undo." |
| 2:30–2:55 | Repo, AGPL badge, architecture diagram | "AGPL-3.0, Kontier-stack, DataSource seam ready for any backend. This is how humans and agents share a workspace." |

## Submission form checklist
- [ ] Devpost registration + team (user account)
- [ ] Live URL (Vercel) — verified in ChatGPT in-app browser AND Chrome 149+ flag
- [ ] Repo URL github.com/theemperor66/kontier-ri — license visible in About ✓ (AGPL-3.0 detected)
- [ ] Video: YouTube public, <3:00, audio demo, no third-party marks/music
- [ ] Text description (above, trimmed to form limits)
- [ ] Testing instructions: Chrome flag steps + ChatGPT browser steps + suggested prompts
- [ ] No credentials needed (public app)

## Pre-submit hardening
- [x] Self-host duckdb-wasm bundles (drop jsDelivr runtime dep) — copied to
      public/duckdb/ at build time, same-origin with CDN fallback; e2e asserts
      zero jsDelivr requests
- [ ] R1 verified: dynamic tool mount/unmount in ChatGPT browser (fallback ready)
- [x] Fresh-profile end-to-end test of the live URL (cold cache) — verified via
      scripts/verify-live.mjs against https://theemperor66.github.io/kontier-ri/
      (DuckDB boots, 8 demo tiles render, no CDN requests)
- [x] README: hero shots, quickstart, tool table, architecture, Kontier story
- [x] OG meta tags + favicon (judges share links) — og.png 1200x630 rendered
      from the live demo; twitter summary_large_image; chart-glyph icon.svg
- [x] Suggested agent prompts in the empty state (guide judges to the wow path)

## Fallback live URL (while Vercel auth is pending)
GitHub Pages: https://theemperor66.github.io/kontier-ri/ — deployed on every
push to main via .github/workflows/deploy.yml (static export, basePath
/kontier-ri). Root-path deploys (Vercel) need no env changes.
