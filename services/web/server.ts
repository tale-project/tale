// Bun server: serves the prebuilt SPA from ./dist + a /api/forms/submit route
// that proxies validated form payloads to a Microsoft Teams incoming webhook.

import { join, resolve, sep } from 'node:path';

import { file } from 'bun';

import { checkRateLimit } from './lib/forms/rate-limit';
import { MIN_SUBMIT_DELAY_MS, submitRequest } from './lib/forms/schemas';
import { buildTeamsCard } from './lib/forms/teams-cards';

const PORT = Number(process.env.PORT ?? 3001);
const HOSTNAME = process.env.HOSTNAME ?? '0.0.0.0';
const DIST = resolve(import.meta.dir, 'dist');
const DIST_PREFIX = DIST + sep;
const TEAMS_WEBHOOK_URL = process.env.WEB_TEAMS_WEBHOOK_URL ?? '';
const MAX_BODY_BYTES = 4 * 1024;
const TEAMS_WEBHOOK_TIMEOUT_MS = 10_000;

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const [first] = fwd.split(',');
    if (first) return first.trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

async function handleFormSubmit(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!TEAMS_WEBHOOK_URL) {
    console.error('[forms] WEB_TEAMS_WEBHOOK_URL is not set');
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

  const card = buildTeamsCard(validation.data);
  try {
    const upstream = await fetch(TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(TEAMS_WEBHOOK_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      console.error('[forms] Teams webhook returned', upstream.status);
      return Response.json(
        { ok: false, error: 'Upstream error' },
        { status: 502 },
      );
    }
  } catch (cause) {
    console.error('[forms] Teams webhook fetch failed', cause);
    return Response.json(
      { ok: false, error: 'Upstream error' },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
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

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const resolved = resolve(DIST, rel);
    if (resolved === DIST || resolved.startsWith(DIST_PREFIX)) {
      // Serve the static asset if it exists.
      const candidate = file(resolved);
      if (await candidate.exists()) {
        return new Response(candidate);
      }
      // Try the prerendered route HTML (e.g. /pricing → dist/pricing/index.html).
      const routeHtml = file(join(resolved, 'index.html'));
      if (await routeHtml.exists()) {
        return new Response(routeHtml);
      }
    }
    return new Response(file(join(DIST, 'index.html')));
  },
});

console.log(`[web] listening on :${PORT}`);
