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
| Site labels | `services/docs/messages/{en,de,fr,de-CH}.yml` |
| Supported Markdown components | [`registry.tsx`](../../packages/ui/src/markdown/components/registry.tsx) |
| Screenshots and demo data | [`docs-screenshots`](../platform/tests/docs-screenshots/README.md) |
| Rendered page layout | `services/docs/app/components/docs/` |

Read the [docs contract](../../docs/AGENTS.md), [writing skill](../../.agents/skills/write-docs/SKILL.md), and [translation skill](../../.agents/skills/write-translations/SKILL.md) before authoring. Write each page for a concrete reader task. Confirm product instructions in the running platform and add screenshots through the capture pipeline.

Keep English, German, and French pages in sync. Regional Swiss German pages are sparse overrides. Register new pages in navigation; preserve old URLs with redirects when moving pages. The content tests explain individual checks in [tests/AGENTS.md](tests/AGENTS.md).

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

Use the root `bun run format` and `bun run check` for repository formatting and validation. This workspace has no separate format script.

## Build and serve

```bash
bun run --filter @tale/docs build
bun run --filter @tale/docs start
```

The build creates the search index, client and server bundles, prerendered pages, and SEO artifacts. The Bun server serves the result. Its default port is `3002`; `PORT` overrides it. `DOCS_BASE_URL` configures the path prefix when hosting under a subpath.

## Configure optional error reporting

Set `SENTRY_DSN` at runtime to report errors to a Sentry-compatible receiver such as GlitchTip. `SENTRY_ENVIRONMENT` defaults to `NODE_ENV`, and `TALE_VERSION` identifies the release. Remote receivers require HTTPS; loopback HTTP supports local tests. Without a DSN, error reporting stays off.

The server injects selected public configuration into escaped inert JSON. Reports retain error type, release, and compiled stack locations. They remove messages, form fields, request headers, cookies, query strings, user identity, breadcrumbs, and source context. Tracing, replay, session collection, logging, and performance instrumentation stay off. The implementation lives in `@tale/ui/monitoring` and `@tale/ui/server`.

For a web/docs-only release, use the `Release` workflow’s `sites_only` option with a distinct version. It builds and tests site images without publishing platform images, CLI assets, a full Tale release, or latest tags.
