// Bun server: serves the prebuilt SPA from ./dist + the shared simple-server
// pipeline (locale negotiation, static serving, health endpoint) from
// @tale/webui/server. Docs runs under an optional sub-path mount (Caddy can
// `handle_path /docs*` and strip the prefix) — `DOCS_BASE_URL` carries that
// public prefix so 302s emitted by the locale negotiator stay inside /docs.

import { resolve } from 'node:path';

import {
  defaultSimpleSecurityHeaders,
  startSimpleServer,
} from '@tale/webui/server';

const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/+$/, '');

startSimpleServer({
  port: Number(process.env.PORT ?? 3002),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'docs',
  redirectPrefix: BASE_PATH,
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultSimpleSecurityHeaders,
});
