/**
 * Vite dev-server plugin that mounts an {@link ArtifactsServer} into
 * Vite's middleware pipeline. Requests for any artifact URL (`/llms.txt`,
 * `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, `/<route>.md`) are
 * dispatched to the supplied server; misses fall through to the next
 * middleware.
 *
 * In production the same server is wired into `startReactServer` from
 * `@tale/webui/server`. Vite is an optional peer dependency.
 */

import type { Plugin } from 'vite';

import type { ArtifactsServer } from './serve-artifacts';

export interface ArtifactsPluginOptions {
  /** The server (built via `createArtifactsServer`). */
  server: ArtifactsServer;
}

export function artifactsPlugin(opts: ArtifactsPluginOptions): Plugin {
  const { server } = opts;
  return {
    name: 'tale-seo:artifacts',
    apply: 'serve',
    configureServer(viteServer) {
      viteServer.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '';
        const pathname = rawUrl.split('?')[0];
        if (!isArtifactPath(pathname)) return next();

        try {
          const proto = headerValue(req.headers['x-forwarded-proto']) ?? 'http';
          const host = headerValue(req.headers.host) ?? 'localhost';
          const headers = new Headers();
          const ifNoneMatch = headerValue(req.headers['if-none-match']);
          if (ifNoneMatch) headers.set('if-none-match', ifNoneMatch);
          const fakeRequest = new Request(`${proto}://${host}${rawUrl}`, {
            headers,
          });

          const response = await server.handle(fakeRequest);
          if (!response) return next();

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (response.status === 304 || response.body === null) {
            res.end();
            return;
          }
          res.end(await response.text());
        } catch (error) {
          console.error('[tale-seo:artifacts] handler failed:', error);
          next(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
  };
}

function isArtifactPath(pathname: string): boolean {
  if (pathname === '/llms.txt') return true;
  if (pathname === '/llms-full.txt') return true;
  if (pathname === '/sitemap.xml') return true;
  if (pathname === '/robots.txt') return true;
  if (pathname.endsWith('.md')) return true;
  return false;
}

/** Node IncomingHttpHeaders may surface a single string or `string[]` per header. */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
