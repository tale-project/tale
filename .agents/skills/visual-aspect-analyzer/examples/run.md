# Running the analyzer

## Turnkey CLI (live url → report) — the agent path

```bash
bun install
bunx playwright install chromium   # one-time browser download

# Analyze a live page — the instrument auto-detects its relevant elements
bun src/analyze-cli.ts https://example.com
```

No build step — Bun runs the TypeScript directly and bundles the in-page instrument in
memory. Everything that improves results is on by default: pixel capture (dithering + the
paint counterfactual) and auto-scroll (lazy content + CLS) always run.

- **stdout** is the **lean, AI-optimized** JSON report — coalesced defects, rounded numbers,
  no noise (pipe it, save it, parse it). `--full` swaps in the faithful `Report`. Redirect
  stdout with your shell to save it to a file.
- The **health summary** (score, worst defects, hints) always prints to **stderr**, so
  stdout stays pure JSON.
- The only flag is **`--full`** (the faithful Report). There are no selectors — the
  instrument auto-detects the page's relevant elements (scored component roots + media +
  active elements) and labels each by its `role "name"`.
- With no browser installed it prints the install command and exits non-zero.
- Every run reports an `audit` block (`discovered`, `capped`). A purely-decorative static
  element with no role, interactivity, media, or component-name hint carries no signal and so
  may not be auto-detected — give it a `role`/recognizable `class`/`data-*` if you need it.

## Offline (no browser): re-analyze a recording

```bash
bun src/cli.ts examples/sample-recording.json          # lean compact report
bun src/cli.ts examples/sample-recording.json --full   # the faithful Report
```

[`sample-recording.json`](sample-recording.json) is a four-frame session where `#promo`
grows and pushes `footer` down; the compact [`sample-report.json`](sample-report.json) shows
`footer` as `source: "affected"`, `affectedBy: ["va-block"]`, a coalesced `layout-shift`
defect with its `metrics` (a top-level `hints` map carries the per-type fix), and the
footer's `move` transition marked `smoothness: "shift"` with a `quality` score (92/100). It's
a whole-page audit (note the `audit` block), so each element carries a `label` from its ARIA
role + accessible name — here `banner "Promo"` and `contentinfo "Site footer"` — shown
alongside the precise `selector`. Each element also carries its settled `to` box (`[left, top,
width, height]`, page coords) and a
`from` box — here `#promo` grows in place and `footer`'s box slides down — so you get
the position and bounding box, not just that it moved. `--full` keeps the raw start/end box
in both coordinate spaces under `bounds`. Transitions with enough frames also carry an
`easing` label (`linear`/`ease-in`/`ease-out`/`ease-in-out`) approximating how the element
moves; the footer's two-frame jump here is too abrupt to classify, so it has none.

## Embedding the driver

Any Playwright-shaped page satisfies the structural `PageLike` (the repo's Browserbase
`browse` tooling works too — no hard Playwright dependency):

```ts
import { buildInstrumentBundle } from '../src/bundle';
import { analyzeSession } from '../src/driver';

const report = await analyzeSession(page, {
  url: 'https://example.com/',
  instrumentBundle: await buildInstrumentBundle(), // Bun bundles it in memory
  keyframes: 5,
  settleMs: 200,
  capturePixels: true,
  interact: async (p) => {
    await p.evaluate('window.scrollTo(0, 1200)');
  },
});
```

`analyzeSession` injects the instrument on every navigation (so it survives full reloads),
drives keyframe sweeps, captures screenshots for the pixel pipeline, pulls `__VA.dump()`,
validates it, and returns the `Report`.

## Verifying

- `bun test` — the analysis engine, the instrument (happy-dom), and the pixel helpers.
- `bun run typecheck` — strict, no-`any` gate.
- `bun run e2e` — drives `tests/fixtures/*.html` in real Chromium under auto-detection and
  asserts the report: fixed nav → `screen` anchor, promo → affected footer + layout-shift,
  cascade → affected items (absolute `#floating` not), overlay → flicker, canvas → dithering,
  spa → two segments, transparent veil → paint counterfactual. Skips cleanly when no browser
  is installed.
