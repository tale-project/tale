import { type Plugin } from 'vite';

import {
  CANVAS_PREVIEW_CSP,
  wrapCanvasPreviewHtml,
} from '../lib/canvas-preview-shell';

// In dev, Vite is in front of the SPA — Hono is not in the request path.
// Without this middleware, `POST /canvas-preview` falls through to Vite's
// SPA fallback (404, then index.html for GETs). This serves the same
// response Hono serves in production.
export function serveCanvasPreview(): Plugin {
  return {
    name: 'serve-canvas-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        if (!req.url) {
          next();
          return;
        }
        const path = req.url.split('?')[0];
        if (path !== '/canvas-preview') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const userHtml = parseHtmlField(raw);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Security-Policy', CANVAS_PREVIEW_CSP);
          res.setHeader('X-Frame-Options', 'SAMEORIGIN');
          res.setHeader('Cache-Control', 'no-store');
          res.end(wrapCanvasPreviewHtml(userHtml));
        });
        req.on('error', (err) => {
          console.warn('canvas-preview body read error', err);
          res.statusCode = 400;
          res.end();
        });
      });
    },
  };
}

function parseHtmlField(body: string): string {
  // `application/x-www-form-urlencoded` from a `<form>` submission. We
  // don't need a generic parser — just the `html` field.
  for (const pair of body.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
    if (key !== 'html') continue;
    return decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
  }
  return '';
}
