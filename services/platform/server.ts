import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Hono } from 'hono';
import { NONCE, secureHeaders } from 'hono/secure-headers';

import { convexMetricsResponse } from './convex-metrics';
import {
  CANVAS_PREVIEW_CSP,
  wrapCanvasPreviewHtml,
} from './lib/canvas-preview-shell';
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

const fileEventsEnabled = process.env.TALE_FILE_EVENTS === 'true';
const configDir = process.env.TALE_CONFIG_DIR;
// Post-split (Phase 2): TALE_CONFIG_DIR points at the convex-data volume
// mounted read-only on the platform container (for config-file SSE + branding
// image serving). Skip watcher setup gracefully if the directory is absent.
if (fileEventsEnabled && configDir && existsSync(configDir)) {
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
  FILE_EVENTS_ENABLED: boolean;
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
    FILE_EVENTS_ENABLED: fileEventsEnabled,
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
// Policy: all runtime assets (scripts, styles, fonts, images) are served
// same-origin from the platform container. External origins MUST NOT be
// added to CSP without a GDPR (third-party data-transfer) + offline-
// availability review — self-deployed operators may run in air-gapped or
// EU-data-residency environments where any CDN fetch is either blocked or
// a non-contracted processor transfer. Libraries (PDF.js via pdfjs-dist),
// fonts (Inter via @fontsource), and anything previously loaded from
// cdnjs / fonts.g*.com / nominatim.openstreetmap.org are bundled or
// dropped for this reason.
//
// Current exceptions are gated by explicit operator opt-in:
//   - Sentry: origin is parsed from SENTRY_DSN (supports SaaS ingest and
//     self-hosted Sentry on custom domains). Only emitted when DSN is set.
//   - Figma MCP (`mcp.figma.com`): only when SITE_URL is a loopback host
//     (dev-only; production policy never includes it).
//
// All Convex traffic — including storage uploads via `generateUploadUrl()`
// and storage downloads — flows same-origin through Caddy (`/ws_api`,
// `/api/storage/*`), so `'self'` covers it without needing any
// `*.convex.cloud` / `*.convex.site` entries. SITE_URL hostname determines
// whether HSTS is emitted (only when the deployment is HTTPS).
// ---------------------------------------------------------------------------

function sentryOriginFromDsn(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.host}`;
  } catch (err) {
    console.warn('Invalid SENTRY_DSN, skipping CSP allow-list entry:', err);
    return null;
  }
}

function buildContentSecurityPolicy(env: EnvConfig) {
  const sentryOrigin = sentryOriginFromDsn(env.SENTRY_DSN);
  const sentry = sentryOrigin ? [sentryOrigin] : [];
  const figmaMcp = isLoopbackSite(env) ? ['https://mcp.figma.com'] : [];
  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      // `index.html` ships an inline `<script>` for the `__ENV__` runtime
      // injection (load-bearing — without it the SPA can't read SITE_URL)
      // plus, on loopback only, a Figma MCP capture loader. Inline scripts
      // are tagged with `nonce="…"` at HTML render time; this NONCE token
      // makes the matching `nonce-…` source appear in script-src.
      NONCE,
      "'self'",
      ...figmaMcp,
    ],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", ...sentry],
    workerSrc: ["'self'", 'blob:'],
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

function isLoopbackSite(env: EnvConfig): boolean {
  if (!env.SITE_URL) return false;
  try {
    const host = new URL(env.SITE_URL).hostname;
    // `URL` strips brackets from IPv6 hostnames, so compare against `::1`
    // rather than `[::1]`.
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function createApp(env: EnvConfig = getEnvConfig()): Hono {
  const app = new Hono();

  const secure = secureHeaders({
    contentSecurityPolicy: buildContentSecurityPolicy(env),
    // 180 days. No `includeSubDomains`, no `preload` — self-deployed
    // operators run on varied domains and don't own preload submission.
    strictTransportSecurity: isHttpsSite(env) ? 'max-age=15552000' : false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: {
      camera: [],
      microphone: ['self'],
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
  });
  // `secureHeaders` unconditionally rewrites `Content-Security-Policy`
  // after handlers run, so per-route permissive CSP cannot be set just by
  // header overrides. The Canvas preview shell needs its own permissive
  // CSP; bypass `secureHeaders` for that single path explicitly. Path
  // guard, not registration order — the latter is fragile to refactors.
  app.use('*', async (c, next) =>
    c.req.path === '/canvas-preview' ? next() : secure(c, next),
  );

  app.post('/canvas-preview', async (c) => {
    const body = await c.req.parseBody();
    const userHtml = typeof body.html === 'string' ? body.html : '';
    return new Response(wrapCanvasPreviewHtml(userHtml), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CANVAS_PREVIEW_CSP,
        'X-Frame-Options': 'SAMEORIGIN',
        // Per-request bespoke HTML — no caching.
        'Cache-Control': 'no-store',
      },
    });
  });

  app.get('/api/health', (c) => {
    if (existsSync(SHUTDOWN_MARKER)) {
      return c.json({ status: 'shutting_down' }, 503);
    }
    return c.json({ status: 'ok' });
  });

  app.get('/events/file', (c) => {
    if (!env.FILE_EVENTS_ENABLED) return c.notFound();

    let ctrl: ReadableStreamDefaultController;
    const stream = new ReadableStream({
      start(controller) {
        ctrl = controller;
        sseClients.add(ctrl);
        ctrl.enqueue('data: {"type":"connected"}\n\n');
      },
      cancel() {
        sseClients.delete(ctrl);
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
    // Per-request nonce produced by `secureHeaders` middleware. Injected
    // into every <script> tag so the strict CSP `script-src` (which uses
    // a nonce token instead of `'unsafe-inline'`) accepts the inline
    // __ENV__ injection and any other inline scripts in index.html.
    const nonce = c.get('secureHeadersNonce');

    let html = indexHtmlTemplate
      .replace(
        /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
        `window.__ENV__ = ${JSON.stringify(env)};`,
      )
      .replace(
        /window\.__ACCEPT_LANGUAGE__\s*=\s*['"]__ACCEPT_LANGUAGE_PLACEHOLDER__['"];/,
        `window.__ACCEPT_LANGUAGE__ = ${JSON.stringify(acceptLanguage)};`,
      );

    if (nonce) {
      html = html.replace(
        /<script(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`,
      );
    }

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
