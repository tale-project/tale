# SEO & prerendered head — Manual Test Plan

> **Purpose**: Verify the SEO surface the build pipeline produces — prerendered
> per-page/per-locale `<title>`, meta description, canonical, and social tags
> (`scripts/prerender.ts` + `useDocumentMeta`, site origin `https://tale.dev`),
> the `dist-seo` artifacts (`sitemap.xml`, `robots.txt`, `llms.txt`,
> `llms-full.txt`), and the noindex rule on legal pages. These checks read the
> **served HTML** (curl / view-source), not the hydrated DOM.

## Scope & routes

| Surface         | Route                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| Marketing pages | `/`, `/pricing`, `/hardware-pricing`, `/contact`, `/request-demo` (× `/de`, `/fr`) |
| Legal pages     | `/legal/{slug}` (× locales) — **noindex**                                          |
| Sitemap         | `/sitemap.xml`                                                                     |
| Robots          | `/robots.txt`                                                                      |
| LLM artifacts   | `/llms.txt`, `/llms-full.txt`                                                      |

## Prerequisites

Mode A (live) or mode B (local **build** + `bun run --filter @tale/web start`)
per [SETUP.md](SETUP.md) — the vite dev server serves the unbuilt `index.html`
head (fallback title) and none of the artifacts, so mode C proves nothing
here.

> **Agent note**: this guide is mostly `curl`-driven; a browser is only needed
> for F7. Expected title/description strings resolve from the `seo.*`
> namespace in `messages/{locale}.json`; the prerenderer appends the
> `&nbsp;| Tale` brand suffix (e.g. `<title>Pricing | Tale</title>`).

## Automated coverage

| Case(s)      | Status         | e2e spec                                              |
| ------------ | -------------- | ----------------------------------------------------- |
| F1–F7, B1–B2 | ⛔ manual-only | — (no spec reads the prerendered output or artifacts) |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                   | Steps                                                                                      | Expected (verifiable)                                                                                                                                                                                                                                                                         |
| --- | ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Prerendered titles     | `curl -s {base}/{page}` for every marketing page; grep `<title>`                           | Each serves its own `seo.{page}.title` + ` \| Tale` **in the raw HTML** (home: **Tale: The Orchestrator for AI Agents**; `/pricing`: **Pricing \| Tale**; `/contact`: **Contact us \| Tale**; `/request-demo`: **Request a demo \| Tale**; `/hardware-pricing`: **Hardware Pricing \| Tale**) |
| F2  | Meta description + OG  | Same fetches; grep `meta name="description"`, `og:title`, `og:description`, `twitter:card` | Description matches `seo.{page}.description`; `og:*`/`twitter:*` mirror title + description; `og:site_name` = **Tale**                                                                                                                                                                        |
| F3  | Canonical per locale   | `curl -s {base}/pricing` and `{base}/de/pricing`; grep `rel="canonical"`                   | `https://tale.dev/pricing` and `https://tale.dev/de/pricing` respectively — each locale page is its own canonical; `<html lang>` is `en` / `de` in the raw HTML                                                                                                                               |
| F4  | Localized titles       | `curl -s {base}/de/pricing`; grep `<title>`                                                | The German title from `messages/de.json` `seo.pricing.title` (live: **Preise \| Tale**) — prerendering is per locale, not English-only                                                                                                                                                        |
| F5  | Sitemap                | `curl -s {base}/sitemap.xml`                                                               | Lists every marketing page and legal page; legal URLs carry `xhtml:link rel="alternate" hreflang` entries for `en`/`de`/`fr`/`x-default`; no unknown or dead URLs (spot-check a few return the right page)                                                                                    |
| F6  | Robots + LLM artifacts | `curl -s {base}/robots.txt`, `/llms.txt`, `/llms-full.txt`                                 | robots: `Allow: /`, `Disallow: /api/`, `Disallow: /_search/`, and **two** sitemap lines (`https://tale.dev/sitemap.xml` + `https://tale.dev/docs/sitemap.xml`); both llms files serve plaintext markdown summaries (HTTP 200, non-empty)                                                      |
| F7  | Content pre-JS         | View-source of `/` (or curl) — do not execute JS                                           | The hero heading text (**The Orchestrator for AI Agents**) is present in the served HTML — the page is meaningful to crawlers without hydration                                                                                                                                               |
| F8  | Legal noindex          | `curl -s {base}/legal/privacy-policy`; grep `robots`                                       | `<meta name="robots" content="noindex,nofollow">` present on legal pages; **absent** on marketing pages                                                                                                                                                                                       |

## Boundary & error tests

| ID  | Test           | Input                                                            | Expected                                                                                                                                                                                                                                                                               |
| --- | -------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Soft 404       | `curl -s -o /dev/null -w '%{http_code}' {base}/nope-not-a-route` | **Known gap**: the SPA fallback serves the shell with HTTP **200** and the generic fallback head — an unknown URL is indistinguishable from a page to crawlers. Record the status + served title; a real 404 status (or at least `noindex` on the not-found view) is the desired state |
| B2  | Trailing slash | `curl -sI {base}/pricing/`                                       | Resolves to the same page (no duplicate-content split: either serves identical canonical `https://tale.dev/pricing` or redirects); record which                                                                                                                                        |

## Accessibility (WCAG 2.1 AA)

| ID  | Check       | Expected                                                                                          |
| --- | ----------- | ------------------------------------------------------------------------------------------------- |
| A1  | Page titles | Every page's `<title>` is unique and describes the page (WCAG 2.4.2) — F1/F4 double as this check |

## Performance

| ID  | Metric     | Target                                                                             |
| --- | ---------- | ---------------------------------------------------------------------------------- |
| P1  | First byte | `curl -w '%{time_starttransfer}'` on `/` **< 1 s** (static prerendered file serve) |

## Issues Found

| #   | Test ID | Route / URL                         | Severity (crit/high/med/low) | Description                                                                                                                                                                                                             | Screenshot |
| --- | ------- | ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | B1      | `https://tale.dev/nope-not-a-route` | med                          | Soft 404 confirmed live (2026-07-06): unknown URLs return HTTP **200** with the home shell (client then redirects to `/`) — crawlers can index garbage URLs as duplicates of the home page; no 404 status, no `noindex` | —          |

## Test summary

```
Area: SEO & prerendered head (web)
Functional: ___/8   Boundary: ___/2   A11y: ___/1   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
