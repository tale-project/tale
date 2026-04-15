import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import { convexMetricsResponse } from './convex-metrics';
import { createConfigWatcher } from './lib/config-watcher';
import { initTelemetry, metricsResponse } from './telemetry';

// Platform graceful shutdown marker (written by docker-entrypoint.sh trap).
// When present, /api/health returns 503 so Caddy/Docker drain traffic before
// the process actually terminates.
const SHUTDOWN_MARKER = '/tmp/platform-shutting-down';

// ---------------------------------------------------------------------------
// Config file events (SSE)
//
// Watches TALE_CONFIG_DIR for .json changes via chokidar and pushes
// structured events to connected frontends so they can invalidate their
// TanStack Query caches without a full page reload.
// ---------------------------------------------------------------------------

const sseClients = new Set<ReadableStreamDefaultController>();

const configDir = process.env.TALE_CONFIG_DIR;
// Post-split (Phase 2): TALE_CONFIG_DIR points at the convex-data volume
// mounted read-only on the platform container (for config-file SSE + branding
// image serving). Skip watcher setup gracefully if the directory is absent.
if (configDir && existsSync(configDir)) {
  const watcher = createConfigWatcher(configDir);
  watcher.onChange((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const controller of sseClients) {
      try {
        controller.enqueue(payload);
      } catch (err) {
        console.warn('SSE enqueue failed; dropping client', err);
        sseClients.delete(controller);
      }
    }
  });
  console.log(`Config file watcher active: ${configDir}`);
}

// ---------------------------------------------------------------------------

function escapeHtmlAttr(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

interface EnvConfig {
  SITE_URL: string | undefined;
  BASE_PATH: string;
  MICROSOFT_AUTH_ENABLED: boolean;
  TRUSTED_HEADERS_ENABLED: boolean;
  SENTRY_DSN: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE: number;
  TALE_VERSION: string | undefined;
}

const port = process.env.PORT || 3000;
const moduleDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(moduleDir, 'dist');
const brandingImagesDir = process.env.TALE_CONFIG_DIR
  ? join(process.env.TALE_CONFIG_DIR, 'branding', 'images')
  : null;

function getBasePath(): string {
  const basePath = process.env.BASE_PATH ?? '';
  return basePath.replace(/\/$/, '');
}

let indexHtmlTemplate: string | null = null;

function getEnvConfig(): EnvConfig {
  return {
    SITE_URL: process.env.SITE_URL,
    BASE_PATH: getBasePath(),
    MICROSOFT_AUTH_ENABLED: !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    TRUSTED_HEADERS_ENABLED: process.env.TRUSTED_HEADERS_ENABLED === 'true',
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
    ),
    TALE_VERSION: process.env.TALE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Security headers
//
// CSP is built from env vars at app construction time. SITE_URL hostname
// determines whether HSTS is emitted (only when the deployment is HTTPS).
// External origins reflect the few third-party resources actually loaded
// today: cdnjs (PDF.js), Google Fonts, Sentry (when SENTRY_DSN is set), and
// Convex storage. Most Convex traffic is proxied same-origin via Caddy, but
// `*.convex.cloud` is allowed defensively for storage URLs that bypass the
// proxy.
// ---------------------------------------------------------------------------

function buildContentSecurityPolicy(env: EnvConfig) {
  const sentry = env.SENTRY_DSN ? ['https://*.ingest.sentry.io'] : [];
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      'https://*.convex.cloud',
      'https://*.convex.site',
    ],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    connectSrc: ["'self'", 'https://*.convex.cloud', ...sentry],
    workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
    frameSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'none'"],
  };
}

function isHttpsSite(env: EnvConfig): boolean {
  return !!env.SITE_URL && env.SITE_URL.startsWith('https://');
}

export function createApp(env: EnvConfig = getEnvConfig()): Hono {
  const app = new Hono();

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: buildContentSecurityPolicy(env),
      // 180 days. No `includeSubDomains`, no `preload` — self-deployed
      // operators run on varied domains and don't own preload submission.
      strictTransportSecurity: isHttpsSite(env) ? 'max-age=15552000' : false,
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: {
        camera: [],
        microphone: [],
        // Active features: location-request approval card uses geolocation;
        // copy-to-clipboard hook is wired into many UI surfaces.
        geolocation: ['self'],
        clipboardWrite: ['self'],
        clipboardRead: [],
        usb: [],
        payment: [],
        bluetooth: [],
        midi: [],
        hid: [],
        serial: [],
      },
      // Defaults that would interfere with same-origin embeds and OAuth
      // popups; we explicitly lean on CSP `frame-ancestors` and
      // `frame-src` instead.
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  app.get('/api/health', (c) => {
    if (existsSync(SHUTDOWN_MARKER)) {
      return c.json({ status: 'shutting_down' }, 503);
    }
    return c.json({ status: 'ok' });
  });

  app.get('/events/file', () => {
    const stream = new ReadableStream({
      start(controller) {
        sseClients.add(controller);
        controller.enqueue('data: {"type":"connected"}\n\n');
      },
      cancel(controller) {
        sseClients.delete(controller);
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  });

  app.get('/metrics', () => metricsResponse());

  app.get('/metrics/convex', (c) =>
    convexMetricsResponse(c.req.query('format') ?? null),
  );

  app.get('/branding/images/:filename', async (c) => {
    if (!brandingImagesDir) return c.notFound();
    const filename = c.req.param('filename');
    if (!filename || filename.includes('/') || filename.includes('..')) {
      return c.notFound();
    }
    const filePath = resolve(brandingImagesDir, filename);
    if (!filePath.startsWith(brandingImagesDir)) return c.notFound();
    const file = Bun.file(filePath);
    if (!(await file.exists())) return c.notFound();
    return new Response(file, {
      headers: { 'Cache-Control': 'no-cache, must-revalidate' },
    });
  });

  // Static files + index.html fallback (TanStack Router SPA).
  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;

    if (pathname !== '/') {
      const filePath = resolve(distDir, pathname.slice(1));
      if (filePath.startsWith(distDir)) {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      }
    }

    if (!indexHtmlTemplate) {
      const indexFile = Bun.file(join(distDir, 'index.html'));
      if (!(await indexFile.exists())) {
        console.error(`Missing dist/index.html in ${distDir}`);
        return c.text('Internal Server Error', 500);
      }
      indexHtmlTemplate = await indexFile.text();
    }

    const acceptLanguage = c.req.header('accept-language') ?? '';
    const basePath = getBasePath();

    let html = indexHtmlTemplate
      .replace(
        /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
        `window.__ENV__ = ${JSON.stringify(env)};`,
      )
      .replace(
        /window\.__ACCEPT_LANGUAGE__\s*=\s*['"]__ACCEPT_LANGUAGE_PLACEHOLDER__['"];/,
        `window.__ACCEPT_LANGUAGE__ = ${JSON.stringify(acceptLanguage)};`,
      );

    html = html.replace(
      '<head>',
      `<head>\n    <base href="${escapeHtmlAttr(basePath)}/">`,
    );

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  });

  return app;
}

if (import.meta.main) {
  initTelemetry();
  const app = createApp();
  Bun.serve({
    port,
    hostname: '0.0.0.0',
    fetch: app.fetch,
  });
}
