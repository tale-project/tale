# @tale/seo

Build-time SEO and LLM-artifact helpers shared across every Tale service.
Pure Node / Bun, no React, no Vite — these run in `scripts/*.ts` to emit
static files into `public/` (and `dist/` post-prerender) so the live site
can serve them.

## When to use it

If your service has any public surface, it should produce the same five
artifacts as `services/web` and `services/docs`:

| File                      | Helper                                          | Purpose                                                                    |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `/llms.txt`               | [`llms-txt`](./src/llms-txt.ts)                 | Index of pages for AI tools (https://llmstxt.org/).                        |
| `/llms-full.txt`          | [`llms-full-txt`](./src/llms-full-txt.ts)       | All page bodies concatenated.                                              |
| `/sitemap.xml`            | [`sitemap`](./src/sitemap.ts)                   | Standard sitemap with `hreflang` alternates and git-aware `<lastmod>`.     |
| `/robots.txt`             | [`robots`](./src/robots.ts)                     | Default disallows + service-specific extras + sitemap declaration.         |
| `/<route>.md`             | [`page-as-markdown`](./src/page-as-markdown.ts) | Per-page markdown export for AI consumers.                                 |
| (per-page meta + JSON-LD) | [`json-ld`](./src/json-ld.ts)                   | `Organization`, `WebSite`, `Article`, `BreadcrumbList` blocks.             |
| (post-prerender)          | [`html-to-markdown`](./src/html-to-markdown.ts) | Converts SSR'd HTML to Markdown for routes that don't have a source `.md`. |

Each helper is exported under its own subpath so consumers only pay for
what they import:

```ts
import { buildLlmsTxt } from '@tale/seo/llms-txt';
import { buildLlmsFullTxt } from '@tale/seo/llms-full-txt';
import { buildSitemap, gitMtimeIso } from '@tale/seo/sitemap';
import { buildRobotsTxt } from '@tale/seo/robots';
import { pageAsMarkdown } from '@tale/seo/page-as-markdown';
import { htmlToMarkdown } from '@tale/seo/html-to-markdown';
import {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
} from '@tale/seo/json-ld';
```

## Conventions

- **Where to run.** Each service ships a `scripts/build-llms-artifacts.ts`
  invoked from `package.json`'s `dev` and `build` scripts. The script
  writes into `public/` so Vite serves the files in dev and copies them
  into `dist/` during `vite build`.
- **Where to render.** Pages with a markdown source (docs) use that body
  directly. Pages rendered from React (marketing) get their `.md` content
  from the SSR output via `htmlToMarkdown`, emitted from a post-prerender
  script (see `services/web/scripts/prerender.ts`).
- **Locale handling.** `Locale` is imported from `@tale/i18n/locales` so
  this package stays framework-free.
- **Auth-only services.** Platforms behind a login still ship a minimal
  `llms.txt` pointing at the public docs/marketing surfaces — see
  `services/platform/scripts/build-llms-artifacts.ts`.

## Adding it to a new service

Add `"@tale/seo": "workspace:*"` to the service's `dependencies`, then
create a `scripts/build-llms-artifacts.ts` that imports the helpers and
writes the artifacts into `public/`. Wire it into `dev` and `build` so
the files are always fresh.
