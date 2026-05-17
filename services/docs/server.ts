// Bun server: serves the prebuilt docs SPA from `./dist` and the
// precompiled SEO + LLM artifact set from `./dist-seo` via
// `createPrecompiledServer` (`@tale/seo`). All artifacts were
// materialised in the Docker builder stage — the runtime image has no
// source markdown and never reads from `/docs`.
//
// Docs runs under an optional sub-path mount (Caddy can `handle_path /docs*`
// and strip the prefix) — `DOCS_BASE_URL` carries that public prefix so
// 302s emitted by the locale negotiator stay inside `/docs`.

import { resolve } from 'node:path';

import { createPrecompiledServer } from '@tale/seo';
import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/webui/server';

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
  artifacts,
});
