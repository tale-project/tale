# @tale/web

The public marketing site, including product pages, comparisons, use cases, pricing, contact forms, and the changelog.
Run these commands from the repository root after installing dependencies:

```bash
bun run --filter @tale/web dev       # Vite dev server on :3001
bun run --filter @tale/web build     # client + SSR bundle, then prerender routes to static HTML
bun run --filter @tale/web typecheck
bun run --filter @tale/web test
```

The site uses Vite, TanStack Router, React 19, Tailwind v4, and
[`@tale/marketing-ui`](../../packages/marketing-ui/README.md) on top of `@tale/ui`.
`app/globals.css` imports the marketing stylesheet, which includes the shared UI styles.

Page copy, routes, calls to action, product registries, and demo scenarios stay in this service.
`app/components/marketing/index.ts` binds shared components to the typed route table;
`app/routes/__root.tsx` mounts `MarketingRouterProvider`; `lib/i18n/i18n.ts` merges both package
catalogs beneath the service’s labels. Reuse those components when changing a page.

The homepage pairs its introduction with an actual project task, then presents two product chapters:
planning and agent sandbox work. Four compact destinations cover review, knowledge, automations,
and chat; a contrasting deployment section explains hosting, security, and the MIT license.
`RelatedUseCases` uses the same localized editorial selections as the platform overview.
Agent and connector names remain visible without an animated marquee. Marketing entrances
and demo timelines respond to reduced-motion preference changes without a reload.

Legal pages are excluded from the sitemap and emit `noindex,nofollow`. Keep them crawlable in
`robots.txt` so search engines can read that instruction; API and search endpoints remain blocked.

The homepage and each platform page lead with different real product captures from the
documentation screenshot pipeline, captured in English, German, and French.
`app/content/product-screenshots.ts` owns the source selection and framing. Generate
the captures and committed responsive AVIF/WebP derivatives with the platform and mock gateway
running, following the [capture runbook](../platform/tests/docs-screenshots/README.md):

```bash
bun run web:screenshots
```

To rebuild derivatives from already reviewed captures:

```bash
bun run --filter @tale/web optimize-images --product-screens
```

`ProductScreenshot` serves focused phone crops and larger desktop versions with intrinsic image
sizes. The interface, captions, and alternative text follow the page locale; Swiss German uses
the German capture. Full-screen links open the complete high-resolution capture. The shared
capture runner records locale, viewport, route, and dimensions; never recreate or retouch product
state. Supporting animated tours retain the shared demo timeline and complete reduced-motion state.
Company, pricing, hardware, contact, demo, changelog, and guide pages have their own supporting art.
The optimizer preserves dimensions and adjusts encoding quality only when needed for the 200 KiB
asset budget. If a capture cannot fit at the quality floor, it names the asset and stops so its
source or framing can be reviewed.

The eight product heroes also have individual native interactions in English, German, and French,
including separate phone takes. Silent WebM clips use an H.264 MP4 fallback and matching native
first-frame posters from the same image optimizer. Reduced motion and unplayable media retain
the static capture. Playback has localized pause and resume controls;
the full-resolution screenshot link remains available. If autoplay is blocked or the browser
interrupts playback to save power, the poster and Play control remain available for a user retry.

```bash
bun run web:animations -- --state-dir /absolute/path/to/isolated-capture-state --config-dir /absolute/path/to/platform/config
bun run web:animations:verify
```

Follow the [motion capture runbook](../platform/tests/docs-screenshots/README.md#record-the-marketing-product-in-action)
for prerequisites, targeted refreshes, cleanup, and review. Compact runtime factories derive asset
paths and geometry; full hash-bound provenance stays in `public/marketing/product-motion/manifest.json`.
The verify command checks all native codecs and changed action frames. Browser playback and
visual review still decide whether each interaction is readable and useful.

Contact and demo forms share server/client validation rules. Schema issues use stable identifiers;
the presentation resolves specific guidance in the current language. Text is cleaned before
validation, optional phone numbers require digits, and consent errors describe and focus the
checkbox. The privacy-policy link follows the form's locale.

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
  the newest 40 releases to `app/generated/releases-manifest.ts`, matching
  the page's visible history. The prerendered HTML and SEO/LLM artifacts use
  this snapshot; it also provides the cold-start and offline feed fallback.
- **Runtime feed** — `GET /api/releases` (`lib/releases/feed.ts`) re-fetches
  the full two-page list on a 30-minute TTL and the page swaps it in after
  hydration, still displaying only the newest 40 releases. `GET /changelog.json` serves the same
  cache outside the `/api/` robots exclusion, with complete release bodies, `source` and `fetchedAt`.
  Each localized changelog advertises it as an alternate representation; `llms.txt` links to it.
  Readers that do not run JavaScript can use this endpoint for current notes.

Both layers are needed: release images are built _before_ the release workflow
publishes the GitHub release, so a snapshot alone is always at least one
release behind. Reads never block on GitHub — a failed refresh keeps the last
good list (or the snapshot) and backs off. Both JSON routes cache responses for five minutes.
`/api/health` exposes `checks.releases` with the source, fetch time and age in seconds. After six
hours without fresh data its `ok` becomes false, and a failed refresh reports one monitoring
error per stale episode. A server that starts on an older snapshot reports only after it has
itself gone six hours without a successful refresh, so one failed refresh after a deploy is not
an error. Release freshness is advisory: it does not make site readiness fail.
A successful refresh resets the report so a later outage can be detected.

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
web, docs, and ui-docs images without publishing platform images, CLI assets, a full Tale
release, or latest tags. Use a distinct version such as `0.5.15-sites.1`.

## Change content and verify it

Routes and page components live in `app/`; translated copy lives in `messages/`.
Follow the repository's translation skill when changing English, German, or French content.
Reuse `@tale/marketing-ui` components and the [design contract](../../design/docs/README.md) for visual changes.

Run the workspace lint, type, and unit checks, then build before testing prerendered output:

```bash
bun run --filter @tale/web lint
bun run --filter @tale/web build
bun run --filter @tale/web test:prerender
bun run --filter @tale/web test:e2e
```

`test:e2e` builds its local preview by default. To reuse a complete build, build
first and set the optional Playwright setting `E2E_USE_BUILD=1`:

```bash
bunx turbo run build --filter=@tale/web
E2E_USE_BUILD=1 bun run --filter @tale/web test:e2e
```

CI sets this flag after its build. Leave it unset or use `0` for the normal local
E2E build.

Use the [manual test guide](tests/manual/readme.md) for layout, keyboard, responsive, and degraded
mode checks. A successful build does not verify that production contact forms can deliver a message.

## Comparison and use-case guides

Localized Markdown lives in `app/content/comparisons/{en,de,fr}` and
`app/content/use-cases/{en,de,fr}`. The shared content registry validates frontmatter, pairs locales,
and feeds route discovery, prerendering, canonicals, language alternates, sitemap and LLM artifacts.
A page appears publicly only when all three locale variants are published.

New content starts with `draft: true`. Set the build-time variable
`VITE_MARKETING_CONTENT_PREVIEW=true` when running `dev` to inspect drafts with noindex metadata;
production builds ignore this preview flag. Follow the
[content contract](app/content/comparisons/README.md) before publishing. Bodies load individually
as Markdown assets, while navigation and related cards use metadata only.

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

Contact and demo submission successes emit `contact-submitted` and
`demo-request-submitted`; rejected submissions and form contents are never sent.

## Shared public-site entry points

`/ui` redirects permanently to `https://ui.tale.dev`; locale-prefixed aliases do
so too. The server, client routes and static redirect stubs agree, and the
aliases stay out of the sitemap. The footer’s Tale UI link opens that guide.
The copyright and licence footnote comes from `@tale/ui/use-site-copyright`,
shared with both documentation sites in EN/DE/FR.

Both the client and SSR router set `NotFoundPage` as the default, including
unknown localized and nested URLs. The recovery page keeps site chrome,
localized links and noindex metadata.

`ConnectAgents` reserves all agent rows, status dots and aligned column widths
before playback starts. Rows reveal through opacity, so the Agents & connectors
illustration and its scenario variants keep their geometry as each beat appears.

`SandboxWorkspace` reserves the chat messages and side pane before playback. Its files/code and live preview share one fixed pane and crossfade; opening the preview does not reposition the explorer, chat or tabs.
