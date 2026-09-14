# Crawler and agent surface

> **Prefix** `SEO-` · **Reset** none · **Cost** ~15 min

What a crawler, a link unfurler or an LLM agent gets from ui.tale.dev: the
prerendered `<head>` per route, the JSON-LD, the sitemap and robots files, the
`llms.txt` index with the `.md` twin of every page, and the real HTTP status of
the 404. Most of this only exists on the **built** server — the Vite dev server
serves the artifacts on demand but never prerenders and never answers a 404
status.

## Scope & routes

| Surface        | Route / source                                                                     |
| -------------- | ---------------------------------------------------------------------------------- |
| Prerender      | `scripts/prerender.ts` → `dist/**/index.html`, `dist/404/index.html`               |
| Artifacts      | `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, `/docs/<slug>.md`    |
| Head           | `lib/seo/use-document-meta.ts` (title, description, canonical, robots, JSON-LD)    |
| Server         | `server.ts` (`@tale/ui/server` + `createPrecompiledServer`)                         |

## Preconditions

A production build served locally: `bun run --filter @tale/ui-docs build`, then
`bun run --filter @tale/ui-docs start` (port 3003), or the container from
`bun run docker:test:ui-docs`. `curl` and a browser with JavaScript **disabled**
for the prerender boxes.

## Boxes

- [ ] `SEO-1` · **`curl -s /docs/components/button | head`** → the response is
  the prerendered document: the `<title>` is **Button | The Tale design
  system**, the meta description is the page's frontmatter description, the
  canonical is `https://ui.tale.dev/docs/components/button`, and the article
  HTML is present without JavaScript.
- [ ] `SEO-2` · **Open the same page with JavaScript disabled** → the rail, the
  trail, the article and the live examples' previews render from the
  prerendered HTML alone (the Code toggles do nothing, which is expected).
- [ ] `SEO-3` · **Read the page's JSON-LD** → one `Article` (headline = the
  title, `inLanguage` en, publisher Tale) and one `BreadcrumbList` whose items
  are the site, the section and the page, in that order.
- [ ] `SEO-4` · **`curl -s /sitemap.xml`** → one `<url>` per content page plus
  `/`, every `loc` absolute under `https://ui.tale.dev`, no `/404`, and every
  page with `noindex: true` in its frontmatter absent.
- [ ] `SEO-5` · **`curl -s /robots.txt`** → allows everything except the
  `noindex` pages, names this site's sitemap and the tale.dev sitemap.
- [ ] `SEO-6` · **`curl -s /llms.txt` and `/llms-full.txt`** → the index opens
  with the site title and description and lists every page under its section
  with an absolute `.md` link; the full variant inlines every page body.
- [ ] `SEO-7` · **`curl -si /docs/components/button.md`** → `200`,
  `content-type: text/markdown`, serialized frontmatter first and the authored body with site links resolved
  to absolute URLs (the `<Demo>` tags still self-closing).
- [ ] `SEO-8` · **`curl -si /docs/nope-not-a-page`** → the status is **404**
  and the body is the prerendered not-found page, not the home page and not an
  empty shell.
- [ ] `SEO-9` · **`curl -si /`** → the security headers the shared server sets
  are present (`content-security-policy`, `x-content-type-options: nosniff`,
  `referrer-policy`), and `GET /api/health` answers `200` with JSON.
