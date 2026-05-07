// Bun server: serves the prebuilt SPA from ./dist and answers a few
// content-type-aware routes (.md endpoints, llms.txt, llms-full.txt,
// sitemap.xml, robots.txt) directly out of the static dist tree.

import { join, resolve, sep } from 'node:path';

import { file } from 'bun';

const PORT = Number(process.env.PORT ?? 3002);
const HOSTNAME = process.env.HOSTNAME ?? '0.0.0.0';
const DIST = resolve(import.meta.dir, 'dist');
const DIST_PREFIX = DIST + sep;

function contentTypeFor(path: string): string | null {
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (path === '/llms.txt' || path === '/llms-full.txt') {
    return 'text/plain; charset=utf-8';
  }
  if (path === '/robots.txt') return 'text/plain; charset=utf-8';
  if (path === '/sitemap.xml') return 'application/xml; charset=utf-8';
  return null;
}

Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({
        ok: true,
        version: process.env.TALE_VERSION ?? 'dev',
      });
    }

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const resolved = resolve(DIST, rel);
    if (resolved === DIST || resolved.startsWith(DIST_PREFIX)) {
      const candidate = file(resolved);
      if (await candidate.exists()) {
        const contentType = contentTypeFor(url.pathname);
        return new Response(candidate, {
          headers: contentType ? { 'content-type': contentType } : undefined,
        });
      }
      const routeHtml = file(join(resolved, 'index.html'));
      if (await routeHtml.exists()) {
        return new Response(routeHtml);
      }
    }
    return new Response(file(join(DIST, 'index.html')));
  },
});

console.log(`[docs] listening on :${PORT}`);
