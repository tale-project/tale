# SEO & prerendered head

> **Prefix** `SEO-` · **Reset** none · **Cost** 12 boxes

Verify the SEO surface the docs build produces — prerendered
per-page/per-locale `<title>`, meta description, canonical, and social tags
(`scripts/prerender.ts` + `useDocumentMeta`, site origin
`https://tale.dev/docs`), the `dist-seo` artifacts (`sitemap.xml`,
`robots.txt`, `llms.txt`, `llms-full.txt`), and the noindex rule on legal
pages. These checks read the **served HTML** (curl / view-source), not the
hydrated DOM.

## Scope & routes

| Surface       | Route                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Doc pages     | Every content slug × `/de`, `/fr` (EN unprefixed)                                                                                       |
| Legal pages   | `/legal/{slug}` (× locales) — **noindex**, excluded from sitemap, listed in `robots.disallow`                                           |
| 404           | `/404` — **noindex**, HTTP 404 when served from dist                                                                                    |
| Sitemap       | `/sitemap.xml`                                                                                                                          |
| Robots        | `/robots.txt`                                                                                                                           |
| LLM artifacts | `/llms.txt`, `/llms-full.txt`, per-page `{slug}.md` (allow-list `isSpecialEndpoint` in `app/routes/$.tsx`)                              |
| OG card       | Shared marketing `https://tale.dev/og.png` (1200×630)                                                                                   |
| HTTP headers  | Every response — `defaultReactServerSecurityHeaders` (`packages/ui/src/server/security-headers.ts`, wired in `services/docs/server.ts`) |

## Preconditions

Mode A (live), or a local **built** serve: `bun run --filter @tale/docs build`
then `bun run --filter @tale/docs start` (Bun server on `:3002` over `dist/` +
`dist-seo/`) per [SETUP.md](../setup.md). Mode B (`dev`) proves nothing here —
the vite dev server serves the unbuilt `index.html` head (fallback title), no
security headers, and none of the precompiled artifacts.

> **Agent note**: this guide is mostly `curl`-driven. Titles/descriptions come
> from markdown frontmatter; the prerenderer injects the HeadSink output
> between `seo:start` / `seo:end`. Docs reuses the marketing OG card from
> `tale.dev/og.png`.

## Functional tests

- [ ] `SEO-F1` · **Prerendered titles** — `curl -s {base}/` and a deep page;
  grep `<title>` → Title matches frontmatter `title` (+ brand suffix if
  configured) in the raw HTML.
- [ ] `SEO-F2` · **Meta description + OG** — Same fetches; grep `description`,
  `og:*`, `twitter:card` → Description matches frontmatter; `og:image` =
  `https://tale.dev/og.png`; `twitter:card` = `summary_large_image`
- [ ] `SEO-F3` · **Canonical per locale** — `curl -s
  {base}/platform/chat/basics` and `{base}/de/platform/chat/basics` →
  Canonicals are locale-specific; `<html lang>` is `en` / `de`
- [ ] `SEO-F4` · **Sitemap** — `curl -s {base}/sitemap.xml` → Lists indexable
  docs; **legal pages excluded**; hreflang alternates present.
- [ ] `SEO-F5` · **Robots + LLM artifacts** — `curl -s {base}/robots.txt`,
  `/llms.txt`, `/llms-full.txt` → `Disallow:` for every noindex legal path;
  **two** sitemap lines (`https://tale.dev/docs/sitemap.xml` +
  `https://tale.dev/sitemap.xml`); llms files non-empty.
- [ ] `SEO-F6` · **Legal noindex** — `curl -s {base}/legal/privacy`; grep
  `robots` → `<meta name="robots" content="noindex,nofollow">` present; absent
  on normal docs pages.
- [ ] `SEO-F7` · **Content pre-JS** — View-source of `/` — do not execute JS →
  The index H1 from frontmatter is present in the served HTML.
- [ ] `SEO-F8` · **JSON-LD** — Same fetch of a content page; grep
  `application/ld+json` → The prerendered head declares **Article +
  BreadcrumbList + WebSite** JSON-LD (asserted per route by
  `tests/prerender/seo.test.ts` — spot-check the served copy matches the page)
- [ ] `SEO-F9` · **Security headers** — `curl -sI {base}/` (built server or
  live — vite dev sends none) → `Content-Security-Policy` (`default-src
  'self'`; `media-src 'self'` for the tutorial mp4/vtt; `frame-ancestors
  'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  denying camera/mic/geolocation/… (clipboard deliberately **not** denied —
  the copy buttons need it), COOP/CORP `same-origin`;
  `Strict-Transport-Security: max-age=15552000` on HTTPS only (mode A)
- [ ] `SEO-F10` · **Special endpoints** — `curl -s
  {base}/platform/chat/basics.md` and `{base}/de/platform/chat/basics.md` →
  Both serve the raw markdown (HTTP 200, not the HTML shell) — `.md`,
  `llms.txt`, `llms-full.txt`, `sitemap.xml`, `robots.txt` bypass the SPA page
  resolution (`isSpecialEndpoint` allow-list) so they never render a 404 page
  or the app chrome.

## Boundary & error tests

- [ ] `SEO-B1` · **Real 404** — `curl -s -o /dev/null -w '%{http_code}'
  {base}/nope-not-a-route` → **HTTP 404** with `dist/404/index.html`
  (`noindex`) when served from the built static server. _(NOTE: manual-only
  until a docs container probe asserts this — `container-web-test.ts` already
  probes `/nope` → 404 for web; `container-docs-test.ts` has no equivalent
  probe yet, filed #2620.)_.

## Accessibility (WCAG 2.1 AA)

- [ ] `SEO-A1` · **Page titles** → Every page's `<title>` is unique and
  describes the page (WCAG 2.4.2)
