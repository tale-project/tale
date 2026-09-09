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
| [accessibility](../suites/accessibility.md) | Layer / case | Status | Where |
| [accessibility](../suites/accessibility.md) | Per-component axe (WCAG 2.1 AA) | ✅ automated | `@tale/ui` component tests (`checkAccessibility()` via `vitest-axe`) + Storybook a11y addon |
| [accessibility](../suites/accessibility.md) | `A11Y-A3` on `/platform` + `/pricing` | ✅ automated | `smoke.spec.ts` (single `h1`, no skipped levels in `main`) |
| [accessibility](../suites/accessibility.md) | `A11Y-A7` (demo end states under reduced motion) | 🔶 partial | `home-demos.spec.ts` (whole suite runs with `reducedMotion: 'reduce'` and asserts complete end states — not the scroll/fade behaviour) |
| [accessibility](../suites/accessibility.md) | `A11Y-A8` (demo accessible names) | 🔶 partial | `home-demos.spec.ts` (locates every demo by `getByRole('img', { name: … })`) |
| [accessibility](../suites/accessibility.md) | `A11Y-A1`–`A11Y-A2`, `A11Y-A4`–`A11Y-A6`, `A11Y-B1`–`A11Y-B2` | ⛔ manual-only | — this guide |
| [forms](../suites/forms.md) | `FORM-F1`, `FORM-F3` (render only) | 🔶 partial | `smoke.spec.ts` (`/contact` and `/request-demo` each render a form + their submit button by label) |
| [forms](../suites/forms.md) | `FORM-F2`, `FORM-F4`–`FORM-F6`, `FORM-B1`–`FORM-B10` | ⛔ manual-only | — (no spec drives a submit; the endpoint itself has no test) |
| [locale](../suites/locale.md) | `LOC-F2` (render only) | 🔶 partial | `smoke.spec.ts` (`/de`, `/de/platform`, `/de/pricing` render) |
| [locale](../suites/locale.md) | `LOC-F3` (render only) | 🔶 partial | `smoke.spec.ts` (`/fr/changelog`, `/fr/contact` render) |
| [locale](../suites/locale.md) | — | ✅ automated | vitest `lib/i18n/messages.test.ts` (locale files stay key-compatible) |
| [locale](../suites/locale.md) | `LOC-F1`, `LOC-F4`–`LOC-F8`, `LOC-B1`–`LOC-B2` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-F1` | 🔶 partial | `smoke.spec.ts` (home renders; Platform / Resources triggers + Pricing link; Platform menu opens and lists **Chat**) |
| [navigation](../suites/navigation.md) | `NAV-F2` | 🔶 partial | `smoke.spec.ts` (header **Get started** visible; no header **Request a demo** — no click-through) |
| [navigation](../suites/navigation.md) | `NAV-F9` | 🔶 partial | `smoke.spec.ts` (`/pricing` renders + heading-order check — no control interaction) |
| [navigation](../suites/navigation.md) | `NAV-F12` | 🔶 partial | `changelog.spec.ts` (sticky timeline reachability + `aria-current` on click) |
| [navigation](../suites/navigation.md) | `NAV-B1` | 🔶 partial | `smoke.spec.ts` (`/nope-not-a-route` shows the not-found heading + **Back to the homepage** — SPA nav, not the HTTP status) |
| [navigation](../suites/navigation.md) | `NAV-F3`–`NAV-F8`, `NAV-F10`–`NAV-F11` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-B2`–`NAV-B4` | ⛔ manual-only | — |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F1`–`PAGE-F2` | 🔶 partial | `home-demos.spec.ts` (hub samples each module story; tour stages deep-link) + `smoke.spec.ts` (renders) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F4` | 🔶 partial | `smoke.spec.ts` (each module page renders; heading order on `/platform`) — section stack not asserted |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F5`–`PAGE-F9` | 🔶 partial | `home-demos.spec.ts` (per-page demo stories under reduced motion, distinct from the homepage scenarios) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F11` | 🔶 partial | `changelog.spec.ts` (sticky timeline reachability + `aria-current` on click) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-A1` | 🔶 partial | `smoke.spec.ts` (single `h1` / no skipped levels — `/platform` and `/pricing` only) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-A2` | 🔶 partial | `home-demos.spec.ts` (every demo located by `role="img"` accessible name) |
| [platform-pages](../suites/platform-pages.md) | `PAGE-F3`, `PAGE-F10`, `PAGE-F12`, `PAGE-B1`–`PAGE-B2`, `PAGE-A3`, `PAGE-P1`–`PAGE-P2` | ⛔ manual-only | — |
| [responsive](../suites/responsive.md) | `RESP-F1`–`RESP-F5`, `RESP-B1`–`RESP-B2`, `RESP-A1`–`RESP-A2`, `RESP-P1` | ⛔ manual-only | — (`smoke.spec.ts` runs desktop-viewport only) |
| [seo](../suites/seo.md) | Per-route h1 / lang / canonical | ✅ | `tests/prerender/seo.test.ts` (`bun run --filter @tale/web test:prerender`, dependsOn build) |
| [seo](../suites/seo.md) | Registry bijection | ✅ | `lib/seo/marketing-routes.test.ts` |
| [seo](../suites/seo.md) | Image budgets | ✅ | `tests/images.test.ts` |
| [seo](../suites/seo.md) | Container HTTP probes | ✅ | `services/platform/tests/integration/container-web-test.ts` (`/nope`→404, `/pricing`, `/de/pricing`, sitemap, og.png) |
| [seo](../suites/seo.md) | Lighthouse targets (Perf ≥95, SEO 100, a11y ≥95, BP 100, CLS 0) | 🔶 | Local Lighthouse 13.4 on built `start` (2026-07-09): desktop unthrottled `/` **99/100/100/100** CLS≈0; `/pricing` **100/100/100/100**; mobile default throttle `/` Perf **58** (FCP/LCP on Slow 4G), A11y/BP/SEO **100**. Re-run PSI on production after deploy. |
| [theme](../suites/theme.md) | `THEME-F1`–`THEME-F6`, `THEME-B1`, `THEME-A1`–`THEME-A3` | ⛔ manual-only | — |

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
