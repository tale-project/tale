# SEO & prerendered head — Manual Test Plan

> **Purpose**: Verify the SEO surface the build pipeline produces — prerendered
> per-page/per-locale `<title>`, meta description, canonical, and social tags
> (`scripts/prerender.ts` + `useDocumentMeta`, site origin `https://tale.dev`),
> the `dist-seo` artifacts (`sitemap.xml`, `robots.txt`, `llms.txt`,
> `llms-full.txt`), and the noindex rule on legal pages. These checks read the
> **served HTML** (curl / view-source), not the hydrated DOM.

## Scope & routes

| Surface         | Route                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Marketing pages | All `MARKETING_ROUTE_URLS` (home, pricing, platform/\*, changelog, contact, request-demo, hardware-pricing) × `/de`, `/fr` |
| Legal pages     | `/legal/{slug}` (× locales) — **noindex**, excluded from sitemap                                                           |
| 404             | `/404` — **noindex**, HTTP 404 when served from dist                                                                       |
| Sitemap         | `/sitemap.xml`                                                                                                             |
| Robots          | `/robots.txt`                                                                                                              |
| LLM artifacts   | `/llms.txt`, `/llms-full.txt`                                                                                              |
| OG card         | `/og.png` (1200×630)                                                                                                       |

## Prerequisites

Mode A (live) or mode B (local **build** + `bun run --filter @tale/web start`)
per [SETUP.md](SETUP.md) — the vite dev server serves the unbuilt `index.html`
head (fallback title) and none of the artifacts, so mode C proves nothing
here.

> **Agent note**: this guide is mostly `curl`-driven; a browser is only needed
> for F7. Expected title/description strings resolve from the `seo.*`
> namespace in `messages/{locale}.json`; the prerenderer appends the
> `&nbsp;| Tale` brand suffix. Prefer question-shaped titles that match the
> visible H1 (e.g. `<title>How much does Tale cost? — Community &amp; Enterprise | Tale</title>`).

## Automated coverage

| Case(s)                                                         | Status | Spec                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-route h1 / lang / canonical                                 | ✅     | `tests/prerender/seo.test.ts` (`bun run --filter @tale/web test:prerender`, dependsOn build)                                                                                                                                                                     |
| Registry bijection                                              | ✅     | `lib/seo/marketing-routes.test.ts`                                                                                                                                                                                                                               |
| Image budgets                                                   | ✅     | `tests/images.test.ts`                                                                                                                                                                                                                                           |
| Container HTTP probes                                           | ✅     | `services/platform/tests/connector/container-web-test.ts` (`/nope`→404, `/pricing`, `/de/pricing`, sitemap, og.png)                                                                                                                                              |
| Lighthouse targets (Perf ≥95, SEO 100, A11y ≥95, BP 100, CLS 0) | 🔶     | Local Lighthouse 13.4 on built `start` (2026-07-09): desktop unthrottled `/` **99/100/100/100** CLS≈0; `/pricing` **100/100/100/100**; mobile default throttle `/` Perf **58** (FCP/LCP on Slow 4G), A11y/BP/SEO **100**. Re-run PSI on production after deploy. |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                   | Steps                                                                                      | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Prerendered titles     | `curl -s {base}/{page}` for every marketing page; grep `<title>`                           | Each serves its own `seo.{page}.title` + ` \| Tale` **in the raw HTML** (home: **Tale: The Orchestrator for AI Agents**; `/pricing`: **How much does Tale cost? — Community & Enterprise \| Tale**; `/contact`: **Contact us \| Tale**; `/request-demo`: **Request a demo \| Tale**; `/hardware-pricing`: **What does Tale AI hardware cost? \| Tale**; `/changelog`: **What's new in Tale? — Changelog \| Tale**) |
| F2  | Meta description + OG  | Same fetches; grep `meta name="description"`, `og:title`, `og:description`, `twitter:card` | Description matches `seo.{page}.description`; `og:*`/`twitter:*` mirror title + description; `og:site_name` = **Tale**                                                                                                                                                                                                                                                                                             |
| F3  | Canonical per locale   | `curl -s {base}/pricing` and `{base}/de/pricing`; grep `rel="canonical"`                   | `https://tale.dev/pricing` and `https://tale.dev/de/pricing` respectively — each locale page is its own canonical; `<html lang>` is `en` / `de` in the raw HTML                                                                                                                                                                                                                                                    |
| F4  | Localized titles       | `curl -s {base}/de/pricing`; grep `<title>`                                                | The German title from `messages/de.json` `seo.pricing.title` (question-shaped, matching the DE H1) + ` \| Tale` — prerendering is per locale, not English-only                                                                                                                                                                                                                                                     |
| F5  | Sitemap                | `curl -s {base}/sitemap.xml`                                                               | Lists every marketing page (en + localised variants) with `xhtml:link rel="alternate" hreflang` for `en`/`de`/`fr`/`x-default`; **legal pages are excluded** (they are `noindex` and live only in robots.disallow + llms.txt); no unknown or dead URLs (spot-check a few return the right page)                                                                                                                    |
| F6  | Robots + LLM artifacts | `curl -s {base}/robots.txt`, `/llms.txt`, `/llms-full.txt`                                 | robots: `Allow: /`, `Disallow: /api/`, `Disallow: /_search/`, **`Disallow:` for every legal URL** (e.g. `/legal/privacy-policy`, `/de/legal/…`), and **two** sitemap lines (`https://tale.dev/sitemap.xml` + `https://tale.dev/docs/sitemap.xml`); both llms files serve plaintext markdown summaries (HTTP 200, non-empty)                                                                                        |
| F7  | Content pre-JS         | View-source of `/` (or curl) — do not execute JS                                           | The hero heading from `home.hero.title` (**Orchestrate every AI agent on your stack**) is present in the served HTML — the page is meaningful to crawlers without hydration                                                                                                                                                                                                                                        |
| F8  | Legal noindex          | `curl -s {base}/legal/privacy-policy`; grep `robots`                                       | `<meta name="robots" content="noindex,nofollow">` present on legal pages; **absent** on marketing pages                                                                                                                                                                                                                                                                                                            |

## Boundary & error tests

| ID  | Test           | Input                                                            | Expected                                                                                                                                                                                                                                                    |
| --- | -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Real 404       | `curl -s -o /dev/null -w '%{http_code}' {base}/nope-not-a-route` | **HTTP 404** with `dist/404/index.html` (`noindex`) when served from the built static server / container — asserted by `container-web-test` probe `/nope`. Dev SPA may still soft-route; prove against `bun run --filter @tale/web start` or the container. |
| B2  | Trailing slash | `curl -sI {base}/pricing/`                                       | Resolves to the same page (no duplicate-content split: either serves identical canonical `https://tale.dev/pricing` or redirects); record which                                                                                                             |

## Accessibility (WCAG 2.1 AA)

| ID  | Check       | Expected                                                                                          |
| --- | ----------- | ------------------------------------------------------------------------------------------------- |
| A1  | Page titles | Every page's `<title>` is unique and describes the page (WCAG 2.4.2) — F1/F4 double as this check |

## Performance

| ID  | Metric     | Target                                                                             |
| --- | ---------- | ---------------------------------------------------------------------------------- |
| P1  | First byte | `curl -w '%{time_starttransfer}'` on `/` **< 1 s** (static prerendered file serve) |

## Issues Found

| #   | Test ID | Route / URL                         | Severity (crit/high/med/low) | Description                                                                                                                                                                                                                                                        | Screenshot |
| --- | ------- | ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | B1      | `https://tale.dev/nope-not-a-route` | med                          | Soft 404 was live on 2026-07-06. Fixed in branch: prerendered `/404` + shared server serves HTTP 404 when `dist/404/index.html` exists. Re-verify on next production deploy; docs site parity tracked in [#2620](https://github.com/tale-project/tale/issues/2620) | —          |

## Test summary

```
Area: SEO & prerendered head (web)
Functional: ___/8   Boundary: ___/2   A11y: ___/1   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
