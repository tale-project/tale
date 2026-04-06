import { join, resolve } from 'node:path';

import { convexMetricsResponse } from './convex-metrics';
import { createConfigWatcher } from './lib/config-watcher';
import { initTelemetry, metricsResponse } from './telemetry';

// ---------------------------------------------------------------------------
// Config file events (SSE)
//
// Watches TALE_CONFIG_DIR for .json changes via chokidar and pushes
// structured events to connected frontends so they can invalidate their
// TanStack Query caches without a full page reload.
// ---------------------------------------------------------------------------

const sseClients = new Set<ReadableStreamDefaultController>();

const configDir = process.env.TALE_CONFIG_DIR;
if (configDir) {
  const watcher = createConfigWatcher(configDir);
  watcher.onChange((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const controller of sseClients) {
      try {
        controller.enqueue(payload);
      } catch {
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
  SENTRY_DSN: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE: number;
  TALE_VERSION: string | undefined;
}

const port = process.env.PORT || 3000;
const distDir = join(import.meta.dir, 'dist');
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
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
    ),
    TALE_VERSION: process.env.TALE_VERSION,
  };
}

initTelemetry();

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    if (pathname === '/events/file') {
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
    }

    if (pathname === '/metrics') {
      return metricsResponse();
    }

    if (pathname === '/metrics/convex') {
      return convexMetricsResponse(url.searchParams.get('format'));
    }

    if (brandingImagesDir && pathname.startsWith('/branding/images/')) {
      const filename = pathname.slice('/branding/images/'.length);
      if (filename && !filename.includes('/') && !filename.includes('..')) {
        const filePath = resolve(brandingImagesDir, filename);
        if (filePath.startsWith(brandingImagesDir)) {
          const file = Bun.file(filePath);
          if (await file.exists()) {
            return new Response(file, {
              headers: {
                'Cache-Control': 'no-cache, must-revalidate',
              },
            });
          }
        }
      }
    }

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
        return new Response('Internal Server Error', { status: 500 });
      }
      indexHtmlTemplate = await indexFile.text();
    }

    const envConfig = getEnvConfig();
    const acceptLanguage = request.headers.get('accept-language') ?? '';
    const basePath = getBasePath();

    let html = indexHtmlTemplate
      .replace(
        /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
        `window.__ENV__ = ${JSON.stringify(envConfig)};`,
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
  },
});
