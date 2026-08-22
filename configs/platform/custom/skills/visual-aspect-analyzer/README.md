# visual-aspect-analyzer

Drive a real browser over a session and report, per **auto-detected element**, what actually
changed on screen: **identity** (each element's `role "name"` label), **visual impact** (did
it change the frame?), **anchors** (what holds it in place?), **position** (each element's
bounding box, and where it moved from), **motion** (the approximate easing curve —
linear/ease-in/ease-out/ease-in-out), and **transition defects** (layout-shift, flicker,
jank, dithering) — with a 0–100 health score and fix hints. You don't pick the elements: the
instrument finds the page's relevant ones for you (see [Auto-detection](#auto-detection)).

## Install

```bash
bun install
bunx playwright install chromium   # for the live CLI / e2e only
```

Runs on Bun directly — **no build step**; the in-page instrument is bundled in memory.

## Use

```bash
# Turnkey: analyze a live url (launches its own browser, auto-detects elements)
bun src/analyze-cli.ts <url>

# Offline: re-analyze a recorded session
bun src/cli.ts examples/sample-recording.json
```

There are no selectors to pass — the instrument auto-detects the page's relevant elements.
Pixel capture and auto-scroll are always on (so a bare run never misses a defect), and the
health summary always prints to `stderr`. The only flag is `--full` (faithful `Report`).

Or embed the driver (any Playwright-shaped page satisfies `PageLike`):

```ts
import { buildInstrumentBundle } from './src/bundle';
import { analyzeSession } from './src/driver';
const report = await analyzeSession(page, {
  url,
  instrumentBundle: await buildInstrumentBundle(),
  capturePixels: true, // dithering + the paint counterfactual — the CLI sets this; omit and you lose both
  // interact: async (p) => {/* log in / open a modal before sampling */},
  // keyframes: 4, settleMs: 500, pixelThreshold,  // session knobs the CLI fixes
});
```

`stdout` is a **lean, AI-optimized** report (defects coalesced, numbers rounded, fix hints
hoisted to one per type — much smaller than the raw record); `--full` emits the faithful
`Report`. See [`SKILL.md`](SKILL.md) for the exact schema.

## What it detects

- **Impact (temporal):** _paints_ (occlusion-gated) and/or _affects layout_, unioned over
  every frame — caught even if it only starts mid-session.
- **Affected-by (causal):** the elements a tracked element moved — same-frame co-movement,
  confirmed by `layout-shift` sources and an invisible counterfactual.
- **Anchors:** `screen` · `page` · an ancestor · `null`.
- **Transitions:** `move` · `resize` · `fade` · `color` · `composite`, scored `smooth` /
  `janky` / `flicker` / `shift` (scroll and pure resizes are never mistaken for motion).
- **Defects:** `layout-shift` (CLS, read not recomputed), `flicker`, `jank`, `dithering`.

## Auto-detection

There are no selectors. The in-page instrument finds the page's developer-recognizable
component roots itself, then tracks them through the same pipeline:

1. **Event boundaries.** Injected before the page's own scripts, it wraps `addEventListener`
   to record which elements get interaction handlers (click/pointer/key/input/…) — a strong
   "this is a component" signal ([`listeners.ts`](src/listeners.ts)).
2. **A scored selection at settle.** It gathers candidates from cheap signals — landmarks &
   roles, headings, interactive elements, the event boundaries above, media, and
   component-name hints (`hero`/`card`/`nav`/…) — then does one batched layout pass to
   **score** each (semantics + interactivity + visual prominence), collapses parent/child
   wrappers to the **component root**, and keeps the top set within a budget
   ([`select.ts`](src/select.ts)).
3. **Media + activity.** Replaced media (`canvas`/`video`/`img`) is always seeded, and the
   mutation/resize/intersection/layout-shift/animation observers add anything that becomes
   active at runtime.

Each tracked element is labeled by its ARIA **role + accessible name**
([`accname.ts`](src/accname.ts)) — `nav "Main"`, `button "Add to cart"` — falling back to a
CSS path. Coverage is reported in the `audit` block (`discovered`, `capped`), never a silent
truncation.

## Architecture

| Layer                   | Files                                                                                                                                     | Runs in                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| In-page instrument      | [`instrument.ts`](src/instrument.ts) · [`select.ts`](src/select.ts) · [`listeners.ts`](src/listeners.ts) · [`accname.ts`](src/accname.ts) | the browser (injected IIFE) |
| Driver + pixel pipeline | [`driver.ts`](src/driver.ts) · [`pixels.ts`](src/pixels.ts) · [`annotate.ts`](src/annotate.ts)                                            | Node / Bun                  |
| Analysis (pure)         | [`impact`](src/impact.ts) · [`anchors`](src/anchors.ts) · [`defects/`](src/defects/) · [`report`](src/report.ts)                          | Node / Bun                  |
| Boundary                | [`recording.ts`](src/recording.ts) — guards untyped JSON → typed `Recording`                                                              | Node / Bun                  |
| Output                  | [`summarize.ts`](src/summarize.ts) · [`compact.ts`](src/compact.ts) · CLIs                                                                | Node / Bun                  |

## Verify

```bash
bun run typecheck   # strict TS, no any/as/unknown
bun test            # unit (analysis, instrument via happy-dom, pixels, bundle)
bun run e2e         # real Chromium against tests/fixtures (skips with no browser)
```

`typecheck` and `test` run on every pull request as part of the repo-wide gate
in [`.github/workflows/checks.yml`](../../../.github/workflows/checks.yml), which also
runs oxfmt, oxlint, knip, and commitlint. This skill is a turbo workspace, so its
checks run through `bun run check` (or `bunx turbo run typecheck test`) at the
repo root — no separate install or lockfile here.

## Scope & limitations

- Auto-detection sees the **main document** only — closed shadow roots and cross-origin
  iframes are not pierced.
- Pixel capture clips to the **viewport**; off-screen frames yield no pixel noise (the
  observer/geometry signals still apply). Dithering noise is averaged over the element's
  box, so a small churning region inside a large element can dilute below the threshold.
- A purely-decorative **static** element with no semantic role, interactivity, media, or
  component-name hint carries no signal, so it may not be auto-detected; give it a `role`,
  a recognizable `class`/`id`, or a `data-*` attribute if you need it tracked.

See [`SKILL.md`](SKILL.md) and the in-code deep-dives
[`src/impact-detection.md`](src/impact-detection.md) /
[`src/defects/transition-defects.md`](src/defects/transition-defects.md).
