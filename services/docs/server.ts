// Bun server: serves the prebuilt docs SPA from `./dist` and mounts the
// on-demand SEO + LLM artifact server from `@tale/seo`. Docs ships source
// markdown for every page; the artifact server reads bodies directly from
// disk (no SSR needed).
//
// Docs runs under an optional sub-path mount (Caddy can `handle_path /docs*`
// and strip the prefix) — `DOCS_BASE_URL` carries that public prefix so
// 302s emitted by the locale negotiator stay inside `/docs`.

import { resolve } from 'node:path';

import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/webui/server';

import { createDocsArtifactsServer } from './lib/seo/artifacts-server';

const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/+$/, '');

const artifacts = await createDocsArtifactsServer();

startReactServer({
  port: Number(process.env.PORT ?? 3002),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'docs',
  redirectPrefix: BASE_PATH,
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultReactServerSecurityHeaders,
  artifacts,
});
