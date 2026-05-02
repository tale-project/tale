import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

import { type Connect, type Plugin } from 'vite';

import {
  buildCanvasPreviewCsp,
  wrapCanvasPreviewHtml,
} from '../lib/canvas-preview-shell';

// In dev, Vite is in front of the SPA — Hono is not in the request path.
// Without this middleware, `POST /canvas-preview` falls through to Vite's
// SPA fallback (404, then index.html for GETs). This serves the same
// response Hono serves in production.
export function serveCanvasPreview(): Plugin {
  // Read once at plugin init — restart vite to pick up changes, matching
  // how the rest of the dev server treats env. The same parsing rule as
  // `getEnvConfig()` in server.ts.
  const extraOrigins =
    process.env.CANVAS_PREVIEW_CSP_EXTRA_ORIGINS?.split(/\s+/).filter(
      (s) => s.length > 0,
    ) ?? [];
  const csp = buildCanvasPreviewCsp(extraOrigins);
  return {
    name: 'serve-canvas-preview',
    apply: 'serve',
    configureServer(server) {
      const publicDir = server.config.publicDir;
      const canvasLibsRoot = join(publicDir, 'canvas-libs');

      // /canvas-libs/* — bypass Vite's `rejectNoCorsRequestMiddleware`
      // (which returns a JS-error response for sec-fetch-mode=no-cors +
      // sec-fetch-site≠same-origin + sec-fetch-dest=script) so the
      // sandboxed canvas-preview iframe (sandbox="allow-scripts" → opaque
      // origin "null") can load these vendored, immutable assets via a
      // classic `<script>` / `<link>` tag. Production (Hono serveStatic)
      // doesn't enforce this check, so this middleware just brings dev
      // parity.
      //
      // `configureServer` hooks fire AFTER Vite's security middlewares are
      // registered (rejectInvalidRequest / rejectNoCorsRequest at
      // node.js:26232-26233, hooks at :26243), so a conventional
      // `server.middlewares.use(...)` would append us behind those — and
      // the no-cors block would still fire first. The fix is to prepend
      // directly to the connect stack. Pattern lifted from the
      // `{ route, handle }` shape `connect.proto.use` produces internally.
      const canvasLibsHandler: Connect.NextHandleFunction = (
        req,
        res,
        next,
      ) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (!req.url) return next();
        const reqPath = req.url.split('?')[0];
        if (!reqPath.startsWith('/canvas-libs/')) return next();

        const relPath = normalize(reqPath).replace(/^[/\\]+/, '');
        const filePath = join(publicDir, relPath);
        if (!filePath.startsWith(canvasLibsRoot + sep)) return next();

        let stat;
        try {
          stat = statSync(filePath);
        } catch {
          return next();
        }
        if (!stat.isFile()) return next();

        res.setHeader('Content-Type', mimeFor(extname(filePath)));
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = createReadStream(filePath);
        stream.on('error', (err) => {
          console.warn(`canvas-libs read error for ${filePath}:`, err);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        });
        stream.pipe(res);
      };
      server.middlewares.stack.unshift({
        route: '',
        handle: canvasLibsHandler,
      });

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
          res.setHeader('Content-Security-Policy', csp);
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

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
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
