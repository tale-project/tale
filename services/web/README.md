# @tale/web

Tale marketing site

```bash
bun run --filter @tale/web dev       # Vite dev server on :3001
bun run --filter @tale/web build     # client + SSR bundle, then prerender routes to static HTML
bun run --filter @tale/web typecheck
bun run --filter @tale/web test
```

Stack: Vite · TanStack Router · React 19 · Tailwind v4 (extends `@tale/ui/tailwind-preset`) · framer-motion · Zod · Vitest.

## Configuration

All config is read from `process.env` — no `.env` is required, defaults work out
of the box. Set these at deploy time (compose, systemd, K8s), or via a local
`.env` if you prefer:

- `PORT` — HTTP listen port (default `3001`; the Dockerfile already sets it).
- `WEB_DISCORD_WEBHOOK_URL` — enables the Contact / Request Demo forms
  (`/api/forms/submit` forwards a Discord embed here). If unset, the endpoint
  returns `503` and the forms are disabled. Create one in Discord via Server
  Settings → Connectors → Webhooks → New Webhook.
- `WEB_FORMS_REQUIRED` — when `true`, `/api/health` returns `503` if
  `WEB_DISCORD_WEBHOOK_URL` is unset so deploy health checks catch the
  misconfiguration before users do. Recommended for production tale.dev.
- `GITHUB_TOKEN` / `GH_TOKEN` — optional, build-time only: raises the GitHub
  API rate limit for `fetch-releases`. The runtime release feed is always
  unauthenticated, so no deployment needs a token.

## Changelog data

`/changelog` renders two layers of the same GitHub Releases list:

- **Build-time snapshot** — `fetch-releases` writes
  `app/generated/releases-manifest.ts`, which the prerendered HTML and the
  SEO/LLM artifacts embed. This is also the offline fallback.
- **Runtime feed** — `GET /api/releases` (`lib/releases/feed.ts`) re-fetches
  the list on a 30-minute TTL and the page swaps it in after hydration.

Both layers are needed: release images are built _before_ the release workflow
publishes the GitHub release, so a snapshot alone is always at least one
release behind. Reads never block on GitHub — a failed refresh keeps the last
good list (or the snapshot) and backs off.

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

## Optional aggregate analytics

Set `UMAMI_URL`, `UMAMI_WEBSITE_ID` and server-only `UMAMI_PROXY_TOKEN` at runtime
to enable Umami. Leave the website ID empty to disable it. The shared
`@tale/ui/analytics` implementation loads the upstream tracker through `/_a/script.js`
and sends curated pageviews through `/_a/api/send`; existing same-origin CSP stays intact.
Subpath deployments prefix those browser URLs with their configured base path.

The collector origin must expose authenticated `GET /_collect/script.js` and
`POST /_collect/api/send`, accepting the bearer token. Edge Caddy must overwrite
`X-Analytics-Client-IP` from its trusted client address; application ports must stay
private. The proxy forwards only that validated IP, browser User-Agent and Umami
session headers. It drops cookies, browser credentials and referrer headers.

See the [environment reference](../../docs/en/self-hosted/configuration/environment-reference.md)
and [observability guide](../../docs/en/self-hosted/configuration/observability-config.md)
for collected fields and opt-outs. Tracking requires the production Bun server;
the Vite development server does not inject deployment configuration.

Contact and demo submission successes emit `contact-submitted` and
`demo-request-submitted`; rejected submissions and form contents are never sent.
