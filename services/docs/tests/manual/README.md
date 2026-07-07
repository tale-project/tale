# Manual test plans (AI-directed) — docs site

Modular, codebase-grounded test playbooks for the Tale **documentation site**
(`https://tale.dev/docs`), written so either a human QA tester or an AI agent
driving a browser can execute them against a running instance (or the live
site). One guide per area; each lists concrete test cases (functional,
boundary/error, accessibility, performance), cross-references the automated
test that already covers each case, and carries an **Issues Found** table for
collecting defects.

These are manual / exploratory / accessibility passes — **not** the automated
suites. The docs already have a strong **static** gate: the vitest content
suite (`tests/*.test.ts`) validates links, images, navigation entries, locale
mirrors, frontmatter, and page structure at build time, and the Playwright
smoke spec ([`tests/e2e/specs/smoke.spec.ts`](../e2e/specs/smoke.spec.ts))
checks the rendered shell. What **no** automation covers is the reader-facing
runtime behaviour — search quality, scroll-spy, copy buttons, theme, mobile
drawer — and that is what these guides exercise. The platform app has its own
guide set in
[`services/platform/tests/manual/`](../../../platform/tests/manual/README.md);
new guides here copy its
[TEMPLATE.md](../../../platform/tests/manual/TEMPLATE.md) (which documents the
authoring conventions).

## How to use

1. Bring the site up (or pick the live site) via [SETUP.md](SETUP.md), then
   run its smoke checklist.
2. Run [navigation.md](navigation.md) first, then the rest in any order.
3. For each defect, add a row to that guide's **Issues Found** table (test id,
   route, severity, description, screenshot).
4. Finish with [accessibility.md](accessibility.md) as the cross-cutting
   sweep.

## Guides

| Guide                                | Area                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- |
| [navigation.md](navigation.md)       | sidebar integrity, breadcrumbs, prev/next, TOC scroll-spy, 404s      |
| [search.md](search.md)               | search dialog, shortcuts, results, recents, per-locale index         |
| [locale.md](locale.md)               | `/de` + `/fr` trees, language switcher, translated chrome            |
| [content.md](content.md)             | code blocks + copy buttons, heading deep links, images, page actions |
| [accessibility.md](accessibility.md) | cross-cutting WCAG 2.1 AA sweep (incl. theme switching)              |

## Coverage matrix

Status reflects the **area** as a whole; each guide's own _Automated coverage_
table is case-by-case. "vitest content suite" = the static corpus checks —
they prove the **source** is well-formed, not that the **rendered site**
behaves.

| Guide         | Status         | Automated by                                                                                                          |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| navigation    | 🔶 partial     | `smoke.spec.ts` (sidebar links render) + vitest `navigation.test.ts` (every nav entry resolves to a page)             |
| search        | 🔶 partial     | `smoke.spec.ts` (palette opens) + `app/features/search/dialog.test.tsx`; ranking/recents/locale index manual          |
| locale        | 🔶 partial     | vitest `locale-tree.test.ts` + `locale-outline.test.ts` + `docs.test.ts` (mirrors exist, outlines match, voice rules) |
| content       | 🔶 partial     | vitest `links.test.ts`, `images.test.ts`, `structure-*.test.ts`, `frontmatter.test.ts` (source-level only)            |
| accessibility | ⛔ manual-only | — (no axe layer in this service's e2e; shared `@tale/ui` components carry `vitest-axe`)                               |
