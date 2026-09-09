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

## Configuration

All config is read from `process.env` — no `.env` is required, defaults work out
of the box:

- `PORT` — HTTP listen port (default `3002`; the Dockerfile already sets it).
- `DOCS_BASE_URL` — base path the site is served under (default `/`); set it
  when hosting the docs under a sub-path.

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
