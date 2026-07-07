# Manual test plans (AI-directed) — marketing site

Modular, codebase-grounded test playbooks for the Tale **marketing site**
(`https://tale.dev`), written so either a human QA tester or an AI agent
driving a browser can execute them against a running instance (or the live
site). One guide per area; each lists concrete test cases (functional,
boundary/error, accessibility, performance), cross-references the automated
Playwright smoke spec that already covers each case, and carries an
**Issues Found** table for collecting defects.

These are manual / exploratory / accessibility passes — **not** the automated
suites. The Playwright smoke suite lives in
[`tests/e2e/specs/smoke.spec.ts`](../e2e/specs/smoke.spec.ts); the vitest i18n
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

| Guide                                | Area                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| [navigation.md](navigation.md)       | page inventory, header/footer nav, legal pages, hash links, 404s         |
| [forms.md](forms.md)                 | contact + request-demo forms end-to-end, incl. the Discord delivery path |
| [locale.md](locale.md)               | locale switching, `/de` + `/fr` trees, translated content                |
| [seo.md](seo.md)                     | prerendered titles/canonicals, sitemap, robots, llms.txt, noindex        |
| [theme.md](theme.md)                 | light/dark/system switching, persistence, no-flash, themed imagery       |
| [responsive.md](responsive.md)       | mobile menu, narrow viewports, no-overflow                               |
| [accessibility.md](accessibility.md) | cross-cutting WCAG 2.1 AA sweep                                          |

## Coverage matrix

The automated suite is a smoke layer only — four tests. Everything deeper is
manual. Status reflects the **area** as a whole; each guide's own _Automated
coverage_ table is case-by-case.

| Guide         | Status         | Automated by                                                                      |
| ------------- | -------------- | --------------------------------------------------------------------------------- |
| navigation    | 🔶 partial     | `smoke.spec.ts` (home renders + pricing nav link + no console errors; `/pricing`) |
| forms         | 🔶 partial     | `smoke.spec.ts` (`/contact` renders a form + submit button — **no submit path**)  |
| locale        | 🔶 partial     | `smoke.spec.ts` (`/de` renders) + vitest `lib/i18n/messages.test.ts` (key parity) |
| seo           | ⛔ manual-only | — (prerender/artifact output has no spec)                                         |
| theme         | ⛔ manual-only | —                                                                                 |
| responsive    | ⛔ manual-only | —                                                                                 |
| accessibility | ⛔ manual-only | — (no axe layer in this service's e2e)                                            |
