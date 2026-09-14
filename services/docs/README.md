# Tale documentation site

Work on Tale’s end-user documentation in `docs/{en,de,fr}` and preview it with this workspace. The site uses Vite, React, TanStack Router, and the shared `@tale/ui` Markdown components. It builds static pages with search, a sitemap, and text exports for AI clients.

## Preview the docs

From the repository root, install the workspace dependencies and start the site:

```bash
bun install --frozen-lockfile
bun run --filter @tale/docs dev
```

Open `http://localhost:3002`. Content edits reload the preview so the current page body is loaded again. This command builds the search index before starting Vite. You do not need the platform, a database, or an AI provider to preview existing pages.

After changing page titles or descriptions, rebuild the search index so search and navigation use the updated metadata:

```bash
bun run --filter @tale/docs build:search-index
```

## Find the files to change

| Change | Source |
| --- | --- |
| Page content | [`docs/en`](../../docs/en), with German and French siblings |
| Sidebar order and groups | [`docs/nav.json`](../../docs/nav.json) |
| Redirects for moved pages | [`docs/redirects.json`](../../docs/redirects.json) |
| Site labels | `services/docs/messages/{en,de,fr,de-CH}.yml`, merged over shared `packages/ui/src/i18n/messages/` |
| Supported Markdown components | [`registry.tsx`](../../packages/ui/src/markdown/components/registry.tsx) |
| Screenshots and demo data | [`docs-screenshots`](../platform/tests/docs-screenshots/README.md) |
| Rendered page layout | `services/docs/app/components/docs/` |

Read the [docs contract](../../docs/AGENTS.md), [writing skill](../../.agents/skills/write-docs/SKILL.md), and [translation skill](../../.agents/skills/write-translations/SKILL.md) before authoring. Write each page for a concrete reader task. Confirm product instructions in the running platform and add screenshots through the capture pipeline.

Keep English, German, and French pages in sync. Swiss German message overrides are sparse; the content tree currently ships the three full locales. Register new pages in navigation; preserve old URLs with redirects when moving pages. The content tests explain individual checks in [tests/AGENTS.md](tests/AGENTS.md).

## The page layout

The reader follows a navigation rail, breadcrumb header, article, and section outline. These
components use the app design language from `@tale/ui`; the site supports light and dark themes.
The root layout lives in `app/routes/__root.tsx`, with its parts in `app/components/docs/`:

| Part | Responsibility |
| --- | --- |
| `docs-nav-rail.tsx`, `docs-nav-tree.tsx` | Render `docs/nav.json` using `SubPanel` rows and disclosures; the same tree serves the desktop rail and phone drawer. |
| `docs-mobile-nav.tsx` | Provide the phone header, search action, and navigation drawer. |
| `docs-page-header.tsx` | Keep breadcrumbs and page actions visible; its current-page marker does not add a second `h1`. |
| `docs-toc.tsx` | Show the section outline as a rail on wide screens or a disclosure above the article. |
| `docs-prev-next.tsx`, `docs-footer.tsx` | Provide neighboring pages, language and theme controls, and text-export links. |

Use shared tokens and controls when changing this layout. Read the
[design contract](../../design/docs/README.md) and verify keyboard access, the single article
`h1`, hidden duplicate navigation, both themes, and narrow-width wrapping.

## Verify a change

```bash
bun run --filter @tale/docs build:search-index
bun run --filter @tale/docs test
bun run --filter @tale/docs build
```

View the changed pages in the browser in all three languages. Check links, search terms a reader would use, images at content width, keyboard navigation, and a narrow viewport. The [manual test guide](tests/manual/readme.md) covers checks that static tests cannot judge.

For renderer or application changes, also run:

```bash
bun run --filter @tale/docs lint
bun run --filter @tale/docs typecheck
bun run --filter @tale/docs test:e2e
```

`DOCS_E2E_PORT` changes the Playwright preview port from `3002`. Use a free port when another
checkout is running: local tests reuse an existing server and can otherwise inspect the wrong
checkout. `E2E_BASE_URL` chooses the request target; it does not disable the configured local
preview process.

Use the root `bun run format` and `bun run check` for repository formatting and validation. This workspace has no separate format script.

## Build and serve

```bash
bun run --filter @tale/docs build
bun run --filter @tale/docs start
```

The build creates the search index, client and server bundles, prerendered pages, and SEO artifacts. The Bun server serves the result. Its default port is `3002`; `PORT` overrides it. `DOCS_BASE_URL` configures the path prefix when hosting under a subpath.

## Route the public documentation host

The bundled proxy serves prose documentation on its own host. `DOCS_URL` chooses
that origin and defaults to `https://docs.<HOST>`; the deployment must include
`docs:3002` and provide DNS and TLS for the hostname. The platform origin’s
`/docs` page is the interactive API reference, not this site.

`DOCS_BASE_URL` is a path prefix, not a hostname. Use the same prefix when building
and serving a docs image. The SEO build tooling uses `TALE_DOCS_URL` for its docs
origin; changing Caddy routing alone does not rewrite links in existing client
bundles. See the [proxy README](../proxy/README.md) for route and failure handling.

## Configure optional error reporting

Set `SENTRY_DSN` at runtime to report errors to a Sentry-compatible receiver such as GlitchTip. `SENTRY_ENVIRONMENT` defaults to `NODE_ENV`, and `TALE_VERSION` identifies the release. Remote receivers require HTTPS; loopback HTTP supports local tests. Without a DSN, error reporting stays off.

The server injects selected public configuration into escaped inert JSON. Reports retain error type, release, and compiled stack locations. They remove messages, form fields, request headers, cookies, query strings, user identity, breadcrumbs, and source context. Tracing, replay, session collection, logging, and performance instrumentation stay off. The implementation lives in `@tale/ui/monitoring` and `@tale/ui/server`.

For a web/docs-only release, use the `Release` workflow’s `sites_only` option with a distinct version. It builds and tests web, docs, and ui-docs images without publishing platform images, CLI assets, a full Tale release, or latest tags.

## Optional aggregate analytics

Analytics is disabled by default. Set `UMAMI_URL`, `UMAMI_WEBSITE_ID` and server-only
`UMAMI_PROXY_TOKEN` in the production service’s runtime environment to enable it. Recreate the
service after changing these values; clearing the website ID disables collection without an
image rebuild. The Vite development server does not inject this configuration.

The shared `@tale/ui/analytics` implementation loads the tracker through `/_a/script.js` and
sends curated pageviews through `/_a/api/send`. A configured base path prefixes those URLs.
Only the website ID and proxy path enter the browser; the collector origin and token remain on
the server. Known public paths and private route templates omit queries, page titles and
resource IDs. Do Not Track and Global Privacy Control disable collection.

The collector gateway must authenticate `GET /_collect/script.js` and `POST /_collect/api/send`
with the configured bearer token. Edge Caddy must overwrite `X-Analytics-Client-IP` from its
trusted client address. Keep application ports private and configure trusted proxy ranges when
another proxy sits in front. The server forwards the validated IP, browser User-Agent and
required Umami headers; it drops browser cookies, credentials and referrer headers.

See the [environment reference](../../docs/en/self-hosted/configuration/environment-reference.md)
and [observability guide](../../docs/en/self-hosted/configuration/observability-config.md) for the
collector contract, collected fields, opt-outs and verification steps.
