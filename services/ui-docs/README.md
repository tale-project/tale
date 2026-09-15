# @tale/ui-docs

The design-system guide at [ui.tale.dev](https://ui.tale.dev) helps you install
Tale’s UI packages, choose components, and compose application or marketing screens.
Its 19 English guides include live examples with their source. The examples use local
sample state; they do not connect to the Tale backend.

For package consumption, start with [Installation](content/getting-started/installation.md).
To change a guide, follow the [content authoring contract](content/README.md).
This README covers running and maintaining the documentation site.

## Run it locally

Use the Bun version pinned in the repository’s root `package.json`. From the root:

```bash
bun install --frozen-lockfile
bun run --filter @tale/ui-docs dev
```

Open `http://localhost:3003`. The homepage uses `@tale/marketing-ui`; `/docs/*` uses
`@tale/ui` for application-style navigation, controls, and examples. `/docs` redirects
to the introduction. The service runs without platform accounts or a database.

`dev` generates content metadata and search before starting Vite. Markdown edits
refresh in the browser; restart the server to refresh the search index after edits.
Set `UI_DOCS_PORT` when port 3003 is occupied. Check the printed URL to confirm which
server you opened.

## Find the part to change

| Task | Owner |
| --- | --- |
| Edit a guide or its order | `content/<section>/<slug>.md`, `content/nav.json` |
| Change a working example | `app/demos/<family>/<name>.tsx` |
| Change preview or Code behavior | `app/components/demo/` |
| Change the documentation frame | [`packages/ui/src/components/docs/`](../../packages/ui/src/components/docs/), shared with the [product docs](../docs/README.md); this site feeds it in `app/components/docs/ui-docs-layout.tsx` |
| Change the public homepage | `app/pages/home-page.tsx`, `app/components/home/` |
| Change search or page actions | `docs-search-dialog.tsx` and `page-actions.tsx` in the shared docs family; the index engine in [`packages/ui/src/components/search/static-index/`](../../packages/ui/src/components/search/static-index/) |
| Change site copy | `messages/{en,de,fr}.yml` |
| Change artifact generation or serving | `scripts/`, `lib/seo/`, `server.ts` |

The body routes are English-only and `LocaleSync` pins this site to English. The
EN/DE/FR chrome catalogs remain complete; follow the translation skill when editing
them. Demo literals are English sample code, while shared controls use package copy.

The homepage product window and nested application-layout examples are labelled,
inert illustrations. Their explanation must remain understandable outside the frame.
Interactive demos run inside the docs pages. A single root `Toaster` serves all of them.

## Build and inspect production output

```bash
bun run --filter @tale/ui-docs build
bun run --filter @tale/ui-docs start
```

Stop the dev server first or set runtime `PORT` to use another port. The build runs
content generation, client and SSR compilation, prerendering, and SEO compilation.

| Output | Contents | Tracked? |
| --- | --- | --- |
| `app/content/frontmatter.json` | Navigation-ready metadata for every guide | Yes; regenerate after metadata changes |
| `public/search-index.json` | MiniSearch index | No |
| `dist/` | Client assets and prerendered route HTML, including the 404 | No |
| `dist-ssr/` | Server-rendering bundle used during prerendering | No |
| `dist-seo/` | Sitemap, robots, LLM indexes, and Markdown twins | No |

The Bun server serves the built files through `@tale/ui/server` and `@tale/ui/seo`.
Check `/api/health`, a deep-linked guide, `/docs/components/button.md`, and an unknown
route after a deployment. The unknown route must return HTTP 404 with a usable page.

## Configure the deployment

| Variable | Read by | Default | Purpose |
| --- | --- | --- | --- |
| `UI_DOCS_SITE_URL` | Build | `https://ui.tale.dev` | Canonical URLs, sitemap, and structured data |
| `UI_DOCS_BASE_URL` | Build and runtime | `/` | Public mount prefix; include a trailing slash and use the same value in both stages |
| `UI_DOCS_PORT` | Dev | `3003` | Vite port |
| `UI_DOCS_E2E_PORT` | Browser tests | `3003` | Separate test server port |
| `VITE_UI_DOCS_BRANCH` | Build | `main` | Target branch for Edit on GitHub links |
| `PORT` | Runtime | `3003` | Bun server port |
| `SENTRY_DSN` | Runtime | Unset | Optional error reporting |
| `SENTRY_ENVIRONMENT` | Runtime | `NODE_ENV` | Monitoring environment |
| `TALE_VERSION` | Runtime | Unset | Monitoring release identifier |

The repository’s `Dockerfile` target and `compose.ui-docs.yml` package the site as
`ghcr.io/tale-project/tale/tale-ui-docs:<version>`. The runtime image contains bundled
`server.js` and generated outputs, without `node_modules` or source Markdown. The
service’s Docker build is covered by `bun run docker:test:ui-docs` from the root.

## Check a change

```bash
bun run --filter @tale/ui-docs test
bun run --filter @tale/ui-docs typecheck
bun run --filter @tale/ui-docs lint
UI_DOCS_E2E_PORT=3007 bun run --filter @tale/ui-docs test:e2e
bun run lint:manual
```

Unit tests cover navigation/file parity, frontmatter, demo registration, loader
behavior, and the 404. The shared frame’s own tests live with it in `packages/ui`
(`bun run --filter @tale/ui test` and `test:browser`). Browser tests cover the homepage,
docs, the header strip’s line with the rail, Code panel, search, theme, redirects, and
404. The [manual layer](tests/manual/readme.md) adds
visual judgment, focus, responsive navigation, and production artifact review.
Read the page and use its examples at phone and desktop widths in both themes;
a green structural test cannot establish that an instruction is accurate.
