import type { ServerResponse } from 'node:http';

import { type Plugin } from 'vite';

import { probeServices, renderStatusPage } from '../status-probe';

// In dev, Vite (not Hono) sits in front of the SPA. The production
// `app.get('/status', ...)` handler in server.ts is therefore not in the
// request path, and /status falls through to Vite's SPA index, which
// returns 404 for unknown routes. This middleware mirrors the production
// handler so the same response is served during `bun run dev`.
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
        if (path !== '/status') return next();

        const acceptLanguage =
          (Array.isArray(req.headers['accept-language'])
            ? req.headers['accept-language'][0]
            : req.headers['accept-language']) ?? '';
        // Fire-and-forget — handler always terminates the response and
        // never delegates to `next()`, so this can't double-respond.
        // Errors are caught and rendered as 500.
        void handleStatus(res, acceptLanguage, req.method);
      });
    },
  };
}

async function handleStatus(
  res: ServerResponse,
  acceptLanguage: string,
  method: string | undefined,
): Promise<void> {
  try {
    const result = await probeServices();
    const html = renderStatusPage(result, acceptLanguage);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=5');
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(html);
  } catch (err) {
    console.warn('[serve-status] probe failed', err);
    res.statusCode = 500;
    res.end();
  }
}
