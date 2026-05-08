// Bun server: serves the prebuilt SPA from ./dist + a /api/forms/submit route
// that proxies validated form payloads to a Discord incoming webhook.

import { join, resolve, sep } from 'node:path';

import { serializeLocaleCookie } from '@tale/i18n/cookie';
import {
  negotiatePathLocale,
  type NegotiatePathLocaleResult,
} from '@tale/i18n/negotiate';
import { file } from 'bun';

import { buildDiscordPayload } from './lib/forms/discord-embeds';
import { checkRateLimit } from './lib/forms/rate-limit';
import { MIN_SUBMIT_DELAY_MS, submitRequest } from './lib/forms/schemas';

const PORT = Number(process.env.PORT ?? 3001);
const HOSTNAME = process.env.HOSTNAME ?? '0.0.0.0';
const DIST = resolve(import.meta.dir, 'dist');
const DIST_PREFIX = DIST + sep;
const DISCORD_WEBHOOK_URL = process.env.WEB_DISCORD_WEBHOOK_URL ?? '';
const MAX_BODY_BYTES = 4 * 1024;
const DISCORD_WEBHOOK_TIMEOUT_MS = 10_000;
// Set in production deploys to share the cookie across subdomains
// (e.g. `.tale.dev` so docs.tale.dev sees the same value). Leave unset in
// local dev — port-on-localhost is its own cookie scope.
const LOCALE_COOKIE_DOMAIN = process.env.LOCALE_COOKIE_DOMAIN || undefined;

function contentTypeFor(path: string): string | null {
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (path === '/llms.txt' || path === '/llms-full.txt') {
    return 'text/plain; charset=utf-8';
  }
  if (path === '/robots.txt') return 'text/plain; charset=utf-8';
  if (path === '/sitemap.xml') return 'application/xml; charset=utf-8';
  return null;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const [first] = fwd.split(',');
    if (first) return first.trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
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

async function handleFormSubmit(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!DISCORD_WEBHOOK_URL) {
    console.error('[forms] WEB_DISCORD_WEBHOOK_URL is not set');
    return Response.json(
      { ok: false, error: 'Service not configured' },
      { status: 503 },
    );
  }

  const ip = clientIp(request);
  const limit = checkRateLimit(ip);
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: 'Too many requests' },
      {
        status: 429,
        headers: { 'retry-after': String(limit.retryAfter) },
      },
    );
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return Response.json(
      { ok: false, error: 'Payload too large' },
      { status: 413 },
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json(
      { ok: false, error: 'Payload too large' },
      { status: 413 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('[forms] Invalid JSON payload', err);
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const validation = submitRequest.safeParse(parsed);
  if (!validation.success) {
    return Response.json(
      { ok: false, error: 'Validation failed' },
      { status: 400 },
    );
  }

  const { startedAt, website } = validation.data.payload;
  if (website && website.length > 0) {
    // Honeypot tripped — accept silently to avoid signalling to bots.
    return Response.json({ ok: true });
  }
  if (Date.now() - startedAt < MIN_SUBMIT_DELAY_MS) {
    return Response.json(
      { ok: false, error: 'Submitted too quickly' },
      { status: 400 },
    );
  }

  const payload = buildDiscordPayload(validation.data);
  try {
    const upstream = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISCORD_WEBHOOK_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      console.error('[forms] Discord webhook returned', upstream.status);
      return Response.json(
        { ok: false, error: 'Upstream error' },
        { status: 502 },
      );
    }
  } catch (cause) {
    console.error('[forms] Discord webhook fetch failed', cause);
    return Response.json(
      { ok: false, error: 'Upstream error' },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}

async function serveStatic(pathname: string): Promise<Response> {
  // Malformed percent-encodings (e.g. `/%E0%A4%A`) make decodeURIComponent
  // throw — fall back to the SPA shell instead of crashing the request.
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch (err) {
    console.warn('[web] decodeURIComponent failed', { pathname, err });
    return new Response(file(join(DIST, 'index.html')));
  }
  const resolved = resolve(DIST, rel);
  if (resolved === DIST || resolved.startsWith(DIST_PREFIX)) {
    // Serve the static asset if it exists.
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
    if (url.pathname === '/api/forms/submit') {
      return handleFormSubmit(request);
    }

    const negotiation = negotiatePathLocale({
      pathname: url.pathname,
      cookieHeader: request.headers.get('cookie'),
      acceptLanguageHeader: request.headers.get('accept-language'),
    });

    if (negotiation.redirectTo) {
      const headers = new Headers({
        Location: negotiation.redirectTo,
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

console.log(`[web] listening on :${PORT}`);
