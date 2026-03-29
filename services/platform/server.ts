import { watch } from 'node:fs';
import { join, resolve } from 'node:path';

import { convexMetricsResponse } from './convex-metrics';
import { initTelemetry, metricsResponse } from './telemetry';

// ---------------------------------------------------------------------------
// Live reload (dev only, gated by LIVE_RELOAD env var)
// ---------------------------------------------------------------------------

const liveReloadEnabled = process.env.LIVE_RELOAD === 'true';
const sseClients = new Set<ReadableStreamDefaultController>();

if (liveReloadEnabled) {
  const watchDirs = [
    process.env.AGENTS_DIR,
    process.env.WORKFLOWS_DIR,
    process.env.INTEGRATIONS_DIR,
  ].filter((d): d is string => Boolean(d));

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function notifyClients() {
    for (const controller of sseClients) {
      try {
        controller.enqueue('data: reload\n\n');
      } catch {
        sseClients.delete(controller);
      }
    }
  }

  for (const dir of watchDirs) {
    try {
      watch(dir, { recursive: true }, (_event, filename) => {
        if (typeof filename === 'string' && filename.endsWith('.json')) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(notifyClients, 100);
        }
      });
    } catch {
      // Directory may not exist yet — skip silently
    }
  }

  console.log(`Live reload watching: ${watchDirs.join(', ')}`);
}

const LIVE_RELOAD_SCRIPT = `<script>(() => {
  const es = new EventSource('/__dev/live-reload');
  es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
})()</script>`;

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

    if (liveReloadEnabled && pathname === '/__dev/live-reload') {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          controller.enqueue('data: connected\n\n');
        },
        cancel(controller) {
          sseClients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    if (pathname === '/metrics') {
      return metricsResponse();
    }

    if (pathname === '/metrics/convex') {
      return convexMetricsResponse(url.searchParams.get('format'));
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

    if (liveReloadEnabled) {
      html = html.replace('</body>', `${LIVE_RELOAD_SCRIPT}\n</body>`);
    }

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  },
});

console.log(`Server running on http://0.0.0.0:${port}`);
