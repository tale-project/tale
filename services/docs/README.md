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
