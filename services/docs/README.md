# @tale/docs

Tale documentation site.

```bash
bun run --filter @tale/docs dev       # build search index, then Vite dev server
bun run --filter @tale/docs build     # client + SSR bundle, then prerender
bun run --filter @tale/docs start     # serve the built site (bun server.ts)
bun run --filter @tale/docs typecheck
bun run --filter @tale/docs test      # vitest
bun run --filter @tale/docs test:e2e  # playwright
```

Stack: Vite · TanStack Router · React 19 · Tailwind v4 (extends
`@tale/ui/tailwind-preset`) · Vitest · Playwright. Content lives under the
locale folders; see the `docs` skill for authoring and translation rules.

## The chrome

The site wears the **platform app** design language ([`design/docs/app.md`](../../design/docs/app.md)),
light by default, and is built from `@tale/ui` — nothing marketing-side is
imported here. The shell lives in [`app/routes/__root.tsx`](app/routes/__root.tsx)
and its parts in [`app/components/docs/`](app/components/docs):

| Part | Built from | What it is |
| --- | --- | --- |
| `docs-nav-rail.tsx` | `SubPanel` + `sub-panel-list` | the permanent left rail: logo row (`h-13`), search field, nav tree. Hidden below `md`. |
| `docs-nav-tree.tsx` | `SubPanelSectionHeader`, `SUB_PANEL_ROW_CLASS`, `SubPanelDisclosureBody` | `docs/nav.json` as sections, rows and disclosures — shared by the rail and the drawer. |
| `docs-mobile-nav.tsx` | `MobileAppHeader` + `Sheet` | the phone bar (menu · logo · search) and the drawer that carries the same tree. |
| `docs-page-header.tsx` | `HEADER_CRUMB_LINK_CLASS` | the sticky `h-13` strip: breadcrumb trail (`nav > ol`) + page actions. The leaf is a plain `aria-current` marker — the article keeps the page's only `h1`. |
| `docs-toc.tsx` | `sub-panel-list` + `CollapsibleDetails` | the outline: a rail from `xl`, a disclosure above the article below it (the hidden copy is `aria-hidden`). |
| `docs-prev-next.tsx`, `docs-footer.tsx`, `page-actions.tsx` | `Card`, `Button`/`IconButton`, `DropdownMenu` | neighbour cards, the one-row footer (llms links, language + theme switchers, GitHub) and the copy/open-in cluster. |

Every colour is a token (`bg-background`, `text-muted-foreground`,
`border-border`, `bg-muted` hover) — no hex, no grays — so the surfaces theme
even though the site defaults to light.

## Configuration

All config is read from `process.env` — no `.env` is required, defaults work out
of the box:

- `PORT` — HTTP listen port (default `3002`; the Dockerfile already sets it).
- `DOCS_BASE_URL` — base path the site is served under (default `/`); set it
  when hosting the docs under a sub-path.
- `DOCS_E2E_PORT` — port the Playwright `webServer` previews on (default
  `3002`). Set it when another checkout already serves the docs there: outside
  CI Playwright reuses whatever answers on the port, which would test the wrong
  tree.

## Optional error reporting

Set `SENTRY_DSN` at runtime to send error metadata to a Sentry-compatible
receiver such as GlitchTip. `SENTRY_ENVIRONMENT` defaults to `NODE_ENV`;
`TALE_VERSION` identifies the release. No DSN means no SDK initialization,
listeners or reports. Remote DSNs require HTTPS; loopback HTTP is supported
for isolated tests.

The Bun server includes only the selected public metadata as escaped inert
JSON in each HTML response. The browser reads that configuration before
rendering, so image rebuilds and extra startup requests are unnecessary.
The CSP permits only the configured receiver origin in addition to self.
Server request failures, React/router boundary errors and unhandled errors
are reported. Error messages, form fields, request headers, cookies, query
strings, user identity, breadcrumbs and source context are removed. Reports
retain error type, release and compiled stack locations for grouping. Tracing,
replay, session collection, logs and performance instrumentation stay off.

The shared implementation lives in `@tale/ui/monitoring` and
`@tale/ui/server`. The `Release` workflow's `sites_only` option builds and tests
web/docs images without publishing platform images, CLI assets, a full Tale
release, or latest tags. Use a distinct version such as `0.5.15-sites.1`.
