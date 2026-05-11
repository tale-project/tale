/**
 * Shared simple-server bootstrap. Used by `services/web/server.ts` and
 * `services/docs/server.ts` — both serve a Vite-built static SPA from a
 * `dist/` directory, run the locale negotiator on every request, and expose
 * `/api/health`. The platform service uses a Hono-based shell with CSP,
 * nonce injection, and Convex-aware routes — that lives in
 * `services/platform/server.ts` and intentionally is NOT funneled through
 * this helper.
 */

import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { serializeLocaleCookie } from '@tale/i18n/cookie';
import {
  negotiatePathLocale,
  type NegotiatePathLocaleResult,
} from '@tale/i18n/negotiate';
import { file } from 'bun';

export interface SecurityHeadersConfig {
  /**
   * CSP directives in camelCase (`defaultSrc`, `scriptSrc`, …); values are
   * source lists joined with spaces. Set to `false` to omit the header.
   */
  contentSecurityPolicy?: Record<string, readonly string[]> | false;
  /**
   * `Strict-Transport-Security` value (e.g. `'max-age=15552000'`). Only
   * emitted on HTTPS requests. Set to `false` to omit.
   */
  strictTransportSecurity?: string | false;
  xContentTypeOptions?: 'nosniff' | false;
  xFrameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  referrerPolicy?: string | false;
}

/**
 * Sensible default for a public marketing/docs site served from a Vite
 * `dist/`. Allows inline `<script>` because docs ships a synchronous
 * theme-detection script in `index.html`; allows inline `<style>` because
 * Tailwind v4 emits a few. Override per-service if a stricter policy fits.
 *
 * No external origins are allowed by default — runtime assets must be
 * served same-origin. Same GDPR / air-gap rationale as the platform CSP.
 */
export const defaultSimpleSecurityHeaders: SecurityHeadersConfig = {
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'none'"],
  },
  // 180 days, no `includeSubDomains` / `preload` — self-deployed operators
  // run on varied domains and don't own preload submission.
  strictTransportSecurity: 'max-age=15552000',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
};

export interface SimpleServerOptions {
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
   * Service-specific routes evaluated BEFORE static file serving and locale
   * negotiation. Return `null` (or `undefined`) to fall through to the
   * default pipeline. Use for service-only API endpoints (e.g. web's
   * `/api/forms/submit` Discord proxy).
   */
  extraRoutes?: (
    request: Request,
    url: URL,
  ) => Promise<Response | null | undefined> | Response | null | undefined;
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

function isSecureRequest(request: Request): boolean {
  if (request.url.startsWith('https://')) return true;
  return request.headers.get('x-forwarded-proto') === 'https';
}

function cspDirectiveName(camel: string): string {
  return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function buildCspHeader(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([key, sources]) => `${cspDirectiveName(key)} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * Mutates `response.headers` in place, adding any configured security
 * headers. HSTS is skipped on plaintext HTTP so dev environments don't
 * pin themselves to https.
 */
function applySecurityHeaders(
  response: Response,
  config: SecurityHeadersConfig,
  isSecure: boolean,
): Response {
  if (config.contentSecurityPolicy) {
    response.headers.set(
      'Content-Security-Policy',
      buildCspHeader(config.contentSecurityPolicy),
    );
  }
  if (config.strictTransportSecurity && isSecure) {
    response.headers.set(
      'Strict-Transport-Security',
      config.strictTransportSecurity,
    );
  }
  if (config.xContentTypeOptions) {
    response.headers.set('X-Content-Type-Options', config.xContentTypeOptions);
  }
  if (config.xFrameOptions) {
    response.headers.set('X-Frame-Options', config.xFrameOptions);
  }
  if (config.referrerPolicy) {
    response.headers.set('Referrer-Policy', config.referrerPolicy);
  }
  return response;
}

export function startSimpleServer(opts: SimpleServerOptions): void {
  const {
    port,
    hostname = '0.0.0.0',
    distDir,
    logPrefix,
    localeCookieDomain = process.env.LOCALE_COOKIE_DOMAIN || undefined,
    redirectPrefix = '',
    shutdownMarkerPath,
    securityHeaders,
    extraRoutes,
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

  async function serveStatic(pathname: string): Promise<Response> {
    // Malformed percent-encodings (e.g. `/%E0%A4%A`) make decodeURIComponent
    // throw — fall back to the SPA shell instead of crashing the request.
    let rel: string;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch (err) {
      console.warn(`[${logPrefix}] decodeURIComponent failed`, {
        pathname,
        err,
      });
      return new Response(file(join(distDir, 'index.html')));
    }
    const resolved = resolve(distDir, rel);
    if (resolved === distDir || resolved.startsWith(distPrefix)) {
      const candidate = file(resolved);
      if (await candidate.exists()) {
        const ct = contentTypeFor(pathname);
        return new Response(candidate, {
          headers: ct ? { 'content-type': ct } : undefined,
        });
      }
      // Try the prerendered route HTML (e.g. /pricing → dist/pricing/index.html).
      const routeHtml = file(join(resolved, 'index.html'));
      if (await routeHtml.exists()) {
        return new Response(routeHtml);
      }
    }
    return new Response(file(join(distDir, 'index.html')));
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
        if (shutdownMarkerPath && existsSync(shutdownMarkerPath)) {
          return finalize(
            Response.json({ status: 'shutting_down' }, { status: 503 }),
          );
        }
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
