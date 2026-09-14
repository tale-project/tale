# @tale/ui-docs

The design-system documentation site — **https://ui.tale.dev**. It documents
[`@tale/ui`](../../packages/ui/) (the app language) and
[`@tale/marketing-ui`](../../packages/marketing-ui/) (the marketing language)
for the people and agents who build Tale interfaces, inside this monorepo or
from another repository that installs the packages from GitHub.

```bash
bun run --filter @tale/ui-docs dev        # content build + Vite on :3003
bun run --filter @tale/ui-docs build      # content + client + SSR + prerender + SEO artifacts
bun run --filter @tale/ui-docs start      # serve ./dist + ./dist-seo with the Bun server (:3003)
bun run --filter @tale/ui-docs typecheck
bun run --filter @tale/ui-docs lint
bun run --filter @tale/ui-docs test       # nav / content / demo parity + chrome a11y (vitest)
bun run --filter @tale/ui-docs test:e2e   # Playwright smoke (UI_DOCS_E2E_PORT to move it off :3003)
bun run docker:test:ui-docs               # from the repo root: build the image and probe it
```

Stack: Vite · React 19 · TanStack Router · Tailwind v4 · `@tale/ui` + `@tale/marketing-ui` ·
MiniSearch · Vitest · Playwright. English only — no locale prefixes; the chrome catalog still
ships `messages/{en,de,fr}.yml` because the repo's i18n gate requires every locale.

## Two design languages, one site

The site is itself an example of the rule it documents: **the app language and the marketing
language never mix on one screen.**

| Route      | Language      | Built from                                                                                                                       |
| ---------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/`        | marketing web | `@tale/marketing-ui` — `SiteHeader`, `PageSection`, `SectionHeading`, `CtaPair`, `MarketingCard`, `DemoStage` + `DemoShell`      |
| `/docs/*`  | platform app  | `@tale/ui` — `SubPanel` rail, the `h-13` header strip with `HeaderBreadcrumbs`, `MobileAppHeader` + `Sheet` drawer, `Card`, … |
| `/404`     | platform app  | the not-found page, in the docs colour scheme                                                                                    |

The root route (`app/routes/__root.tsx`) is deliberately thin — each page owns its chrome. The
front page's showcase window renders the shipped `@tale/ui` components inside the marketing
`DemoShell` (`role="img"`, `inert`: a labelled illustration, not a form); the interactive examples
live on the documentation pages.

### The chrome

All under `app/components/`:

| File                               | Role                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `home/site-chrome.tsx`             | the front page's `SiteHeader` (logo, Docs, Components, GitHub, theme) and a compact footer bar    |
| `home/home-showcase.tsx`           | the product window: `Input`, `Select`, `Switch`, `Tabs`, `DataTable`, `Badge` inside `DemoShell`  |
| `docs/docs-shell.tsx`              | the documentation frame: rail + header strip + article + outline, ⌘K wiring, the lazy search dialog |
| `docs/docs-nav-rail.tsx`           | the permanent `SubPanel` rail (`md`+): logo row, search trigger, the tree                         |
| `docs/docs-nav-tree.tsx`           | `content/nav.json` in the sub-panel row vocabulary — shared by the rail and the drawer            |
| `docs/docs-mobile-nav.tsx`         | the phone bar (`MobileAppHeader`) and the left `Sheet` drawer                                      |
| `docs/docs-header.tsx`             | the sticky `h-13` strip: breadcrumb trail whose leaf is the page's only `h1`, search, theme, GitHub |
| `docs/docs-toc.tsx`                | "On this page" with scroll-spy (`xl`+)                                                             |
| `docs/docs-prev-next.tsx`          | the neighbour cards in nav order                                                                  |
| `docs/docs-search-trigger.tsx`     | the one `h-9` search control                                                                      |
| `docs/edit-on-github.tsx`          | deep link into GitHub's editor for the page's markdown file                                       |
| `demo/demo.tsx` + `demo/registry.ts` | the `<Demo name="…" />` tag: live preview surface + Code toggle over `app/demos/**`             |
| `../features/page-actions/`        | Copy page / View as Markdown / Open in ChatGPT, Claude, Cursor                                   |
| `../features/search/`              | the ⌘K palette: `@tale/ui/search` over the static MiniSearch index                                |

These components are props-driven and local to this service on purpose. The docs site
(`services/docs`) carries a near-identical set; lifting the shared pieces into `@tale/ui/docs/*`
is the planned next step, and `docs-shell.tsx` is the seam that gets replaced.

## Content

Pages are markdown under [`content/<section>/<slug>.md`](content/) with `title`, `description`
and an optional `noindex` in the frontmatter; the order comes from
[`content/nav.json`](content/nav.json). [`content/README.md`](content/README.md) is the authoring
contract (page shape, the `<Demo>` tag, demo file rules, voice). A live example is a prop-less
component under `app/demos/<family>/<name>.tsx`, addressed as `<Demo name="family/name" />`.

Build-time artifacts (`scripts/build-content.ts`, run by `dev` and `build`):

- `app/content/frontmatter.json` — every page's frontmatter, imported synchronously so the rail,
  the trail and prev/next never load a page body (**committed**; regenerate when a frontmatter
  changes).
- `public/search-index.json` — the MiniSearch index (**git-ignored**).

## Build and serve

`build` runs, in order: the content artifacts, the client bundle (`dist/`), the SSR bundle
(`dist-ssr/`), `scripts/prerender.ts` (one HTML file per route into `dist/`, plus `dist/404/`),
and `seo:compile` (`dist-seo/`: `llms.txt`, `llms-full.txt`, `sitemap.xml`, `robots.txt`, and a
`/<route>.md` twin of every page). `server.ts` serves `dist/` and `dist-seo/` through
`@tale/ui/server` + `@tale/ui/seo`, answers `GET /api/health`, and returns a real 404 with the
prerendered page; the image bundles it to `server.js` (like docs and web) so the runtime stage
carries no `node_modules`. In dev, `vite.config.ts` serves the same artifacts on demand from
`content/`.

| Variable                 | Where       | Default                | Purpose                                                    |
| ------------------------ | ----------- | ---------------------- | ---------------------------------------------------------- |
| `UI_DOCS_SITE_URL`       | build arg   | `https://ui.tale.dev`  | canonical URLs, sitemap, JSON-LD (`VITE_UI_DOCS_SITE_URL` in the client) |
| `UI_DOCS_BASE_URL`       | build arg   | `/`                    | mount prefix for a sub-path deployment (trailing slash)    |
| `UI_DOCS_PORT`           | dev         | `3003`                 | the Vite dev-server port                                   |
| `UI_DOCS_E2E_PORT`       | test        | `3003`                 | the port Playwright boots its dev server on                |
| `VITE_UI_DOCS_BRANCH`    | build       | `main`                 | branch the "Edit this page on GitHub" links target         |
| `PORT`                   | runtime     | `3003`                 | the Bun server port                                        |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | runtime | unset            | optional error reporting (`@tale/ui/monitoring`)           |

The image is `ghcr.io/tale-project/tale/tale-ui-docs:<version>` (`Dockerfile`,
`compose.ui-docs.yml` at the repo root); ops deploys it as `deployments/ui-docs` on its own
droplet behind the host Caddy.

## Tests

- `tests/*.test.ts` (node): every nav slug has a file and every file is in the nav; every page has
  a title and a description and no second `h1`; every `<Demo>` resolves and every demo is used;
  the content loader's contract.
- `app/**/*.test.tsx` (jsdom + axe): the chrome components and the `Demo` tag.
- `tests/e2e/specs/*.spec.ts` (Playwright): the front page, a documentation page with a live
  example, the outline, the redirect from `/docs`, the 404, the theme switch, the search palette.
- `tests/manual/` — the manual layer (`bun run lint:manual`): what a headless run cannot judge.
