// Bun server: serves the prebuilt docs SPA from `./dist` and the
// precompiled SEO + LLM artifact set from `./dist-seo` via
// `createPrecompiledServer` (`@tale/ui/seo`). All artifacts were
// materialised in the Docker builder stage — the runtime image has no
// source markdown and never reads from `/docs`.
//
// Docs runs under an optional sub-path mount (Caddy can `handle_path /docs*`
// and strip the prefix) — `DOCS_BASE_URL` carries that public prefix so
// 302s emitted by the locale negotiator and the moved-slug 301s below stay
// inside `/docs`.
//
// Moved pages 301 to their new slug before static serving and locale
// negotiation; the old → new map lives in `lib/redirects.ts`.

import { resolve } from 'node:path';

import { createPrecompiledServer } from '@tale/ui/seo';
import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/ui/server';

import { resolveMovedPath } from './lib/redirects';

const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/+$/, '');

const artifacts = await createPrecompiledServer({
  dir: resolve(import.meta.dir, 'dist-seo'),
});

startReactServer({
  port: Number(process.env.PORT ?? 3002),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'docs',
  redirectPrefix: BASE_PATH,
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultReactServerSecurityHeaders,
  extraRoutes: (_request, url) => {
    const target = resolveMovedPath(url.pathname);
    if (!target) return null;
    return new Response(null, {
      status: 301,
      headers: { Location: BASE_PATH + target + url.search },
    });
  },
  artifacts,
});
