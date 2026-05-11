import type { ServerResponse } from 'node:http';

import { type Plugin } from 'vite';

import {
  buildStatusFeed,
  probeServices,
  renderStatusJson,
  renderStatusPage,
} from '../status-probe';

// In dev, Vite (not Hono) sits in front of the SPA. The production
// `app.get('/status', ...)` and `app.get('/status.json', ...)` handlers
// in server.ts are therefore not in the request path, and these routes
// fall through to Vite's SPA index, which returns 404 for unknown
// routes. This middleware mirrors the production handlers so the same
// responses are served during `bun run dev`.
//
// Pattern: same as serve-canvas-preview.ts / serve-branding-images.ts —
// both Hono routes need a Vite dev shim because Vite owns request handling
// in dev.
export function serveStatus(): Plugin {
  return {
    name: 'serve-status',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!req.url) return next();
        const path = req.url.split('?')[0];
        if (path !== '/status' && path !== '/status.json') return next();

        const acceptLanguage =
          (Array.isArray(req.headers['accept-language'])
            ? req.headers['accept-language'][0]
            : req.headers['accept-language']) ?? '';
        // Fire-and-forget — handler always terminates the response and
        // never delegates to `next()`, so this can't double-respond.
        // Errors are caught and rendered as 500.
        void handleStatus(res, path, acceptLanguage, req.method);
      });
    },
  };
}

async function handleStatus(
  res: ServerResponse,
  path: '/status' | '/status.json',
  acceptLanguage: string,
  method: string | undefined,
): Promise<void> {
  try {
    const feed = buildStatusFeed(await probeServices());
    const isJson = path === '/status.json';
    const body = isJson
      ? renderStatusJson(feed)
      : renderStatusPage(feed, acceptLanguage);
    res.setHeader(
      'Content-Type',
      isJson ? 'application/json' : 'text/html; charset=utf-8',
    );
    res.setHeader('Cache-Control', 'public, max-age=5');
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
  } catch (err) {
    console.warn('[serve-status] probe failed', err);
    res.statusCode = 500;
    res.end();
  }
}
