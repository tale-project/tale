/**
 * Shared React-service bootstrap. Used by every Tale Vite/React service
 * that serves a built SPA from a `dist/` directory (web, docs, and any
 * service scaffolded from `tools/plop/templates/service/react`). The
 * platform service uses a Hono-based shell with CSP, nonce injection, and
 * Convex-aware routes — that lives in `services/platform/server.ts` and
 * intentionally is NOT funneled through this helper.
 *
 * In addition to the locale negotiator, static serving, and the
 * `/api/health` endpoint, this server can also serve the full set of
 * SEO + LLM artifacts (`/llms.txt`, `/llms-full.txt`, `/sitemap.xml`,
 * `/robots.txt`, `/<route>.md`) on demand — pass an `ArtifactsServer`
 * from `@tale/seo` and every artifact URL is dispatched to it with
 * proper ETag handling before falling through to static serving.
 */

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { serializeLocaleCookie } from '@tale/ui/i18n/cookie';
import {
  negotiatePathLocale,
  type NegotiatePathLocaleResult,
} from '@tale/ui/i18n/negotiate';
import { file } from 'bun';

import type { ArtifactsServer } from '../seo';
import {
  applySecurityHeaders,
  defaultReactServerSecurityHeaders,
  type SecurityHeadersConfig,
} from './security-headers';

// Re-exported so existing callers (`services/web`, `services/docs`) keep
// importing the config + default from `@tale/ui/server` unchanged. The pure
// header logic lives in `./security-headers` so it is testable without the
// `bun` import above.
export {
  applySecurityHeaders,
  defaultReactServerSecurityHeaders,
  type SecurityHeadersConfig,
};

export interface ReactServerOptions {
  /** Port to listen on. */
  port: number;
  /** Bind hostname. Defaults to `0.0.0.0`. */
  hostname?: string;
  /** Absolute path to the static `dist/` directory served as the SPA root. */
  distDir: string;
  /** Console log prefix (e.g. `web`, `docs`). */
  logPrefix: string;
  /**
   * Cookie scope for the locale cookie. Set in production to share across
   * subdomains (e.g. `.tale.dev`). Falls back to
   * `process.env.LOCALE_COOKIE_DOMAIN`.
   */
  localeCookieDomain?: string;
  /**
   * Prefix prepended to redirect `Location` headers emitted by the locale
   * negotiator. Required when the site is mounted under a path (e.g. `/docs`
   * via a reverse proxy) so 302s stay inside that mount. Empty (default)
   * when served at the origin root.
   */
  redirectPrefix?: string;
  /**
   * Path to a graceful-shutdown marker file. When the file exists, the
   * docker entrypoint's signal handler created it; `/api/health` returns
   * 503 so the orchestrator (Caddy / Docker / Kubernetes) drains traffic
   * before the process actually terminates. Leave unset when the service
   * has no graceful-drain handshake.
   */
  shutdownMarkerPath?: string;
  /**
   * Security headers applied to every response. CSP, HSTS, X-Frame-Options,
   * etc. Each subkey can be set to `false` to omit. HSTS only emits on
   * HTTPS requests. Leave unset to skip security headers entirely.
   */
  securityHeaders?: SecurityHeadersConfig;
  /**
   * Optional override for `/api/health`. Return a `Response` to replace the
   * default `{ status, version }` payload (e.g. web adds `checks.forms` and
   * may return 503 when required env is missing). Return `null` to use the
   * built-in handler (shutting-down probe + `{ status: 'ok', version }`).
   */
  buildHealthResponse?: (ctx: { shuttingDown: boolean }) => Response | null;
  /**
   * Service-specific routes evaluated BEFORE static file serving and locale
   * negotiation. Return `null` (or `undefined`) to fall through to the
   * default pipeline. Use for service-only API endpoints (e.g. web's
   * `/api/forms/submit` Discord proxy).
   */
  extraRoutes?: (
    request: Request,
    url: URL,
  ) => Promise<Response | null | undefined> | Response | null | undefined;
  /**
   * Optional on-demand SEO + LLM artifact server (built via
   * `createArtifactsServer` from `@tale/seo`). When set, requests for
   * `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, and
   * `/<route>.md` are dispatched to the server before falling through to
   * static serving. Misses (unknown route) fall through.
   */
  artifacts?: ArtifactsServer;
}

function contentTypeFor(path: string): string | null {
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (path === '/llms.txt' || path === '/llms-full.txt') {
    return 'text/plain; charset=utf-8';
  }
  if (path === '/robots.txt') return 'text/plain; charset=utf-8';
  if (path === '/sitemap.xml') return 'application/xml; charset=utf-8';
  return null;
}

/**
 * Cache policy for static files. Vite content-hashes everything under
 * `assets/`, so those are immutable; HTML must always revalidate; other
 * static files (favicons, og card, manifest, images) change rarely but are
 * not hashed, so they get a short TTL with stale-while-revalidate.
 */
export function staticCacheControlFor(rel: string): string {
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (rel === '' || rel.endsWith('.html')) return 'no-cache';
  return 'public, max-age=3600, stale-while-revalidate=86400';
}

function isSecureRequest(request: Request): boolean {
  if (request.url.startsWith('https://')) return true;
  return request.headers.get('x-forwarded-proto') === 'https';
}

async function handleArtifacts(
  artifacts: ArtifactsServer,
  request: Request,
  logPrefix: string,
): Promise<Response | null> {
  try {
    return await artifacts.handle(request);
  } catch (error) {
    console.error(
      `[${logPrefix}] artifact handler failed for`,
      new URL(request.url).pathname,
      error,
    );
    return new Response('Artifact render failed', { status: 500 });
  }
}

export function startReactServer(opts: ReactServerOptions): void {
  const {
    port,
    hostname = '0.0.0.0',
    distDir,
    logPrefix,
    localeCookieDomain = process.env.LOCALE_COOKIE_DOMAIN || undefined,
    redirectPrefix = '',
    shutdownMarkerPath,
    securityHeaders,
    buildHealthResponse,
    extraRoutes,
    artifacts,
  } = opts;

  const distPrefix = distDir + sep;

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
          domain: localeCookieDomain,
          secure: isSecureRequest(request),
        }),
      );
    }
    response.headers.append('Vary', 'Accept-Language, Cookie');
    return response;
  }

  // Prerendered 404 page — opt-in by artifact. A service that emits
  // `dist/404/index.html` (web/docs prerender) gets a real 404 status for
  // unknown paths; without the artifact the legacy SPA-shell fallback (200)
  // stays, so consumers migrate independently.
  async function notFoundOrShell(): Promise<Response> {
    const notFound = file(join(distDir, '404', 'index.html'));
    if (await notFound.exists()) {
      return new Response(notFound, {
        status: 404,
        headers: { 'cache-control': 'no-cache' },
      });
    }
    return new Response(file(join(distDir, 'index.html')), {
      headers: { 'cache-control': 'no-cache' },
    });
  }

  async function serveStatic(pathname: string): Promise<Response> {
    // Malformed percent-encodings (e.g. `/%E0%A4%A`) make decodeURIComponent
    // throw — treat them as not-found instead of crashing the request.
    let rel: string;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch (err) {
      console.warn(`[${logPrefix}] decodeURIComponent failed`, {
        pathname,
        err,
      });
      return notFoundOrShell();
    }
    const resolved = resolve(distDir, rel);
    if (resolved === distDir || resolved.startsWith(distPrefix)) {
      const candidate = file(resolved);
      if (await candidate.exists()) {
        const ct = contentTypeFor(pathname);
        return new Response(candidate, {
          headers: {
            ...(ct ? { 'content-type': ct } : {}),
            'cache-control': staticCacheControlFor(rel),
          },
        });
      }
      // Try the prerendered route HTML (e.g. /pricing → dist/pricing/index.html).
      const routeHtml = file(join(resolved, 'index.html'));
      if (await routeHtml.exists()) {
        return new Response(routeHtml, {
          headers: { 'cache-control': 'no-cache' },
        });
      }
    }
    return notFoundOrShell();
  }

  Bun.serve({
    port,
    hostname,
    async fetch(request) {
      const url = new URL(request.url);
      const secure = isSecureRequest(request);
      const finalize = (response: Response) =>
        securityHeaders
          ? applySecurityHeaders(response, securityHeaders, secure)
          : response;

      if (url.pathname === '/api/health') {
        const shuttingDown = Boolean(
          shutdownMarkerPath && existsSync(shutdownMarkerPath),
        );
        if (shuttingDown) {
          return finalize(
            Response.json({ status: 'shutting_down' }, { status: 503 }),
          );
        }
        const customHealth = buildHealthResponse?.({ shuttingDown });
        if (customHealth) return finalize(customHealth);
        return finalize(
          Response.json({
            status: 'ok',
            version: process.env.TALE_VERSION ?? 'dev',
          }),
        );
      }

      if (extraRoutes) {
        const extra = await extraRoutes(request, url);
        if (extra) return finalize(extra);
      }

      if (artifacts) {
        const artifact = await handleArtifacts(artifacts, request, logPrefix);
        if (artifact) return finalize(artifact);
      }

      const negotiation = negotiatePathLocale({
        pathname: url.pathname,
        cookieHeader: request.headers.get('cookie'),
        acceptLanguageHeader: request.headers.get('accept-language'),
      });

      if (negotiation.redirectTo) {
        const headers = new Headers({
          Location: redirectPrefix + negotiation.redirectTo,
          Vary: 'Accept-Language, Cookie',
        });
        if (negotiation.setCookieValue) {
          headers.append(
            'Set-Cookie',
            serializeLocaleCookie({
              value: negotiation.setCookieValue,
              domain: localeCookieDomain,
              secure: isSecureRequest(request),
            }),
          );
        }
        return finalize(new Response(null, { status: 302, headers }));
      }

      const response = await serveStatic(url.pathname);
      return finalize(
        applyLocaleResponseHeaders(response, negotiation, request),
      );
    },
  });

  console.log(`[${logPrefix}] listening on :${port}`);
}
