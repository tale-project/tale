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
suite (`tests/*.test.ts`) validates links, images, videos, navigation
entries, redirects, locale mirrors, frontmatter, and page structure at build
time, and the Playwright smoke spec
([`tests/e2e/specs/smoke.spec.ts`](../e2e/specs/smoke.spec.ts)) checks the
rendered shell. What **no** automation covers is the reader-facing
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

| Guide                                | Area                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [navigation.md](navigation.md)       | sidebar integrity, breadcrumbs, prev/next, TOC scroll-spy, 404s, moved-page 301s, PWA offline/update     |
| [search.md](search.md)               | search dialog, shortcuts, results, recents, per-locale index, index freshness                            |
| [locale.md](locale.md)               | `/de` + `/fr` trees, `de-CH` overlay, language switcher, translated chrome                               |
| [content.md](content.md)             | code blocks + copy buttons, heading deep links, markdown components, images + zoom, videos, page actions |
| [seo.md](seo.md)                     | prerendered head, JSON-LD, sitemap, robots, llms + `.md` endpoints, security headers, legal noindex, OG  |
| [accessibility.md](accessibility.md) | cross-cutting WCAG 2.1 AA sweep (theme, image zoom, video player, PWA banner)                            |

## Coverage matrix

Status reflects the **area** as a whole; each guide's own _Automated coverage_
table is case-by-case. "vitest content suite" = the static corpus checks (21
files under `tests/*.test.ts`, plus `tests/prerender/seo.test.ts` and the
`lib/seo/*.test.ts` trio) — they prove the **source** is well-formed, not that
the **rendered site** behaves.

| Guide         | Status         | Automated by                                                                                                                                                                                                                                                                                               |
| ------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| navigation    | 🔶 partial     | `smoke.spec.ts` (sidebar links render) + vitest `navigation.test.ts` (every nav entry resolves to a page) + `redirects.test.ts` (redirect-map contract; served 301s/stubs manual); PWA offline/update banner manual                                                                                        |
| search        | 🔶 partial     | `smoke.spec.ts` (palette opens) + `app/features/search/dialog.test.tsx` + `content-manifest.test.ts` (index inputs); ranking/recents/locale index/freshness manual                                                                                                                                         |
| locale        | 🔶 partial     | vitest `locale-tree.test.ts` + `locale-outline.test.ts` + `locale-components.test.ts` + `locale-translation.test.ts` + `docs.test.ts` + `readme.test.ts` (mirrors exist and are real translations, same components, voice rules); rendered chrome + `de-CH` overlay manual                                 |
| content       | 🔶 partial     | vitest `links.test.ts`, `images.test.ts` + `image-manifest.test.ts` (assets + manifest + DPR contract), `videos.test.ts` (video/caption/poster sets per locale), `structure-{opening,headings,code,prose,closing}.test.ts`, `frontmatter.test.ts`, `filenames.test.ts`, `walk.test.ts` (source-level only) |
| seo           | 🔶 partial     | `tests/prerender/seo.test.ts` (titles/canonical/JSON-LD/404) + `lib/seo/{build,dev-server,deploy-sim}.test.ts` + `packages/ui/src/server/security-headers.test.ts`; served headers + endpoints manual                                                                                                      |
| accessibility | ⛔ manual-only | — (no axe layer in this service's e2e; shared `@tale/ui` components — incl. `ImageZoom`, `Video`, tabs, callouts — carry `vitest-axe`)                                                                                                                                                                     |
