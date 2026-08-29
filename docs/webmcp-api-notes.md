# WebMCP API notes (spike research)

Researched 2026-08-28. WebMCP is young and the API surface has already renamed
once (`navigator.modelContext` -> `document.modelContext`). Every claim below
cites its source + date. **Canonical surface for us: `document.modelContext`,
with a `navigator.modelContext` fallback for older runtimes.**

## Sources

| # | Source | Version / date |
|---|--------|----------------|
| S1 | [WebMCP spec](https://webmachinelearning.github.io/webmcp/) — W3C WebML CG Draft Report | 26 Aug 2026 |
| S2 | [Explainer README](https://github.com/webmachinelearning/webmcp) + [implementation-status.md](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) | fetched 28 Aug 2026 |
| S3 | [Chrome: WebMCP get started](https://developer.chrome.com/docs/ai/webmcp) | pub 18 May 2026, upd 7 Aug 2026 |
| S4 | [Chrome: Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) | upd 20 Aug 2026 |
| S5 | [Chrome: Declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api) | pub 18 May 2026 |
| S6 | [Chrome OT blog](https://developer.chrome.com/blog/ai-webmcp-origin-trial) | 9 Jun 2026 |
| S7 | [ChatGPT "Site tools" doc](https://learn.chatgpt.com/docs/webmcp) (`.md` suffix gives markdown) | fetched 28 Aug 2026 |
| S8 | [`webmcp-types` npm pkg](https://www.npmjs.com/package/webmcp-types) v0.1.5 (official CG typings) | fetched 28 Aug 2026 |
| S9 | [`usewebmcp` npm pkg](https://www.npmjs.com/package/usewebmcp) v5.0.1 (WebMCP-org/npm-packages) — linked from S4 as "React support" | fetched 28 Aug 2026 |
| S10 | [Cloudflare `agents` WebMCP adapter example](https://github.com/cloudflare/agents/blob/main/examples/webmcp/README.md) + [blog.cloudflare.com/webmcp](https://blog.cloudflare.com/webmcp/) | fetched 28 Aug 2026 |
| S11 | Chromium `chrome/browser/about_flags.cc` (main branch) | fetched 28 Aug 2026 |

Note on Vercel: no public Vercel/vercel-labs WebMCP storefront repo was
findable via GitHub search or web search (their public MCP work is server-side
`mcp-handler` / `agent-browser`). Cloudflare's example (S10) is the best
third-party reference implementation.

## Entry point

- Spec (S1): `partial interface Document { [SecureContext, SameObject] readonly attribute ModelContext modelContext; }` — **`document.modelContext`**, secure context only, `Exposed=Window`.
- `ModelContext : EventTarget` with:

```webidl
Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {});
Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject = {}, optional ModelContextExecuteToolOptions options = {});
attribute EventHandler ontoolchange;
```

### Naming discrepancies (important, spec is young)

| Name | Status |
|------|--------|
| `document.modelContext` | Current. Used by spec (S1), explainer (S2), Chrome docs (S4), ChatGPT doc (S7). |
| `navigator.modelContext` | **Older Chrome preview surface.** Cloudflare's adapter (S10) still uses it everywhere ("Google's WebMCP API (`navigator.modelContext`)"). `usewebmcp` README (S9): "Older `navigator.modelContext` runtimes remain a fallback." The polyfill `@mcp-b/webmcp-polyfill` ships a "deprecated navigator.modelContext alias". |
| `window.agent.provideContext(...)` | Ancient explainer draft. Gone from all current sources — do not use. |
| `provideContext()` | Not in current spec, explainer, or Chrome docs. Some old blog posts mention it; ignore. |

**Decision:** feature-detect `document.modelContext ?? navigator.modelContext`
and use whichever exists. Costs one line, survives both generations.

## registerTool

Exact call from Chrome docs (S4):

```js
await document.modelContext.registerTool({
  name: 'toggle_layer',
  description: 'Control pizza layers (sauce, cheese). Use "add", "remove", or "toggle".',
  inputSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string', enum: ['sauce-layer', 'cheese-layer'] },
      action: { type: 'string', enum: ['add', 'remove', 'toggle'] },
    },
    required: ['layer'],
  },
  execute: async ({ layer, action }) => {
    await toggleLayer(layer, action);
    return `Performed ${action || 'toggle'} on layer: ${layer}`;
  },
});
```

`ModelContextTool` dictionary (S1):

```webidl
dictionary ModelContextTool {
  required DOMString name;          // <=128 chars, ASCII alnum + _ - . only
  USVString title;                  // optional, for browser UI
  required DOMString description;   // non-empty
  object inputSchema;               // JSON Schema object (optional)
  required ToolExecuteCallback execute;
  ToolAnnotations annotations;      // { readOnlyHint=false, untrustedContentHint=false }
};
callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);
```

Rejection rules (S1 registerTool steps):
- duplicate `name` already registered -> `InvalidStateError` (matters for React Strict Mode double-mount!)
- empty `name`/`description`, name >128 chars or bad chars -> `InvalidStateError`
- `inputSchema` is `JSON.stringify`'d at registration; circular refs etc. reject
- document not fully active -> `InvalidStateError`
- **agent cluster not origin-keyed (and scheme != `file`) -> `SecurityError`** — i.e. never send `Origin-Agent-Cluster: ?0`; Chrome's default (origin-keyed) is fine (S1, S3)
- `tools` permissions-policy not allowed -> `NotAllowedError`

### inputSchema format
Plain JSON Schema **object** (not a Zod schema, not a string). Chrome docs (S4/S5)
use `oneOf`/`anyOf` + `const` + `title` for enum labels. zod v4's
`z.toJSONSchema(schema)` output is directly usable. `usewebmcp` (S9): "Standard
JSON Schema v1 inputs such as Zod 4.2+ are also supported." There is **no
`outputSchema` in native WebMCP** (S9: "Native Chrome WebMCP does not advertise
`outputSchema`").

### execute + result format
- `execute(inputObject, { signal })` — 2nd arg carries an `AbortSignal`; pass it to `fetch` etc. for cancellation (S1, S4).
- Return value: **any JSON-serializable JS value**. The spec (S1 "imperative execute steps") `JSON.stringify`s the resolved value and hands the string to the agent. A plain string, a plain object (`return response.json()` in S2), or an MCP-style `{ content: [{ type: "text", text: "..." }] }` (also shown in S2) all work. Non-serializable result / rejected promise -> tool call fails.
- Keep results compact — they land in the model's context window.

## Unregister / dynamic tools

Via `AbortSignal` in options (S1, S4) — exactly what we need for
mount/unmount-scoped dynamic tools (`edit_selected_tile` etc.):

```js
const controller = new AbortController();
await document.modelContext.registerTool(addTodoTool, { signal: controller.signal });
// later:
controller.abort();   // unregisters
```

- Aborting the signal **rejects the registerTool promise** with the abort reason (S1) — catch it.
- S4: "As of Chrome 153, you can unregister a tool without cancelling and breaking in-flight executions." Implication: on Chrome 149-152, aborting during an in-flight execute may cancel it.
- Re-register after abort with the same name is fine (tool map entry is removed).
- Tool changes fire `toolchange` on `document.modelContext` and notify the browser agent (dynamic tool lists are natively supported).

## Discovery / in-page execution (for our own debugging)

```js
const tools = await document.modelContext.getTools();          // same-origin, alphabetical
// each: { name, title, description, inputSchema, origin, window, annotations }
const result = await document.modelContext.executeTool(tool, '{"text":"Buy milk"}'); // -> string
```

`executeTool` takes the **RegisteredTool object** + input; Chrome doc (S4) passes
input as a JSON *string*, spec IDL says `optional object inputObject` — minor
doc/spec mismatch; the polyfill calls it "Chromium's optional executeTool()
extension". Use only for spike/debug, not product logic.
`getTools({ fromOrigins: [...] })` for cross-origin iframes (not relevant to us; ChatGPT ignores iframes anyway).

## Declarative API (Chrome only — we won't use it)

`<form toolname="..." tooldescription="..." [toolautosubmit]>` +
`toolparamdescription` on fields; `SubmitEvent.agentInvoked` + `event.respondWith(promise)` (S5).
**ChatGPT does not support it (S7)** -> irrelevant for the challenge; imperative only.

## Limits / quotas

- No hard max tool count: "While there isn't a maximum number of tools allowed, each tool takes up part of the context window and adds to the time for completion" (Chrome best-practices, upd Aug 2026). Our ~24 tools is fine but descriptions must stay tight.
- Tool name: <=128 chars, `[A-Za-z0-9_.-]` (S1).
- One registration per name per ModelContext.

## Environments

### Chrome (our flag target)
- Origin trial live **Chrome 149+** (S2/S6); Edge 150 has its own OT. Runs through ~Chrome 156.
- Local dev flag: `chrome://flags/#enable-webmcp-testing` -> Enabled -> relaunch (S3).
- Flag maps to `blink::features::kWebMCP` (S11) => **CLI equivalent: `--enable-features=WebMCP`** (works for Playwright/CDP; verified locally, see below).
- Gated on: secure context (localhost counts), origin-keyed agent cluster (default; broken by `Origin-Agent-Cluster: ?0`), `tools` permissions policy (default `self`; cross-origin iframes need `allow="tools"`).
- Debugging: "Model Context Tool Inspector" extension (chromewebstore id `gbpdfapgefenggkahomfgkhfehlcenpd`) — lists registered tools, manual calls, schema validation, natural-language agent chat (default model `gemini-3-flash-preview`) (S3). Official demos: `GoogleChromeLabs/webmcp-tools` (pizza-maker, react-flightsearch, french-bistro, page-agent).
- TS typings: `webmcp-types` npm package (S8) — official, matches spec (Document.modelContext optional).

### ChatGPT in-app browser (S7 — read this doc, it's the judge environment)
- Site tools = ChatGPT's WebMCP impl, in the **desktop app's built-in browser**. Uses `document.modelContext.registerTool` (their own example feature-detects `typeof document.modelContext?.registerTool === "function"`).
- **Supported subset only**: NO declarative API, NO tools in iframes (same- or cross-origin). **Register from the top-level page.**
- Models: GPT-5.6 Sol / Terra (Luna has WebMCP disabled). Not available in Enterprise/Edu workspaces. Requires latest desktop app.
- UI: "Site tools" menu in the address bar shows available tools + recently used. Every invocation gets a safety review; consequential actions trigger confirmation.
- Tool defs/results treated as untrusted content; per-page tool binding (navigate away -> tools gone).

### Others
Brave Leo (experimental), ChatGPT Desktop, Chrome OT, Edge 150 OT; Firefox/Safari: standards-position discussion only (S2 implementation-status).

## Consequences for Kontier RI

1. Use `document.modelContext` with `navigator.modelContext` fallback; feature-detect and render a visible "agent-ready / not available" badge.
2. All tools registered from the **top-level Next.js page** — never from an iframe (ChatGPT limitation). DuckDB in a worker is fine; registration must happen in the main document.
3. `AbortController` per tool registration = React unmount story; catch the abort rejection; guard Strict-Mode double-register (`InvalidStateError` on dup name).
4. zod v4 `z.toJSONSchema()` -> `inputSchema`; validate inputs again inside `execute` with the same zod schema (agents can send anything).
5. Return small JSON objects from `execute`; add `annotations.readOnlyHint: true` on all read-only tools (ChatGPT's safety review + Chrome agents use it).
6. Don't set `Origin-Agent-Cluster: ?0` anywhere (Vercel/Next defaults are fine).
7. Verify early in BOTH: Chrome 149+ flag AND actual ChatGPT desktop browser (subset impl, per-call safety review may change UX timing).

## Open risks

- **R1: ChatGPT support surface may lag spec** — e.g. `toolchange`-driven dynamic tool registration (our selected-tile tools) is spec'd, but S7 doesn't document dynamic re-registration behavior. Must test dynamic tools in ChatGPT early; fallback: statically register `edit_tile(tileId,...)` taking an explicit id.
- **R2: rename churn** — a third rename (e.g. back to `navigator.*` or into a `window.ai` bucket) before the deadline would strand us; the 2-line fallback in the hook mitigates.
- **R3: in-flight abort semantics differ Chrome 149-152 vs 153+** — unmounting a component mid-tool-call may kill the call on the OT range Chrome versions.
- **R4: Playwright/CDP cannot *drive* an agent** — `--enable-features=WebMCP` exposes the API for automated registration tests (done, see below), but real tool *invocation* by an agent needs the Inspector extension or ChatGPT manually. Human verification still required for M1.

## Automated verification (local)

Local Chrome 152.0.7977.65 (>=149) launched via Playwright with
`--enable-features=WebMCP` against `spike/index.html` on a static server.

### Result (run 2026-08-29, macOS, Chrome 152.0.7977.65, headless, `--enable-features=WebMCP`)

Everything passed — see `spike/verify.py`:

- `document.modelContext` **exists**; `navigator.modelContext` **does not** (rename is live in Chrome 152; Cloudflare's `navigator.*` example is stale, fallback kept anyway).
- `registerTool` x2 OK; `getTools()` -> `[echo, increment_counter]`.
- `executeTool(echo, '{"message":"hi"}')` -> `'{"echoed":"hi","at":"..."}'` (result is the JSON-stringified return value, as spec'd).
- `increment_counter(by=5)` mutated the visible DOM counter to 5.
- `controller.abort()` unregistered both tools (`getTools()` -> `[]`), fired `toolchange`, and re-registering the same name afterwards succeeded — the React mount/unmount lifecycle model is confirmed viable.

Not automatable here: agent-driven invocation (Inspector extension / ChatGPT desktop). Human must verify those two manually (M1).
