import { type Connect, type Plugin } from 'vite';

import { nodeAdapter } from '../lib/webdav/adapters/node';
import { makeWebdavCtx } from '../lib/webdav/ctx';
import { ensureWebdavHmacKey } from '../lib/webdav/hmac-key';

// Dev-time mirror of the Hono /dav/* route in server.ts. Without this,
// `bun dev` (Vite) returns the SPA index.html for any /dav/* path since
// the catchall sees PROPFIND/GET/PUT as just "another path".
//
// The handler logic itself lives in `lib/webdav/` and is shared with
// the production Hono server byte-for-byte — only the request-shape
// adapter differs.
export function serveWebdav(): Plugin {
  return {
    name: 'serve-webdav',
    apply: 'serve',
    configureServer(server) {
      const adminKey = process.env.ADMIN_KEY;
      const convexUrl = process.env.CONVEX_URL ?? 'http://127.0.0.1:3210';
      // Mirror the prod boot path: derive WEBDAV_APP_PASSWORD_HMAC_KEY from
      // INSTANCE_SECRET so the platform-side verify (lib/webdav/auth.ts) has a
      // key in dev without an explicit step. NOTE: the Convex deployment that
      // HASHES app-passwords at creation also needs this key — in prod
      // docker-entrypoint pushes it via `convex env set`; in dev run once:
      //   bunx convex env set WEBDAV_APP_PASSWORD_HMAC_KEY <derived> \
      //     --url $CONVEX_URL --admin-key $ADMIN_KEY
      // (see services/platform/.env.local docs). Setting process.env here does
      // not propagate to the local Convex backend.
      const hmacKey = ensureWebdavHmacKey();
      if (!adminKey) {
        // Don't crash the dev server — just disable the route. Operator
        // setting up WebDAV locally will see the warning on first hit.
        console.warn(
          '[serve-webdav] ADMIN_KEY unset; /dav/* will return 503 in dev.',
        );
      }
      if (adminKey && !hmacKey) {
        console.warn(
          '[serve-webdav] WEBDAV_APP_PASSWORD_HMAC_KEY unset and INSTANCE_SECRET missing; /dav/* auth will 500 in dev.',
        );
      }
      const ctx = adminKey
        ? makeWebdavCtx({
            convexUrl,
            adminKey,
            // Same GET storage-proxy escape hatch as the prod server.
            convexSiteUrl: process.env.WEBDAV_CONVEX_SITE_URL || undefined,
          })
        : null;

      // Prepend to the middleware stack so it runs BEFORE Vite's SPA
      // catchall — same trick used by serve-canvas-preview.ts for the
      // canvas-libs handler.
      const handler: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url?.startsWith('/dav/') && req.url !== '/dav') return next();
        if (!ctx) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(
            'WebDAV disabled in dev — set ADMIN_KEY in services/platform/.env.local',
          );
          return;
        }
        nodeAdapter(req, res, ctx).catch((err) => {
          console.error('[serve-webdav] adapter failed', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal error');
          }
        });
      };
      server.middlewares.stack.unshift({ route: '', handle: handler });
    },
  };
}
