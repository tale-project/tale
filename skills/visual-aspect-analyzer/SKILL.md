---
name: visual-aspect-analyzer
description: 'Run this as the FINAL review step once you have finished a UI change you can load in a browser — it is the visual-regression gate, run once at the end (not after every edit), and the change is not done until it reports `score: 100`. It drives a real browser over the page, auto-detects its relevant elements (no selectors), labels each by ARIA role + accessible name, and reports which changed the rendered frame, what each is anchored to (screen/page/ancestor), and what transition defects (layout-shift, flicker, jank, dithering) occurred, with a 0–100 score. Run `bun src/analyze-cli.ts <url>` for a lean JSON report (`--full` for the faithful record). Also read before resolving what an element is anchored to, or editing the instrument, analysis, or element auto-detection in this directory.'
---

# visual-aspect-analyzer

**When you have finished a UI change, run this as the final review step** — once,
at the end, not after every individual edit. It is the visual-regression gate: the
change is not done until it reports `score: 100`
([Test a UI change](#test-a-ui-change--the-visual-regression-gate)).

Drive a real browser over a session and report, per **auto-detected element**, what actually
changed on screen. You don't pick the elements — the instrument finds the page's relevant
ones itself ([Auto-detection](#auto-detection)). Impact is **temporal** — true if it held in
_any_ frame — so an element that only starts painting or moving mid-session is still caught.

**Boundaries.** It auto-scrolls but never clicks, types, or logs in, so defects behind an
interaction are caught only via the embed [`interact`](#embed--test) hook. It sees the
**main document** only — closed shadow roots and cross-origin iframes aren't pierced.

## Run it

```bash
bun src/analyze-cli.ts <url>     # run from the skill directory
```

In the Tale sandbox this is **pre-installed** — the bundle, its `pngjs` dep, the
`playwright` package (shared with the agent's browser tooling), and Chromium are all baked
into the image, so there is **no install step**. (Working on the skill locally instead?
Install the browser tooling once first: `bun add -d playwright && bunx playwright install chromium`.)

Paths below are relative to the skill directory. Needs **Bun** ([bun.sh](https://bun.sh)) —
no npm/node fallback. The run is **headless and self-driving**: it loads the page hidden,
auto-scrolls the whole session, then exits on its own (seconds for a light page) — nothing
waits on you. Any reachable URL works, including a local dev server (`http://localhost:3000`)
— start your server first; the tool drives a browser, it doesn't launch your app.

- **No build step** — Bun runs the TypeScript directly and bundles the in-page instrument in memory.
- **Always on** — pixel capture (dithering + the paint check) and auto-scroll (lazy content + CLS), so a bare run never silently misses a defect.
- **stdout is pure JSON** (the compact report); the health summary always prints to **stderr**. `bun src/analyze-cli.ts <url> > report.json` saves the report while the summary still shows in your terminal.
- **One flag, `--full`** (the faithful Report). It fixes the session knobs (`keyframes` 4, `settleMs` 500 → a ~2 s sample window); to tune sampling depth/window, dithering sensitivity (`pixelThreshold`), or to log in before sampling, use the [embed path](#embed--test).
- **Offline** — re-analyze a saved recording with no browser: `bun src/cli.ts <recording.json>`.

## Exit codes & failure modes

The agent must predict whether a run yields a report, an empty report, or a crash:

- **Exit 0 on any successful analysis — even `score` 50 with defects.** The exit code is _not_ a
  gate. Non-zero (1) means it produced **no report**: missing url, no browser installed, or a
  navigation failure. **To gate in CI, parse stdout and fail on `score < 100` (or
  `defects.length > 0`) — never on `$?`.**
- **A dead or hanging URL** throws after Chromium's ~30 s nav timeout → one-line stderr error,
  exit 1, no report.
- **Auth-walled pages**: the browser is fresh, with no cookies or credentials, so it analyzes
  the _login wall_. Use a pre-authenticated URL or the embed [`interact`](#embed--test) hook.
- **An empty `elements[]` / `audit.discovered: 0` is not "clean."** A real failure throws (no
  report); a _printed_ report with no elements usually means a served error page (a 404/500
  still loads) or the wrong URL — confirm the page renders what you expect before trusting
  `score: 100`.

## Output — compact, AI-first

`stdout` is a distilled report (`--full` keeps the faithful one). Shape:

- **top** — `url`, `score` (0–100), `elements[]`, `defects[]`; plus, when present: `hints`
  (one fix per defect type present), `audit` (present only for a whole-page run: `wholePage`
  (always true), `discovered`, `capped`), `transitions[]` (non-smooth ones plus any with a
  known easing curve), a `smoothTransitions` count, and `elementsOmitted`/`defectsOmitted` (how
  many entries the worst-first caps dropped — surfaced so a cap is never a silent truncation).
- **element** — `selector`, `label` (`role "name"`, e.g. `nav "Main"`, else the selector),
  `testid` (or `null`), `source` (`matched`=auto-detected | `affected`=moved by one), `impact`
  (`paints`/`layout`), `anchoredTo` (`screen`/`page`/an ancestor selector/`null`),
  `anchoredEdges` (which edges stayed constant — or `[]`), `to` (the settled box as
  `[left, top, width, height]` in page coords); plus `from` (the start box) when the element
  moved/resized, and `affectedBy` when present. (`--full` carries the raw start/end box in both
  screen and page coords under `bounds`.)
- **defect** — `type` (`layout-shift`/`flicker`/`jank`/`dithering`), `selector`, `label`,
  `severity` (0–1), `window` `[start,end]` ms, `detail`, `metrics` (the decision-relevant
  numbers per type: `value` for layout-shift; `toggleCount`+`frequencyHz` for flicker;
  `droppedFrames`+`maxJumpPx` for jank; `noiseEnergy` for dithering); plus `count` when >1.
- **transition** — `selector`, `label`, `kind` (`move`/`resize`/`fade`/`color`/`composite`),
  `smoothness` (`smooth`/`janky`/`flicker`/`shift`), `quality` (0–1); plus `easing`
  (`linear`/`ease-in`/`ease-out`/`ease-in-out`) when determinable.

Coalesced by type+selector, numbers rounded, fix hints hoisted to one entry per type — much
smaller than the raw record. **Worked example** — [`examples/sample-report.json`](examples/sample-report.json):
`score` 92 (one `layout-shift`); `footer` returned `source:"affected"`, `affectedBy:["va-block"]`,
fixed via the matching `hints` entry.

## Test a UI change — the visual-regression gate

**Run this as the final review step once your UI change is complete** — once, at the end, not
after every edit. There is no cross-run diffing built in, so **baseline first** to tell your
defects from pre-existing ones:

1. **Baseline** the unchanged page: `bun src/analyze-cli.ts <url> > before.json`. Apply your
   change, run again to `after.json`. Defects in `after` but not `before` are yours. (A stable
   `data-testid` in your markup is reused as the element's `testid`, so your changed element is
   easy to find.)
2. **Read `after.json`** (compact JSON on stdout; a health line on stderr):
   - **`score`** — starts at 100; each defect type subtracts `weight × min(Σ its severities, 1)`,
     capped per type: layout-shift −45, jank −30, flicker −25, dithering −12. **Any** reported
     defect forces `score ≤ 99`, so `score === 100` is the only provably-clean result. There is
     no built-in fail threshold — pick your own, and prioritize by defect type+severity, not the
     score alone.
   - **`defects[]`** — what's broken, each with `severity`, `window`, `metrics`; the per-type fix
     is in top-level `hints`. Act on these first.
   - **`source:"affected"` + `affectedBy`** — _causality_. Every element your change moved comes
     back attributed to it; an absolutely/fixed-positioned element that did **not** actually move
     is correctly left out. This answers "what did my change shift?".
   - **`anchoredTo`/`anchoredEdges`** — is it held where you intended (`screen`/`page`/ancestor)?
   - **`to`/`from`** — where it ended up and (when it shifted) where it started, each
     `[left, top, width, height]` in page coords.
   - **empty `elements[]`** — not "clean"; see [Exit codes & failure modes](#exit-codes--failure-modes).
3. **Blast radius of one element** — find it in `elements[]` (by `label`/`testid`/`selector`),
   then scan for `source:"affected"` entries whose `affectedBy` lists it.

**Done when `score` is 100** (≡ zero `defects[]`). Below 100 you are not done until every defect
**and** every `source:"affected"` element traces to an _intended_ change — one you can't
attribute to your change is a regression; fix it, don't stop.

## How it works

1. **Auto-detect & tag** the page's relevant elements, each with a stable `data-testid` (it
   pins one node through mutations) and a `role "name"` label — see [Auto-detection](#auto-detection).
2. **Instrument** — Mutation / Resize / Intersection / Performance(`layout-shift`) observers
   plus an rAF geometry/opacity/colour sampler; the driver captures pixels.
3. **Segment** on SPA nav (`pushState`/`replaceState` + a view-changing popstate; a `#hash`-only
   change never segments) and on reloads (recording persists via `sessionStorage`, so MPA
   accumulates).
4. **Filter** — scope (tracked and affected) → seen (entered viewport) → had visual impact.
5. **Anchor and score** each survivor.

### Auto-detection

The instrument finds the page's developer-recognizable component roots itself — no selectors:

- **Event boundaries** ([`listeners.ts`](src/listeners.ts)) — it wraps `addEventListener`
  _before the page's own scripts run_ to record which elements get interaction handlers, a
  strong "this is a component" signal.
- **A scored selection at settle** ([`select.ts`](src/select.ts)) — candidates from cheap
  signals (landmarks & roles, headings, interactive elements, the boundaries above, media,
  component-name hints like `hero`/`card`/`nav`, repeated list/grid items), then one batched
  layout pass **scores** each, collapses wrappers to the **component root**, and keeps the top
  set within a budget.
- **Media + activity** — replaced media (`canvas`/`video`/`img`) is always seeded, and the
  observers add anything that becomes active at runtime. Coverage is in the `audit` block
  (`discovered`, `capped`) — never a silent truncation. Each element is labeled by its ARIA
  role + accessible name ([`accname.ts`](src/accname.ts)), falling back to a CSS path. A
  decorative static element with no role, interactivity, media, or name hint carries no signal,
  so it may not be detected — give it a `role`/recognizable `class`/`data-*` if you need it.

### Scope boundaries

What the instrument observes, and where it intentionally stops (these are scope, not bugs — it
never crashes or fabricates a defect at any of them):

- **Light DOM only** — elements inside open _or_ closed **shadow roots** aren't discovered (their
  CSS animations don't even surface — `animationstart`/`transitionrun` are `composed:false`). A
  page whose entire UI lives in a shadow root audits to `discovered:0`. Light-DOM _effects_ of
  shadow content are still caught (a shadow subtree that grows and pushes a light-DOM sibling shows
  up as that sibling's `layout-shift`). The same holds for the **UA shadow DOM** of native controls
  — an `<input type=range>` thumb, `<progress>`/`<meter>` fill, or `<select>` dropdown lives in
  UA-internal pseudo-content, so its motion/fill is invisible; the control's own host box (a
  `<textarea>` auto-growing, `<details>` expanding) is fully tracked.
- **Top document only** — the instrument runs in the main frame, so an **iframe's** internal
  changes are opaque. The `<iframe>` element's own box (move/resize) and any CLS it causes in the
  parent _are_ caught.
- **Top layer is honored** — `<dialog>`/popover/`::backdrop` occlusion is hit-tested via
  `elementFromPoint`, so a top-layer cover correctly occludes content **even with a lower z-index**.
  A modal `::backdrop` makes the whole viewport read as occluded.
- **Late reveal isn't back-dated** — an off-screen `content-visibility:auto` (or `:hidden`) subtree
  is discovered only when first rendered, so its pre-reveal state isn't sampled (the general
  temporal/discovery boundary). The reveal's _effect_ on neighbours (CLS) is still caught.
- **Paint is style-gated, not 3D-projected** — `visibility`/`display`/`opacity`/occlusion gate
  paint, not the computed transform matrix, so an element rotated past 90° with
  `backface-visibility:hidden` still counts as painting.
- **Pseudo-elements aren't tracked** — `::before`/`::after`/`::marker`/`::view-transition*` are not
  DOM nodes, so a change confined to a pseudo-element isn't characterized (a `::before` badge
  animating; a View Transitions cross-fade, which the browser renders in `::view-transition`
  snapshots). The host element's own box/paint/visibility deltas still are — including the real
  before→after jump a view transition produces on the underlying element.

## Invariants

- **Impact is temporal** — unioned over frames; the `display:none` counterfactual only
  confirms.- **Two impact modes** — _paints_ (occlusion-gated) and _affects layout_, independent.
- **Affected-by is causal** — same-frame co-movement, confirmed by layout-shift sources and
  the counterfactual.- **Motion ≠ scroll ≠ resize** — a move translates the whole box in _both_ coordinate
  spaces; a size change shifts one edge of a pair.- **Each defect from the source that sees it** — layout-shift from the API (CLS never
  recomputed), flicker from opacity, jank from frame timing, dithering from pixel noise.
- **`pixelThreshold`** governs every constant-vs-changed test, so results are deterministic.
- **No `any`/`as`/`unknown`** — boundary parsing uses guards in
  [`recording.ts`](src/recording.ts).

## Embed & test

```ts
import { buildInstrumentBundle } from './src/bundle';
import { analyzeSession } from './src/driver'; // any Playwright-shaped page works
const report = await analyzeSession(page, {
  url,
  instrumentBundle: await buildInstrumentBundle(),
  capturePixels: true, // dithering + the paint counterfactual — the CLI sets this; omit and you lose both
  // interact: async (p) => {/* log in / open a modal before sampling */},
  // keyframes: 4, settleMs: 500, pixelThreshold,  // session knobs the CLI fixes
});
```

`bun test` (unit) · `bun run typecheck` (strict) · `bun run e2e` (real Chromium, skips
without a browser).

## Companion files

- [`examples/run.md`](examples/run.md) — CLI, embedding, and the e2e fixtures.

Implementation deep-dives live next to the code they document: `src/impact-detection.md`
(impact + affected-by internals) and `src/defects/transition-defects.md` (defect algorithms
and report schema).
