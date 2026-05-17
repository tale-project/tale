// Bun server for the Tale marketing site. Serves the prebuilt SPA from
// `./dist` and the precompiled SEO + LLM artifacts from `./dist-seo` via
// `createPrecompiledServer` (`@tale/seo`). Marketing routes were
// SSR-rendered and converted to markdown in the Docker builder stage —
// no SSR happens at request time. Plus a Discord-webhook proxy for form
// submissions. The boilerplate (locale negotiation, static serving,
// `/api/health`, security headers) lives in `@tale/webui/server`.

import { resolve } from 'node:path';

import { createPrecompiledServer } from '@tale/seo';
import {
  defaultReactServerSecurityHeaders,
  startReactServer,
} from '@tale/webui/server';

import { buildDiscordPayload } from './lib/forms/discord-embeds';
import { checkRateLimit } from './lib/forms/rate-limit';
import { MIN_SUBMIT_DELAY_MS, submitRequest } from './lib/forms/schemas';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DISCORD_WEBHOOK_URL = process.env.WEB_DISCORD_WEBHOOK_URL ?? '';
const MAX_BODY_BYTES = 4 * 1024;
const DISCORD_WEBHOOK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Precompiled artifact server
// ---------------------------------------------------------------------------

const artifactsServer = await createPrecompiledServer({
  dir: resolve(import.meta.dir, 'dist-seo'),
});

// ---------------------------------------------------------------------------
// Form-submit handler (web-specific)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

startReactServer({
  port: Number(process.env.PORT ?? 3001),
  distDir: resolve(import.meta.dir, 'dist'),
  logPrefix: 'web',
  shutdownMarkerPath: process.env.SHUTDOWN_MARKER_PATH,
  securityHeaders: defaultReactServerSecurityHeaders,
  artifacts: artifactsServer,
  extraRoutes: (request, url) => {
    if (url.pathname === '/api/forms/submit') {
      return handleFormSubmit(request);
    }
    return null;
  },
});
