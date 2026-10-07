# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running a
suite alongside the automated ones — they drive the same stack.

## Coverage map

One row per case group, carried over from the per-suite coverage tables the
guides used to hold. **Don't** re-verify an automated row by hand: a red there
is a spec failure and belongs in the gate, not in a round.

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

| Suite | Boxes | Status | Owning spec |
|---|---|---|---|
| [forms](../suites/forms.md) | Completed submission counts only; no failed conversion or form contents | ✅ automated | `lib/forms/submit-client.test.ts` |
| [navigation](../suites/navigation.md) | Optional analytics: runtime disablement, safe SPA pageviews, private route templates, DNT/GPC and collector boundary | ✅ automated | `packages/ui/src/analytics/browser.test.ts`, `packages/ui/src/analytics/server.test.ts` |
| [accessibility](../suites/accessibility.md) | Layer / case | Status | Where |
| [accessibility](../suites/accessibility.md) | Per-component axe (WCAG 2.1 AA) | ✅ automated | `@tale/ui` component tests (`checkAccessibility()` via `vitest-axe`) + Storybook a11y addon |
| [accessibility](../suites/accessibility.md) | `A11Y-A3` on `/platform` + `/pricing` | ✅ automated | `smoke.spec.ts` (single `h1`, no skipped levels in `main`) |
| [accessibility](../suites/accessibility.md) | `A11Y-A7` (demo end states under reduced motion) | 🔶 partial | `home-demos.spec.ts` (end-state cases run with `reducedMotion: 'reduce'`; separate narrow sandbox cases verify stable height during normal playback) |
| [accessibility](../suites/accessibility.md) | `A11Y-A8` (demo accessible names) | 🔶 partial | `home-demos.spec.ts` (locates every demo by `getByRole('img', { name: … })`) |
| [accessibility](../suites/accessibility.md) | `A11Y-A1`–`A11Y-A2`, `A11Y-A4`–`A11Y-A6`, `A11Y-B1`–`A11Y-B2` | ⛔ manual-only | — this guide |
| [forms](../suites/forms.md) | `FORM-F1`, `FORM-F3` (render only) | 🔶 partial | `smoke.spec.ts` (`/contact` and `/request-demo` each render a form + their submit button by label) |
| [forms](../suites/forms.md) | `FORM-F2`, `FORM-F4`–`FORM-F6`, `FORM-B1`–`FORM-B10` | ⛔ manual-only | — (no spec drives a submit; the endpoint itself has no test) |
| [locale](../suites/locale.md) | `LOC-F2` (render only) | 🔶 partial | `smoke.spec.ts` (`/de`, `/de/platform`, `/de/pricing` render) |
| [locale](../suites/locale.md) | `LOC-F3` (render only) | 🔶 partial | `smoke.spec.ts` (`/fr/changelog`, `/fr/contact` render) |
| [locale](../suites/locale.md) | — | ✅ automated | vitest `lib/i18n/messages.test.ts` (locale files stay key-compatible) |
| [locale](../suites/locale.md) | `LOC-F1`, `LOC-F4`–`LOC-F8`, `LOC-B1`–`LOC-B2` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-F1` | 🔶 partial | `smoke.spec.ts` (home renders; Platform / Resources triggers + Pricing link; Platform menu opens and lists **Chat**) |
| [navigation](../suites/navigation.md) | Desktop Platform/Resources keyboard open, Tab into a link, Escape focus return, and preservation of focus outside the disclosure | ✅ automated | `smoke.spec.ts` (desktop disclosure Escape regressions) |
| [navigation](../suites/navigation.md) | Hero self-hosting CTA stays in EN/DE/FR at desktop and phone widths | ✅ | `smoke.spec.ts` (localized label, destination, and heading) |
| [navigation](../suites/navigation.md) | `NAV-F2` | 🔶 partial | `smoke.spec.ts` (header **Get started** visible; no header **Request a demo** — no click-through) |
| [navigation](../suites/navigation.md) | `NAV-F9` | 🔶 partial | `smoke.spec.ts` (`/pricing` renders + heading-order check — no control interaction) |
| [navigation](../suites/navigation.md) | `NAV-F12` | 🔶 partial | `changelog.spec.ts` (sticky timeline reachability + `aria-current` on click) |
| [navigation](../suites/navigation.md) | `NAV-B1` | 🔶 partial | `smoke.spec.ts` (`/nope-not-a-route` shows the not-found heading + **Back to the homepage** — SPA nav, not the HTTP status) |
| [navigation](../suites/navigation.md) | `NAV-F3`–`NAV-F8`, `NAV-F10`–`NAV-F11` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-B2`–`NAV-B4` | ⛔ manual-only | — |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F1`–`PAGE-F2` | 🔶 partial | `home-demos.spec.ts` (three main chapters and three supporting capability cards link to every module) + `smoke.spec.ts` (renders) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F4` | 🔶 partial | `smoke.spec.ts` (each module page renders; heading order on `/platform`) — section stack not asserted |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F5`–`PAGE-F9` | 🔶 partial | `home-demos.spec.ts` (per-page demo stories under reduced motion, distinct from the homepage scenarios) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F11` | 🔶 partial | `changelog.spec.ts` (sticky timeline reachability + `aria-current` on click) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-A1` | 🔶 partial | `smoke.spec.ts` (single `h1` / no skipped levels — `/platform` and `/pricing` only) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-A2` | 🔶 partial | `home-demos.spec.ts` (every demo located by `role="img"` accessible name) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F3`, `PAGE-F10`, `PAGE-F12`, `PAGE-B1`–`PAGE-B2`, `PAGE-A3`, `PAGE-P1`–`PAGE-P2` | ⛔ manual-only | — |
| [responsive](../suites/responsive.md) | Cold startup retains the prerendered page until its route is ready; changelog timeline updates never move the document at the footer | ✅ automated | `app/main.test.tsx`, `changelog.spec.ts` |
| [responsive](../suites/responsive.md) | Cold homepage startup preserves reading position, including initial hashes; normal-motion wheel scrolling and anchor continuation remain stable through navigation hover; subsequent route changes still reset scroll | ✅ automated | `scroll-stability.spec.ts` (390/1440px; actual homepage snapshot fallback for client-only preview) |
| [responsive](../suites/responsive.md) | Agent identities, knowledge sources, chat replies, workflow, governance, task board and sandbox text fits every clipping ancestor in EN/DE/FR at 320, 390, 768, 1024 and 1440px; task cards remain at least 140px wide without overlapping; mobile GitHub target is at least 44px high | ✅ automated | `demo-responsive.spec.ts` |
| [responsive](../suites/responsive.md) | `RESP-F1`–`RESP-F5`, `RESP-B1`–`RESP-B2`, `RESP-A1`–`RESP-A2`, `RESP-P1` | ⛔ manual-only | — (`smoke.spec.ts` runs desktop-viewport only) |
| [seo](../suites/seo.md) | Every marketing locale's title, description, h1, canonical, reciprocal alternates and sitemap entry; legal noindex HTML and crawlable Markdown response policy | ✅ | `tests/prerender/seo.test.ts`, `lib/seo/build.test.ts` (`bun run --filter @tale/web test:prerender` after a complete build) |
| [seo](../suites/seo.md) | Per-page Markdown declares its configured HTML canonical on fresh, cached and conditional responses; aggregates stay uncanonicalized; invalid header metadata is refused and old manifests still load | ✅ automated | `packages/ui/src/seo/runtime/canonical.test.ts` |
| [seo](../suites/seo.md) | Exported Markdown resolves real links and HTML resources against each source page while preserving code examples | ✅ automated | `packages/ui/src/seo/builders/page-as-markdown.test.ts`, `packages/ui/src/seo/builders/llms-full-txt.test.ts` |
| [seo](../suites/seo.md) | Guide locale identity, validated metadata, publication clusters, draft exclusion, internal links and related use cases | ✅ automated | `lib/content/*.test.ts` |
| [responsive](../suites/responsive.md) | Guide hubs and articles in EN/DE/FR at 320/1440px; single H1, canonical/alternates, comparison table semantics and keyboard scrolling, localized links, related navigation and unknown slug recovery | ✅ automated | `marketing-content.spec.ts` |
| [responsive](../suites/responsive.md) | Every localized competitor guide has a named table, three columns, substantive rows and matching dimensions across locales | ✅ automated | `lib/content/comparison-tables.test.tsx` |
| [responsive](../suites/responsive.md) | Unequal pricing segment labels retain both text gutters and fit narrow containers, with keyboard selection | ✅ automated | `packages/marketing-ui/src/components/blocks/segmented-radio.stories.tsx` (`test:storybook`) |
| [seo](../suites/seo.md) | Registry bijection | ✅ | `lib/seo/marketing-routes.test.ts` |
| [seo](../suites/seo.md) | Image budgets | ✅ | `tests/images.test.ts` |
| [seo](../suites/seo.md) | Build-time release snapshot keeps the newest 40 complete releases without mutating the fetched list | ✅ | `lib/releases/write-manifest.test.ts` |
| [seo](../suites/seo.md) | Crawlable live JSON releases, cache fallback, six-hour freshness reporting (counted from the server start at the earliest) and localized alternate links | ✅ | `lib/releases/route.test.ts`, `lib/releases/feed.test.ts`, `tests/prerender/seo.test.ts` |
| [seo](../suites/seo.md) | Container HTTP probes | ✅ | `services/platform/tests/integration/container-web-test.ts` (`/nope`→404, `/pricing`, `/de/pricing`, sitemap, og.png) |
| [seo](../suites/seo.md) | A path no file can carry — a NUL or another C0 control (`/%00`, `/a%00b`, `/de/%00`), or one past the OS path limit (5000 characters) — answers the real 404, never a reported 500 | ✅ automated | `packages/ui/src/server/static-paths.integration.test.ts` (`reportError` is not called) |
| [seo](../suites/seo.md) | Lighthouse targets (Perf ≥95, SEO 100, a11y ≥95, BP 100, CLS 0) | 🔶 | Local Lighthouse 13.4 on built `start` (2026-07-09): desktop unthrottled `/` **99/100/100/100** CLS≈0; `/pricing` **100/100/100/100**; mobile default throttle `/` Perf **58** (FCP/LCP on Slow 4G), A11y/BP/SEO **100**. Re-run PSI on production after deploy. |
| [theme](../suites/theme.md) | `THEME-F1`, `THEME-A1`–`THEME-A2` | `packages/ui/src/components/site/theme-switcher.test.tsx`, `theme-switcher.browser.test.tsx` | Theme persistence, radio keyboard selection, active surface alignment at 32/44/52px targets; visual focus remains manual. |
| [navigation](../suites/navigation.md) | Homepage use-case cards preserve EN/DE/FR routes and open the relevant guide | ✅ | `marketing-content.spec.ts` |
| [navigation](../suites/navigation.md) | Interactive preview navigation waits for the client commit under delayed route loading, across prerendered and empty roots; redirects cannot admit unmarked readiness | ✅ automated | `client-page.spec.ts`, `helpers/client-page.ts`; intentional cold-start coverage stays in `scroll-stability.spec.ts` |
| [accessibility](../suites/accessibility.md) | All connector names remain visible without fake controls; changing reduced motion reveals complete scenes without reloading | ✅ | `motion-and-connectors.spec.ts`, `packages/marketing-ui/src/components/demos/use-demo-timeline.test.tsx`, `packages/marketing-ui/src/components/marketing/reveal.test.tsx` |
| [theme](../suites/theme.md) | `THEME-F2`–`THEME-F6`, `THEME-B1`, `THEME-A3` | ⛔ manual-only | — |

## Seams

- **The Playwright suite drives the same origin a round does.** Never run
  `bun run test:e2e` beside a round: it signs in, creates and deletes data, and
  leaves the stack in its end state.
- **The vitest lanes (`test`, `test:ui`, `test:browser`) boot and tear down
  their own stack**, so they are safe beside a round.

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; `bun run lint:manual` rejects a box ID here that no
suite defines.

### Optional error reporting

`packages/ui/src/monitoring/{config,browser}.test.ts` uses the real browser SDK
and checks runtime configuration, envelope redaction and the disabled default.
`packages/ui/src/server/monitoring.integration.test.ts` starts the real Bun
server and a local receiver; it checks escaped runtime HTML, strict CSP, HTTP
error receipt and zero report traffic when disabled.

| [navigation](../suites/navigation.md) | Homepage has a split task-board hero, three chapters and three capability cards; every module destination works; connector names remain readable; motion preference changes complete mounted demos without replay | ✅ automated | `home-demos.spec.ts`, `motion-and-connectors.spec.ts` |
| [responsive](../suites/responsive.md) | French homepage and agents sandbox illustrations reserve their final height before normal-motion playback at 320px | ✅ automated | `home-demos.spec.ts` |

| Area | Automated coverage | Manual scope |
| --- | --- | --- |
| Unknown localized and nested URLs retain the marketing 404, localized recovery, site chrome and noindex metadata at phone/desktop widths | `tests/e2e/specs/smoke.spec.ts`, `tests/prerender/seo.test.ts` | visual treatment in both themes |
| `/ui` opens Tale UI through HTTP 301, client navigation and static hosting; footer link and shared footnote appear in EN/DE/FR | `lib/redirects.test.ts`, `tests/e2e/specs/smoke.spec.ts`, `tests/prerender/seo.test.ts` | footer spacing |
| Agent roster rows and cells plus the Agents & connectors sandbox geometry stay fixed throughout normal playback at 390/1280px | `tests/e2e/specs/motion-and-connectors.spec.ts` | illustration readability and motion feel |
