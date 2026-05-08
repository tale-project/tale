// Bun server: serves the prebuilt SPA from ./dist and answers a few
// content-type-aware routes (.md endpoints, llms.txt, llms-full.txt,
// sitemap.xml, robots.txt) directly out of the static dist tree. Runs the
// shared locale middleware so first-time visitors with `Accept-Language: de`
// or `fr` get redirected to `/de/...` or `/fr/...` and a `tale_locale`
// cookie is set / refreshed.

import { join, resolve, sep } from 'node:path';

import { serializeLocaleCookie } from '@tale/i18n/cookie';
import {
  negotiatePathLocale,
  type NegotiatePathLocaleResult,
} from '@tale/i18n/negotiate';
import { file } from 'bun';

const PORT = Number(process.env.PORT ?? 3002);
const HOSTNAME = process.env.HOSTNAME ?? '0.0.0.0';
const DIST = resolve(import.meta.dir, 'dist');
const DIST_PREFIX = DIST + sep;
const LOCALE_COOKIE_DOMAIN = process.env.LOCALE_COOKIE_DOMAIN || undefined;
// When mounted under a sub-path by the front proxy (e.g. Caddy's
// `handle_path /docs*` strips `/docs` before proxying), redirects emitted
// by this server are origin-relative — `Location: /de` lands on the web
// site, not /docs/de. `BASE_PATH` is the public mount prefix; we prepend
// it to the negotiator's redirect target so the browser stays inside
// /docs. Empty (default) when served at the origin root.
const BASE_PATH = (process.env.DOCS_BASE_URL ?? '/').replace(/\/+$/, '');

function contentTypeFor(path: string): string | null {
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (path === '/llms.txt' || path === '/llms-full.txt') {
    return 'text/plain; charset=utf-8';
  }
  if (path === '/robots.txt') return 'text/plain; charset=utf-8';
  if (path === '/sitemap.xml') return 'application/xml; charset=utf-8';
  return null;
}

function isSecureRequest(request: Request): boolean {
  if (request.url.startsWith('https://')) return true;
  return request.headers.get('x-forwarded-proto') === 'https';
}

function applyLocaleResponseHeaders(
  response: Response,
  negotiation: NegotiatePathLocaleResult,
  request: Request,
): Response {
  if (negotiation.skip) return response;
  if (negotiation.setCookieValue) {
    response.headers.append(
      'Set-Cookie',
      serializeLocaleCookie({
        value: negotiation.setCookieValue,
        domain: LOCALE_COOKIE_DOMAIN,
        secure: isSecureRequest(request),
      }),
    );
  }
  response.headers.append('Vary', 'Accept-Language, Cookie');
  return response;
}

async function serveStatic(pathname: string): Promise<Response> {
  // Malformed percent-encodings (e.g. `/%E0%A4%A`) make decodeURIComponent
  // throw — fall back to the SPA shell instead of crashing the request.
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch (err) {
    console.warn('[docs] decodeURIComponent failed', { pathname, err });
    return new Response(file(join(DIST, 'index.html')));
  }
  const resolved = resolve(DIST, rel);
  if (resolved === DIST || resolved.startsWith(DIST_PREFIX)) {
    const candidate = file(resolved);
    if (await candidate.exists()) {
      const ct = contentTypeFor(pathname);
      return new Response(candidate, {
        headers: ct ? { 'content-type': ct } : undefined,
      });
    }
    const routeHtml = file(join(resolved, 'index.html'));
    if (await routeHtml.exists()) {
      return new Response(routeHtml);
    }
  }
  return new Response(file(join(DIST, 'index.html')));
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

    const negotiation = negotiatePathLocale({
      pathname: url.pathname,
      cookieHeader: request.headers.get('cookie'),
      acceptLanguageHeader: request.headers.get('accept-language'),
    });

    if (negotiation.redirectTo) {
      const headers = new Headers({
        Location: BASE_PATH + negotiation.redirectTo,
        Vary: 'Accept-Language, Cookie',
      });
      if (negotiation.setCookieValue) {
        headers.append(
          'Set-Cookie',
          serializeLocaleCookie({
            value: negotiation.setCookieValue,
            domain: LOCALE_COOKIE_DOMAIN,
            secure: isSecureRequest(request),
          }),
        );
      }
      return new Response(null, { status: 302, headers });
    }

    const response = await serveStatic(url.pathname);
    return applyLocaleResponseHeaders(response, negotiation, request);
  },
});

console.log(`[docs] listening on :${PORT}`);
