# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running any
suite alongside the automated ones — they share one machine.

## Coverage map

One row per area. **Don't** re-verify an `automated` row by hand: a red there is
a spec failure and belongs in the gate, not in a round.

| Area | Owning spec | Manual scope |
|---|---|---|
| Front page renders: hero `h1`, primary call to action, no console errors | `tests/e2e/specs/smoke.spec.ts` › front page | the marketing paper, the reveals, the product window's look in both themes ([home.md](../suites/home.md)) |
| Docs page renders: rail landmark, `h1`, a live example | `tests/e2e/specs/smoke.spec.ts` › documentation page | row highlight, scroll-into-view of the active row, trail typography ([docs.md](../suites/docs.md) `DOCS-1`, `DOCS-2`) |
| The Code toggle reveals the example source | `tests/e2e/specs/smoke.spec.ts` › documentation page | the copy button, the panel's syntax colours in both themes (`DOCS-5`) |
| The body after the first example still renders (≥ 6 Code toggles, the closing `h2`) | `tests/e2e/specs/smoke.spec.ts` › documentation page | — |
| The outline rail appears at desktop width | `tests/e2e/specs/smoke.spec.ts` › documentation page | scroll-spy walking, click-to-scroll (`DOCS-6`) |
| The theme switcher flips the document theme | `tests/e2e/specs/smoke.spec.ts` › documentation page | every surface re-skinning from tokens, persistence across reload (`DOCS-10`, `HOME-4`) |
| With nothing saved the theme follows the OS (**System** checked); a picked theme wins and survives a reload | `tests/e2e/specs/smoke.spec.ts` › documentation page | — |
| `/docs` redirects to the first page in nav order | `tests/e2e/specs/smoke.spec.ts` › routing | — |
| An unknown page renders the 404 with a way back | `tests/e2e/specs/smoke.spec.ts` › routing | the real `404` status on the built server ([seo.md](../suites/seo.md) `SEO-8`) |
| ⌘K opens the palette and finds a component page | `tests/e2e/specs/smoke.spec.ts` › search | grouping, snippets, keyboard order, recents, empty state ([search.md](../suites/search.md)) |
| Settings demo save/discard baseline and reload reset | `tests/e2e/specs/demo-workflows.spec.ts` › settings demo | judge the explanatory copy and layout |
| Single toast viewport and replacement | `tests/e2e/specs/demo-workflows.spec.ts` › toast examples | judge placement and readable feedback |
| Deep-page first Tab and skip-link destination | `tests/e2e/specs/demo-workflows.spec.ts` › deep page | visible focus treatment |
| Outline scroll behavior follows reduced motion | `packages/ui/src/components/docs/docs-toc.test.tsx` › DocsToc › honors reduced motion | perceived motion and final heading position |
| Nav ↔ file parity, group labels in every locale, nav order | `tests/navigation.test.ts` | — |
| Every `<Demo>` resolves, every demo is used, no raw hex in a demo | `tests/demos.test.ts` | — |
| Frontmatter present, single `h1`, manifest in sync with disk | `tests/content.test.ts` | — |
| Content loader contract | `tests/loader.test.ts` | — |
| Optional analytics: runtime disablement, safe SPA pageviews, DNT/GPC and the collector boundary | `packages/ui/src/analytics/browser.test.ts`, `packages/ui/src/analytics/server.test.ts`, `tests/analytics.test.ts` | — |
| Chrome a11y (axe): the docs frame (layout, nav tree, header strip, article, outline, neighbours, footer, page actions, 404) and the demo tag | `packages/ui/src/components/docs/*.test.tsx` + `app/**/*.test.tsx` | focus order and visible focus rings by hand, colour contrast (axe's contrast rule is off in jsdom) |
| Locale routing: a German/French reader is not redirected off this single English tree, no `tale_locale` cookie is written, and a stale `/de…` / `/fr…` 301s onto the tree | `packages/ui/src/server/locale-routing.integration.test.ts` | the same two probes against the **deployed** site ([seo.md](../suites/seo.md) `SEO-10`, `SEO-11`) |
| Image builds, health, headers, artifacts, 404 status | `services/platform/tests/integration/container-ui-docs-test.ts` (`bun run docker:test:ui-docs`) | prerendered content without JavaScript (`SEO-2`) |
| Phone drawer: open, choose a row, Escape, focus return, viewport release | — | **manual-only** — a focus-trap release timed to an exit animation is what jsdom cannot judge (`DOCS-12`, `DOCS-13`) |
| Header strip and rail logo row end on one line, with the page actions in the strip | `tests/e2e/specs/smoke.spec.ts` › documentation page + `packages/ui/src/components/docs/docs-layout.browser.test.tsx` | the look of the line in both themes (`DOCS-2`) |
| Footer indexes, theme control and repository link; Back to top follows reduced motion | `packages/ui/src/components/docs/docs-footer.test.tsx`, `scroll-to-top.test.tsx` | placement and clearance (`DOCS-15`, `DOCS-17`) |
| Print | — | **manual-only** — the frame hides its chrome in print (`DOCS-16`) |

Legend: a named spec owns the row end to end · a named spec **plus** a manual
scope is partial · `—` is manual-only.

## Seams

- `bun run --filter @tale/ui-docs test:e2e` boots its own Vite server on
  `UI_DOCS_E2E_PORT` (default 3003, `--strictPort`) and runs the content build
  first. Beside a round on :3003, run it on another port
  (`UI_DOCS_E2E_PORT=3007 …`); it never touches the round's browser state.
- `bun run docker:test:ui-docs` builds the image and probes it on **:13003**;
  it rebuilds `dist/`, `dist-ssr/` and `dist-seo/` inside the image only —
  the working tree's `dist/` (from a local `build`) is untouched.
- The unit suites never start a server and never write outside `node_modules`.

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; a row that names a deleted spec is worse, so
`bun run lint:manual` rejects a box ID here that no suite defines.
