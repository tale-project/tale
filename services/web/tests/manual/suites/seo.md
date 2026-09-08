# SEO & prerendered head

> **Prefix** `SEO-` · **Reset** none · **Cost** 14 boxes

Verify the SEO surface the build pipeline produces — prerendered
per-page/per-locale `<title>`, meta description, canonical, and social tags
(`scripts/prerender.ts` + `useDocumentMeta`, site origin `https://tale.dev`),
the `dist-seo` artifacts (`sitemap.xml`, `robots.txt`, `llms.txt`,
`llms-full.txt`), and the noindex rule on legal pages. These checks read the
**served HTML** (curl / view-source), not the hydrated DOM.

## Scope & routes

| Surface         | Route                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Marketing pages | All `MARKETING_ROUTE_URLS` (home, about, pricing, platform/\*, changelog, contact, request-demo, hardware-pricing) × `/de`, `/fr` |
| Legal pages     | `/legal/{slug}` (× locales) — **noindex**, excluded from sitemap                                                           |
| 404             | `/404` — **noindex**, HTTP 404 when served from dist                                                                       |
| Sitemap         | `/sitemap.xml`                                                                                                             |
| Robots          | `/robots.txt`                                                                                                              |
| LLM artifacts   | `/llms.txt`, `/llms-full.txt`                                                                                              |
| OG card         | `/og.png` (1200×630)                                                                                                       |

## Preconditions

Mode A (live) or mode B (local **build** + `bun run --filter @tale/web start`)
per [SETUP.md](../setup.md) — the vite dev server serves the unbuilt
`index.html` head (fallback title) and none of the artifacts, so mode C proves
nothing here.

> **Agent note**: this guide is mostly `curl`-driven; a browser is only needed
> for SEO-F7. Expected title/description strings resolve from the `seo.*`
> namespace in `messages/{locale}.yml`; the prerenderer appends the `&nbsp;|
> Tale` brand suffix. Prefer question-shaped titles that match the visible H1
> (e.g. `<title>How much does Tale cost? — Community &amp; Enterprise |
> Tale</title>`).

## Functional tests

- [ ] `SEO-F1` · **Prerendered titles** — `curl -s {base}/{page}` for every
  marketing page; grep `<title>` · Each serves its own `seo.{page}.title` + `
  \ · Tale` **in the raw HTML** (home: **Tale: The Orchestrator for AI
  Agents**; `/pricing`: **How much does Tale cost? — Community & Enterprise \
  · Tale**; `/contact`: **Contact us \ · Tale**; `/request-demo`: **Request a
  demo \ · Tale**; `/hardware-pricing`: **What does Tale AI hardware cost? \ ·
  Tale**; `/changelog`: **What's new in Tale? — Changelog \ · Tale**;
  `/about`: **Who is behind Tale? — About Ruler GmbH \ → Tale**)
- [ ] `SEO-F2` · **Meta description + OG** — Same fetches; grep `meta
  name="description"`, `og:title`, `og:description`, `twitter:card` →
  Description matches `seo.{page}.description`; `og:*`/`twitter:*` mirror
  title + description; `og:site_name` = **Tale**.
- [ ] `SEO-F3` · **Canonical per locale** — `curl -s {base}/pricing` and
  `{base}/de/pricing`; grep `rel="canonical"` → `https://tale.dev/pricing` and
  `https://tale.dev/de/pricing` respectively — each locale page is its own
  canonical; `<html lang>` is `en` / `de` in the raw HTML.
- [ ] `SEO-F4` · **Localized titles** — `curl -s {base}/de/pricing`; grep
  `<title>` · The German title from `messages/de.yml` `seo.pricing.title`
  (question-shaped, matching the DE H1) + ` \ → Tale` — prerendering is per
  locale, not English-only.
- [ ] `SEO-F5` · **Sitemap** — `curl -s {base}/sitemap.xml` → Lists every
  marketing page (en + localised variants) with `xhtml:link rel="alternate"
  hreflang` for `en`/`de`/`fr`/`x-default`; **legal pages are excluded** (they
  are `noindex` and live only in robots.disallow + llms.txt); no unknown or
  dead URLs (spot-check a few return the right page)
- [ ] `SEO-F6` · **Robots + LLM artifacts** — `curl -s {base}/robots.txt`,
  `/llms.txt`, `/llms-full.txt` → robots: `Allow: /`, `Disallow: /api/`,
  `Disallow: /_search/`, **`Disallow:` for every legal URL** (e.g.
  `/legal/privacy-policy`, `/de/legal/…`), and **two** sitemap lines
  (`https://tale.dev/sitemap.xml` + `https://tale.dev/docs/sitemap.xml`); both
  llms files serve plaintext markdown summaries (HTTP 200, non-empty) and are
  linked from the footer bottom bar (`footer.llmsTxtLabel`,
  `footer.llmsFullTxtLabel` — [navigation.md](navigation.md) NAV-F7)
- [ ] `SEO-F7` · **Content pre-JS** — View-source of `/` (or curl) — do not
  execute JS → The hero heading from `home.hero.title` (**Orchestrate every AI
  agent on your stack**) is present in the served HTML — the page is
  meaningful to crawlers without hydration.
- [ ] `SEO-F8` · **Legal noindex** — `curl -s {base}/legal/privacy-policy`;
  grep `robots` → `<meta name="robots" content="noindex,nofollow">` present on
  legal pages; **absent** on marketing pages.
- [ ] `SEO-F9` · **JSON-LD structured data** — `curl -s {base}/`,
  `{base}/pricing`, `{base}/changelog`, `{base}/about`,
  `{base}/platform/chat`; extract every `<script type="application/ld+json">`
  block → `/` and `/pricing` embed the **Organization** +
  **SoftwareApplication** nodes (`lib/seo/organization.ts`,
  `lib/seo/software-application.ts` — Ruler GmbH, `@id: …/#software`);
  `/changelog` embeds a **BreadcrumbList** + an **ItemList** of releases;
  `/about` re-declares the **Organization** node (same `@id: …/#org`) + a
  **BreadcrumbList**; platform pages embed a **BreadcrumbList** (Tale →
  Platform overview → page) + **FAQPage**; every block parses as valid JSON.
- [ ] `SEO-F10` · **HTTP security headers** — `curl -sI {base}/pricing` (mode
  B or a HTTPS deploy) → Response carries the
  `defaultReactServerSecurityHeaders` set
  (`packages/ui/src/server/security-headers.ts`, wired in `server.ts`): a
  `Content-Security-Policy` with `default-src 'self'` + `frame-ancestors
  'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  denying camera/mic/geolocation, COOP/CORP `same-origin`;
  `Strict-Transport-Security: max-age=15552000` appears on **HTTPS** responses
  only.

## Boundary & error tests

- [ ] `SEO-B1` · **Real 404** — `curl -s -o /dev/null -w '%{http_code}'
  {base}/nope-not-a-route` → **HTTP 404** with `dist/404/index.html`
  (`noindex`) when served from the built static server / container — asserted
  by `container-web-test` probe `/nope`. Dev SPA may still soft-route; prove
  against `bun run --filter @tale/web start` or the container.
- [ ] `SEO-B2` · **Trailing slash** — `curl -sI {base}/pricing/` → Resolves to
  the same page (no duplicate-content split: either serves identical canonical
  `https://tale.dev/pricing` or redirects); record which.

## Accessibility (WCAG 2.1 AA)

- [ ] `SEO-A1` · **Page titles** → Every page's `<title>` is unique and
  describes the page (WCAG 2.4.2) — SEO-F1/SEO-F4 double as this check.

## Performance

- [ ] `SEO-P1` · **First byte** → `curl -w '%{time_starttransfer}'` on `/` **<
  1 s** (static prerendered file serve)
