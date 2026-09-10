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
| [accessibility](../suites/accessibility.md) | Layer | Status | Where |
| [accessibility](../suites/accessibility.md) | Per-component axe (WCAG 2.1 AA) | ✅ automated | `@tale/ui` component tests (`checkAccessibility()` via `vitest-axe`) + Storybook a11y addon |
| [accessibility](../suites/accessibility.md) | Source heading hierarchy | ✅ automated | vitest `structure-headings.test.ts` (per-page heading rules in the corpus) |
| [accessibility](../suites/accessibility.md) | Full-page audits (`A11Y-A1`–`A11Y-A11`) | ⛔ manual-only | — this guide (the shared `ImageZoom`/`Video` components carry `vitest-axe` in `@tale/ui`) |
| [content](../suites/content.md) | `CONT-F1` (source shape) | ✅ automated | vitest `structure-code.test.ts` (every fence declares a language), `structure-headings.test.ts`, `links.test.ts` |
| [content](../suites/content.md) | `CONT-F15`–`CONT-F16` (image sources) | 🔶 partial | vitest `images.test.ts` (paths resolve, alt text, size) + `image-manifest.test.ts` (manifest entry, page reference, DPR-2 dimensions) — rendered behaviour manual |
| [content](../suites/content.md) | `CONT-F17`–`CONT-F18` (video sources) | 🔶 partial | vitest `videos.test.ts` (manifest ↔ disk parity, all-locales-or-none per episode, embed src/poster/captions resolve + match page locale, size budgets, well-formed WebVTT) |
| [content](../suites/content.md) | `CONT-F9`–`CONT-F14` (component tags mirrored) | 🔶 partial | vitest `locale-components.test.ts` (DE/FR mirrors use the same component tags in the same order) — rendering manual |
| [content](../suites/content.md) | `CONT-F1`–`CONT-F18` (rendered), `CONT-B1`–`CONT-B3` | ⛔ manual-only | — (the header regression renders content pages but does not judge their body components) |
| [locale](../suites/locale.md) | `LOC-F2` (mirror exists) | ✅ automated | vitest `locale-tree.test.ts` (every EN page has DE/FR mirrors) + `locale-outline.test.ts` (same outline) + `docs.test.ts` (voice/terminology) |
| [locale](../suites/locale.md) | `LOC-F5` (dialog parity) | 🔶 partial | vitest `locale-components.test.ts` + `locale-translation.test.ts` (mirrors are real translations, same component tags) — rendered chrome manual |
| [locale](../suites/locale.md) | `LOC-F1`, `LOC-F3`–`LOC-F7`, `LOC-B1`–`LOC-B2` | 🔶 partial | `page-header.spec.ts` checks EN/DE/FR breadcrumb and action labels; switcher, full-page locale behavior and unknown routes remain manual |
| [navigation](../suites/navigation.md) | `NAV-F1` | 🔶 partial | `smoke.spec.ts` (sidebar shows links) + vitest `navigation.test.ts` (entries resolve) |
| [navigation](../suites/navigation.md) | `NAV-F4`, `NAV-A3` (breadcrumb trail) | 🔶 partial | `page-header.spec.ts` checks translated groups, one current leaf and home targets; landing-page omission and navigating ancestors remain manual |
| [navigation](../suites/navigation.md) | Page header at 375 px and 1440 px | ✅ automated | `page-header.spec.ts` checks non-overlapping phone actions, desktop row alignment, viewport containment and Escape/focus restoration in EN/DE/FR |
| [navigation](../suites/navigation.md) | `NAV-F9`–`NAV-F10` (source map) | 🔶 partial | vitest `redirects.test.ts` (slug shape, every target exists in every locale, no source shadows a page, no chains) — the **served** 301s/stubs manual |
| [navigation](../suites/navigation.md) | `NAV-F2`–`NAV-F3`, `NAV-F5`–`NAV-F8`, `NAV-F11`–`NAV-F12`, `NAV-B1`–`NAV-B3` | ⛔ manual-only | — |
| [search](../suites/search.md) | `SEARCH-F1` | ✅ automated | `smoke.spec.ts` (open via header button → placeholder input visible) |
| [search](../suites/search.md) | `SEARCH-F2`–`SEARCH-F6` | 🔶 partial | component `app/features/search/dialog.test.tsx` (wiring); real index + navigation manual |
| [search](../suites/search.md) | `SEARCH-F7` | 🔶 partial | vitest `redirects.test.ts` (no redirect source is still a page) — index content manual |
| [search](../suites/search.md) | `SEARCH-B1`–`SEARCH-B3`, `SEARCH-A1`–`SEARCH-A3`, `SEARCH-P1` | ⛔ manual-only | — |
| [seo](../suites/seo.md) | Per-route h1 / lang / canonical / JSON-LD / 404 | ✅ | `tests/prerender/seo.test.ts` (`bun run --filter @tale/docs test:prerender`, dependsOn build) |
| [seo](../suites/seo.md) | Sitemap exclusion + cross-sitemap robots | ✅ | `lib/seo/build.test.ts`, `lib/seo/dev-server.test.ts` |
| [seo](../suites/seo.md) | Precompiled artifact server | ✅ | `lib/seo/deploy-sim.test.ts` |
| [seo](../suites/seo.md) | Security header values (`SEO-F9`) | 🔶 | `packages/ui/src/server/security-headers.test.ts` (unit) — the served response is manual |

## Seams

The configuration release journey's command behavior belongs to
`tools/cli/tests/config-releases.test.ts`: source and compiled CLI execution,
native pack admission, exact build/verify/stage, local HTTP deployment and replay,
read-only verification, confirmation, identity refusals and redacted errors.
The focused tests under `tools/cli/src/lib/config/releases/` own archive safety,
committed-source reconstruction, historical compatibility and interrupted native
deployment. These synthetic tests do not prove a client's business results or a
live server's compatibility. Docs suites still judge the rendered EN/DE/FR
guide, navigation, code copying and narrow layouts.

Managed deployment commands are covered by `tools/cli/tests/deployment.test.ts`
and `tools/cli/tests/provision.test.ts`: source/compiled command boundaries,
reviewed bundle identity, private stdin, confirmation placement, local native
HTTP replay and scrubbed failure cleanup. Runtime, snapshot and native adapter
fault tests live under `tools/cli/src/lib/deployment/`. These fixtures do not
replace a destination rollout and independent native readback.
`tools/cli/src/lib/deployment/sources.test.ts` additionally parses synthetic
private keys with real OpenSSH after temporary-file materialization: LF, CRLF
and missing final newlines retain the same key identity, with private file
permissions, cleanup and public-runtime credential isolation checked.

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
