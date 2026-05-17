# @tale/seo

On-demand SEO and LLM-artifact server shared across every Tale service.
Pure Node / Bun, no React, no Vite at runtime — the high-level
`createArtifactsServer` returns a request handler that renders artifacts
lazily and caches them in-memory.

## When to use it

If your service has any public surface, it should serve the same five
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

The recommended integration is the on-demand server:

```ts
import { createArtifactsServer } from '@tale/seo';

const artifacts = createArtifactsServer({
  siteUrl: 'https://tale.dev',
  siteTitle: 'Tale',
  siteDescription: '…',
  loadRoutes: async () => ({ sections: [...], optionalPages: [...] }),
  loadBody: async (url) => readMarkdownFor(url),
});
```

Wire the resulting `ArtifactsServer` into:

- **Production**: pass it to `startReactServer({ artifacts })` from
  `@tale/webui/server`. The Bun shell dispatches `/llms.txt`,
  `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, and `/<route>.md`
  requests to it (with ETag handling) before falling through to static
  serving.
- **Dev**: import `artifactsPlugin` from
  `@tale/seo/vite-plugin-artifacts` so the same handler serves the same
  URLs through Vite's dev server.
- **Hono apps** (e.g. `services/platform`): the artifact server's
  `handle(request)` returns a `Response | null`, so you can dispatch
  manually inside any framework.

Each subpath is also exported standalone:

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
import { compileArtifacts } from '@tale/seo/artifacts';
```

The pure `compileArtifacts` helper returns a `path → content` map and is
useful for one-shot CI exports that want a static snapshot of every
artifact (no IO, no caching).

## Conventions

- **Where to render.** Pages with a markdown source (docs) supply the
  body directly through `loadBody`. Pages rendered from React
  (marketing) get their `.md` content from the SSR output via
  `htmlToMarkdown` inside the service's `loadBody` callback.
- **Caching.** `createArtifactsServer` caches built artifacts in memory
  per-process; pass `cache: false` in dev so source edits show up
  immediately. Call `invalidate()` from your own hot-reload integration.
- **Locale handling.** `Locale` is imported from `@tale/i18n/locales` so
  this package stays framework-free.
- **Auth-only services.** Platforms behind a login still ship a minimal
  `llms.txt` pointing at the public docs/marketing surfaces — see
  `services/platform/lib/seo/artifacts-server.ts`.

## Adding it to a new service

Add `"@tale/seo": "workspace:*"` to the service's `dependencies`. Create
a `lib/seo/artifacts-server.ts` that calls `createArtifactsServer` with
the service's routes, then pass the returned `ArtifactsServer` to
`startReactServer({ artifacts })` and to the dev Vite plugin.
