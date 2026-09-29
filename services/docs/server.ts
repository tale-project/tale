// Bun server: serves the prebuilt docs SPA from `./dist` and the
// precompiled SEO + LLM artifact set from `./dist-seo` via
// `createPrecompiledServer` (`@tale/ui/seo`). All artifacts were
// materialised in the Docker builder stage — the runtime image has no
// source markdown and never reads from `/docs`.
//
// Docs runs under an optional sub-path mount (Caddy can `handle_path /docs*`
// and strip the prefix) — `DOCS_BASE_URL` carries that public prefix so
// 302s emitted by the locale negotiator stay inside `/docs`.

import { resolve } from 'node:path';

import { initServerMonitoring } from '@tale/ui/monitoring/server';
import { createPrecompiledServer } from '@tale/ui/seo';
import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/ui/server';

import { createRedirectRoute } from './lib/redirect-route';
import { buildRedirectPathMap } from './lib/redirects';

const monitoring = initServerMonitoring({
  dsn: process.env.SENTRY_DSN,
  release: process.env.TALE_VERSION,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  service: 'tale-docs',
});

const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/+$/, '');
const LOCALE_COOKIE_DOMAIN = process.env.LOCALE_COOKIE_DOMAIN || undefined;

const artifacts = await createPrecompiledServer({
  dir: resolve(import.meta.dir, 'dist-seo'),
});

// Old → new URL paths for moved or merged pages (`docs/redirects.json`)
// and for section folders without a page of their own (derived from
// `docs/nav.json`), baked into the bundle at build time. Checked before
// static serving so stale or guessed links 301 to a real page; an `/en`
// page alias also pins the English locale cookie.
const redirectPaths = buildRedirectPathMap();

startReactServer({
  monitoring: monitoring.config,
  reportError: monitoring.capture,
  port: Number(process.env.PORT ?? 3002),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'docs',
  localeCookieDomain: LOCALE_COOKIE_DOMAIN,
  redirectPrefix: BASE_PATH,
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultReactServerSecurityHeaders,
  extraRoutes: createRedirectRoute({
    paths: redirectPaths,
    basePath: BASE_PATH,
    localeCookieDomain: LOCALE_COOKIE_DOMAIN,
  }),
  artifacts,
});
