# Manual test plans (AI-directed) — marketing site

Modular, codebase-grounded test playbooks for the Tale **marketing site**
(`https://tale.dev`), written so either a human QA tester or an AI agent
driving a browser can execute them against a running instance (or the live
site). One guide per area; each lists concrete test cases (functional,
boundary/error, accessibility, performance), cross-references the automated
Playwright specs that already cover each case, and carries an
**Issues Found** table for collecting defects.

These are manual / exploratory / accessibility passes — **not** the automated
suites. The Playwright e2e specs live in
[`tests/e2e/specs/`](../e2e/specs/); the vitest i18n
suite in `lib/i18n/messages.test.ts`. The platform app has its own, much larger
guide set in
[`services/platform/tests/manual/`](../../../platform/tests/manual/README.md);
new guides here copy its
[TEMPLATE.md](../../../platform/tests/manual/TEMPLATE.md) (which documents the
authoring conventions).

## How to use

1. Bring the site up (or pick the live site) via [SETUP.md](SETUP.md), then run
   its smoke checklist (every page loads).
2. Run [navigation.md](navigation.md) first, then the rest in any order.
3. **Never deliver a test submission through the live forms** — the
   honeypot-probe rule in [forms.md](forms.md) exists so a full pass doesn't
   spam the team's Discord.
4. For each defect, add a row to that guide's **Issues Found** table (test id,
   route, severity, description, screenshot).
5. Finish with [accessibility.md](accessibility.md) and
   [responsive.md](responsive.md) as cross-cutting sweeps.

## Guides

| Guide                                  | Area                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [navigation.md](navigation.md)         | page inventory, header/footer nav, legal pages, changelog timeline, 404s    |
| [platform-pages.md](platform-pages.md) | the `/platform` hub + six module pages, demo scenes/tours, `/changelog`     |
| [forms.md](forms.md)                   | contact + request-demo forms end-to-end, incl. the Discord delivery path    |
| [locale.md](locale.md)                 | locale switching, `/de` + `/fr` trees, translated content                   |
| [seo.md](seo.md)                       | prerendered titles/canonicals, JSON-LD, security headers, sitemap, llms.txt |
| [theme.md](theme.md)                   | light/dark/system switching, persistence, no-flash, themed demo scenes      |
| [responsive.md](responsive.md)         | mobile menu, narrow viewports, no-overflow                                  |
| [accessibility.md](accessibility.md)   | cross-cutting WCAG 2.1 AA sweep                                             |

## Coverage matrix

The automated e2e layer is **three spec files with 22 test blocks**:
`smoke.spec.ts` (9 — every one of the 13 marketing paths renders via one
parameterized block, header nav + CTAs, both forms render their submit
button, de/fr routes, not-found recovery, heading order on `/platform` +
`/pricing`), `home-demos.spec.ts` (11 — demo end states under reduced motion
on `/` and every platform page), and `changelog.spec.ts` (2 — sticky
timeline + `aria-current`). Build-time vitest suites cover prerendered SEO
(`tests/prerender/seo.test.ts`) and i18n key parity
(`lib/i18n/messages.test.ts`). Everything deeper is manual. Status reflects
the **area** as a whole; each guide's own _Automated coverage_ table is
case-by-case.

| Guide          | Status         | Automated by                                                                                                                                                            |
| -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| navigation     | 🔶 partial     | `smoke.spec.ts` (all paths render, header nav, CTAs, not-found) + `changelog.spec.ts` (timeline)                                                                        |
| platform-pages | 🔶 partial     | `smoke.spec.ts` (renders + heading order) + `home-demos.spec.ts` (per-page demo stories) + `changelog.spec.ts`                                                          |
| forms          | 🔶 partial     | `smoke.spec.ts` (`/contact` + `/request-demo` render a form + submit button — **no submit path**)                                                                       |
| locale         | 🔶 partial     | `smoke.spec.ts` (`/de`, `/de/platform`, `/de/pricing`, `/fr/changelog`, `/fr/contact`) + vitest key parity                                                              |
| seo            | 🔶 partial     | vitest `tests/prerender/seo.test.ts` (h1/lang/canonical) + `services/platform/tests/integration/container-web-test.ts` (HTTP probes) — artifacts/JSON-LD/headers manual |
| theme          | ⛔ manual-only | —                                                                                                                                                                       |
| responsive     | ⛔ manual-only | — (all specs run desktop viewports)                                                                                                                                     |
| accessibility  | 🔶 partial     | `smoke.spec.ts` (heading order) + `home-demos.spec.ts` (reduced motion, demo accessible names) — no axe layer                                                           |
