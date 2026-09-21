// Bun server: serves the prebuilt SPA from `./dist` and the precompiled SEO +
// LLM artifact set from `./dist-seo` via `createPrecompiledServer`
// (`@tale/ui/seo`). Both were materialised in the Docker builder stage — the
// runtime image carries no markdown and never reads `content/` at request
// time.
//
// `UI_DOCS_BASE_URL` carries the public mount prefix so any redirect the
// shared server emits stays inside it.

import { resolve } from 'node:path';

import { initServerMonitoring } from '@tale/ui/monitoring/server';
import { createPrecompiledServer } from '@tale/ui/seo';
import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/ui/server';

const monitoring = initServerMonitoring({
  dsn: process.env.SENTRY_DSN,
  release: process.env.TALE_VERSION,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  service: 'tale-ui-docs',
});

const BASE_PATH = (process.env.UI_DOCS_BASE_URL ?? '/').replace(/\/+$/, '');

const artifacts = await createPrecompiledServer({
  dir: resolve(import.meta.dir, 'dist-seo'),
});

startReactServer({
  monitoring: monitoring.config,
  reportError: monitoring.capture,
  port: Number(process.env.PORT ?? 3003),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'ui-docs',
  redirectPrefix: BASE_PATH,
  // One English tree — `app/routes/` has no locale segment and the
  // prerenderer writes no `/de` or `/fr` artifact. Path negotiation would
  // send every German or French reader (and anyone carrying a `tale_locale`
  // cookie from tale.dev) to a page that does not exist.
  localeRouting: 'none',
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultReactServerSecurityHeaders,
  artifacts,
});
