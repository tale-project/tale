import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrecompiledServer, type ArtifactsServer } from '@tale/ui/seo';
import { Hono } from 'hono';
import { NONCE, secureHeaders } from 'hono/secure-headers';

import { convexMetricsResponse } from './convex-metrics';
import {
  buildCanvasPreviewCsp,
  wrapCanvasPreviewHtml,
} from './lib/canvas-preview-shell';
import { createConfigWatcher } from './lib/config-watcher';
import { fetchAdapter as webdavFetchAdapter } from './lib/webdav/adapters/fetch';
import { makeWebdavCtx } from './lib/webdav/ctx';
import {
  ensureWebdavHmacKey,
  WEBDAV_HMAC_KEY_MIN_LENGTH,
} from './lib/webdav/hmac-key';
import { WEBDAV_METHODS } from './lib/webdav/types';
import {
  buildStatusFeed,
  probeServices,
  renderStatusJson,
  renderStatusPage,
} from './status-probe';
import { initTelemetry, metricsResponse } from './telemetry';

// Platform graceful shutdown marker (written by docker-entrypoint.sh trap).
// When present, /api/health returns 503 so Caddy/Docker drain traffic before
// the process actually terminates.
const SHUTDOWN_MARKER = '/tmp/platform-shutting-down';

// ---------------------------------------------------------------------------
// Config file events (SSE)
//
// Watches TALE_CONFIG_DIR for .json changes via chokidar and pushes
// structured events to connected frontends so they can invalidate their
// TanStack Query caches without a full page reload.
// ---------------------------------------------------------------------------

interface SseClient {
  controller: ReadableStreamDefaultController;
  // Org slugs the connected user is a member of. Watcher events whose
  // `orgSlug` falls outside this set are dropped before the payload
  // hits the wire — closes the cross-org metadata leak that
  // unauthenticated / cross-org clients otherwise saw via the SSE
  // stream. `null` means "platform-wide / org-agnostic event" (rare;
  // currently only the `{type:"connected"}` ping).
  allowedOrgSlugs: Set<string>;
}

const sseClients = new Set<SseClient>();

const fileEventsEnabled = process.env.TALE_FILE_EVENTS === 'true';
const configDir = process.env.TALE_CONFIG_DIR;
// Post-split (Phase 2): TALE_CONFIG_DIR points at the convex-data volume
// mounted read-only on the platform container (for config-file SSE + branding
// image serving). Skip watcher setup gracefully if the directory is absent.
if (fileEventsEnabled && configDir && existsSync(configDir)) {
  const watcher = createConfigWatcher(configDir);
  watcher.onChange((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    // Per-event org filter. Every config-watcher event carries an
    // `orgSlug` (see lib/config-watcher.ts: parseConfigChange always
    // sets it for valid paths). If a future event type appears without
    // a slug, default-deny — the legacy fan-out-to-everyone behavior is
    // what this fix is closing.
    const eventOrg =
      typeof event === 'object' && event !== null && 'orgSlug' in event
        ? (event as { orgSlug?: string }).orgSlug
        : undefined;
    for (const client of sseClients) {
      if (eventOrg && !client.allowedOrgSlugs.has(eventOrg)) continue;
      try {
        client.controller.enqueue(payload);
      } catch (err) {
        console.warn('SSE enqueue failed; dropping client', err);
        sseClients.delete(client);
      }
    }
  });
  console.log(`Config file watcher active: ${configDir}`);
}

/**
 * Resolve the org slugs the current session is allowed to receive
 * events for by forwarding the request's Cookie header to Convex's
 * `/api/sse/auth` httpAction. Returns null on missing/invalid session
 * (the SSE handler then closes the connection with 401).
 *
 * `CONVEX_SITE_PROXY_URL` overrides the derived URL for dev — see
 * vite.config.ts. In compose the convex HTTP-actions port is `:3211`
 * on the same internal hostname as the WS API (`:3210` from
 * CONVEX_URL).
 */
function convexHttpActionsBaseUrl(): string {
  if (process.env.CONVEX_SITE_PROXY_URL) {
    return process.env.CONVEX_SITE_PROXY_URL.replace(/\/$/, '');
  }
  const wsUrl = process.env.CONVEX_URL ?? 'http://convex:3210';
  // Parse via URL() so the rewrite works for bare hostnames
  // (`https://convex.example.com` → no explicit port) and URLs with
  // path suffixes (`http://convex:3210/sub`) — the previous regex
  // `:\d+$` only matched the literal trailing-port shape and would
  // silently leave the wrong port in place for any operator who set
  // CONVEX_URL to anything else. Falls back to the original string if
  // parsing fails (defensive — should be unreachable).
  try {
    const parsed = new URL(wsUrl);
    parsed.port = '3211';
    // URL toString preserves protocol, host, path; strip any trailing
    // slash for symmetry with CONVEX_SITE_PROXY_URL handling above.
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return wsUrl.replace(/:\d+$/, ':3211').replace(/\/$/, '');
  }
}

async function resolveAllowedOrgSlugs(
  cookieHeader: string | undefined,
): Promise<Set<string> | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${convexHttpActionsBaseUrl()}/api/sse/auth`, {
      headers: { cookie: cookieHeader },
    });
    if (res.status === 401) return null;
    if (!res.ok) {
      console.warn(`[/events/file] convex auth lookup returned ${res.status}`);
      return null;
    }
    const body: unknown = await res.json();
    const slugs =
      body && typeof body === 'object' && 'orgSlugs' in body
        ? (body as { orgSlugs: unknown }).orgSlugs
        : null;
    if (!Array.isArray(slugs)) return new Set();
    return new Set(
      slugs.filter((s): s is string => typeof s === 'string' && s.length > 0),
    );
  } catch (err) {
    console.warn('[/events/file] convex auth lookup failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------

function escapeHtmlAttr(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

interface EnvConfig {
  SITE_URL: string | undefined;
  BASE_PATH: string;
  MICROSOFT_AUTH_ENABLED: boolean;
  TRUSTED_HEADERS_ENABLED: boolean;
  FILE_EVENTS_ENABLED: boolean;
  SENTRY_DSN: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE: number;
  TALE_VERSION: string | undefined;
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: readonly string[];
}

const port = process.env.PORT || 3000;
const moduleDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(moduleDir, 'dist');
const distSeoDir = join(moduleDir, 'dist-seo');
// Branding is default-only on the read side (see branding/file_actions.ts —
// every reader passes the literal 'default'). On-disk location follows the
// uniform org-first layout: `${TALE_CONFIG_DIR}/default/branding/images/`.
const brandingImagesDir = process.env.TALE_CONFIG_DIR
  ? join(process.env.TALE_CONFIG_DIR, 'default', 'branding', 'images')
  : null;

// Lazily loaded once per process. The manifest is read on the first
// artifact request — defer it so the module load does not fail in test
// environments that don't ship a `dist-seo/` directory.
let platformArtifactsServerPromise: Promise<ArtifactsServer> | null = null;
function platformArtifactsServer(): Promise<ArtifactsServer> {
  if (!platformArtifactsServerPromise) {
    platformArtifactsServerPromise = createPrecompiledServer({
      dir: distSeoDir,
    });
  }
  return platformArtifactsServerPromise;
}

function getBasePath(): string {
  const basePath = process.env.BASE_PATH ?? '';
  return basePath.replace(/\/$/, '');
}

let indexHtmlTemplate: string | null = null;

function getEnvConfig(): EnvConfig {
  return {
    SITE_URL: process.env.SITE_URL,
    BASE_PATH: getBasePath(),
    MICROSOFT_AUTH_ENABLED: !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    TRUSTED_HEADERS_ENABLED: process.env.TRUSTED_HEADERS_ENABLED === 'true',
    FILE_EVENTS_ENABLED: fileEventsEnabled,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
    ),
    TALE_VERSION: process.env.TALE_VERSION,
    // Whitespace-separated origin list, e.g.
    // `CANVAS_PREVIEW_CSP_EXTRA_ORIGINS="https://cdn.jsdelivr.net https://unpkg.com"`.
    // Validated and appended to the canvas-preview CSP — see the policy
    // comment block below and `lib/canvas-preview-shell.ts`.
    CANVAS_PREVIEW_CSP_EXTRA_ORIGINS:
      process.env.CANVAS_PREVIEW_CSP_EXTRA_ORIGINS?.split(/\s+/).filter(
        (s) => s.length > 0,
      ) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Security headers
//
// Policy: all runtime assets (scripts, styles, fonts, images) are served
// same-origin from the platform container. External origins MUST NOT be
// added to CSP without a GDPR (third-party data-transfer) + offline-
// availability review — self-deployed operators may run in air-gapped or
// EU-data-residency environments where any CDN fetch is either blocked or
// a non-contracted processor transfer. Libraries (PDF.js via pdfjs-dist),
// fonts (Inter via @fontsource), and anything previously loaded from
// cdnjs / fonts.g*.com / nominatim.openstreetmap.org are bundled or
// dropped for this reason.
//
// Current exceptions are gated by explicit operator opt-in:
//   - Sentry: origin is parsed from SENTRY_DSN (supports SaaS ingest and
//     self-hosted Sentry on custom domains). Only emitted when DSN is set.
//   - Figma MCP (`mcp.figma.com`): only when SITE_URL is a loopback host
//     (dev-only; production policy never includes it).
//   - Canvas preview extras (CANVAS_PREVIEW_CSP_EXTRA_ORIGINS): a
//     whitespace-separated origin list appended to the *canvas-preview*
//     route's CSP only — does NOT widen the SPA baseline policy
//     `buildContentSecurityPolicy` returns. Default empty. Setting it
//     causes end-user IP/UA/Referer to be sent to those origins on every
//     preview render, so the operator becomes the controller for that
//     transfer (lawful basis, DPA, transparency notice are operator's
//     responsibility). Most operators should leave it empty and rely on
//     the libraries vendored under `public/canvas-libs/` instead.
//
// All Convex traffic — including storage uploads via `generateUploadUrl()`
// and storage downloads — flows same-origin through Caddy (`/ws_api`,
// `/api/storage/*`), so `'self'` covers it without needing any
// `*.convex.cloud` / `*.convex.site` entries. SITE_URL hostname determines
// whether HSTS is emitted (only when the deployment is HTTPS).
// ---------------------------------------------------------------------------

function sentryOriginFromDsn(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.host}`;
  } catch (err) {
    console.warn('Invalid SENTRY_DSN, skipping CSP allow-list entry:', err);
    return null;
  }
}

function buildContentSecurityPolicy(env: EnvConfig) {
  const sentryOrigin = sentryOriginFromDsn(env.SENTRY_DSN);
  const sentry = sentryOrigin ? [sentryOrigin] : [];
  const figmaMcp = isLoopbackSite(env) ? ['https://mcp.figma.com'] : [];
  return {
    defaultSrc: ["'self'"],
    scriptSrc: [
      // `index.html` ships an inline `<script>` for the `__ENV__` runtime
      // injection (load-bearing — without it the SPA can't read SITE_URL)
      // plus, on loopback only, a Figma MCP capture loader. Inline scripts
      // are tagged with `nonce="…"` at HTML render time; this NONCE token
      // makes the matching `nonce-…` source appear in script-src.
      NONCE,
      "'self'",
      ...figmaMcp,
    ],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", ...sentry],
    workerSrc: ["'self'", 'blob:'],
    frameSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    // TTS playback streams audio from same-origin `/http_api/api/tts-audio`
    // via `<audio>.src`, so `'self'` is required.
    mediaSrc: ["'self'"],
  };
}

function isHttpsSite(env: EnvConfig): boolean {
  return !!env.SITE_URL && env.SITE_URL.startsWith('https://');
}

function isLoopbackSite(env: EnvConfig): boolean {
  if (!env.SITE_URL) return false;
  try {
    const host = new URL(env.SITE_URL).hostname;
    // `URL` strips brackets from IPv6 hostnames, so compare against `::1`
    // rather than `[::1]`.
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function createApp(env: EnvConfig = getEnvConfig()): Hono {
  const app = new Hono();

  const secure = secureHeaders({
    contentSecurityPolicy: buildContentSecurityPolicy(env),
    // 180 days. No `includeSubDomains`, no `preload` — self-deployed
    // operators run on varied domains and don't own preload submission.
    strictTransportSecurity: isHttpsSite(env) ? 'max-age=15552000' : false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: {
      camera: [],
      microphone: ['self'],
      // Active features: location-request approval card uses geolocation;
      // copy-to-clipboard hook is wired into many UI surfaces.
      geolocation: ['self'],
      clipboardWrite: ['self'],
      clipboardRead: [],
      usb: [],
      payment: [],
      bluetooth: [],
      midi: [],
      hid: [],
      serial: [],
    },
    // Defaults that would interfere with same-origin embeds and OAuth
    // popups; we explicitly lean on CSP `frame-ancestors` and
    // `frame-src` instead.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });
  // WebDAV-specific narrow variant: CSP is dropped (DAV bodies are raw
  // blobs / XML, not HTML — CSP rewrites would confuse clients like
  // Finder and rclone), but HSTS, X-Frame-Options, X-Content-Type-Options,
  // and Referrer-Policy stay on. A WebDAV-served HTML upload SHOULD NOT
  // execute as a same-origin document; nosniff + X-Frame-Options: DENY
  // close that surface. CORS-relevant defaults stay off (no browser is
  // expected to script-fetch /dav/*).
  // Hono's `secureHeaders` accepts `ContentSecurityPolicyOptions` only —
  // there's no `false` literal for the CSP key, so we omit it to disable
  // CSP generation while keeping HSTS / nosniff / X-Frame-Options.
  const secureForDav = secureHeaders({
    strictTransportSecurity: isHttpsSite(env) ? 'max-age=15552000' : false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });
  // `secureHeaders` unconditionally rewrites `Content-Security-Policy`
  // after handlers run, so per-route permissive CSP cannot be set just by
  // header overrides. The Canvas preview shell needs its own permissive
  // CSP; bypass `secureHeaders` for that single path explicitly. Path
  // guard, not registration order — the latter is fragile to refactors.
  app.use('*', async (c, next) => {
    if (c.req.path === '/canvas-preview') return next();
    if (c.req.path.startsWith('/dav/') || c.req.path === '/dav')
      return secureForDav(c, next);
    return secure(c, next);
  });

  app.post('/canvas-preview', async (c) => {
    const body = await c.req.parseBody();
    const userHtml = typeof body.html === 'string' ? body.html : '';
    return new Response(wrapCanvasPreviewHtml(userHtml), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': buildCanvasPreviewCsp(
          env.CANVAS_PREVIEW_CSP_EXTRA_ORIGINS,
        ),
        'X-Frame-Options': 'SAMEORIGIN',
        // Per-request bespoke HTML — no caching.
        'Cache-Control': 'no-store',
      },
    });
  });

  app.get('/api/health', (c) => {
    if (existsSync(SHUTDOWN_MARKER)) {
      return c.json({ status: 'shutting_down' }, 503);
    }
    return c.json({
      status: 'ok',
      version: process.env.TALE_VERSION ?? 'dev',
    });
  });

  // Precompiled SEO + LLM artifacts (`/llms.txt`, `/llms-full.txt`,
  // `/robots.txt`). The platform doesn't have a public surface, but we
  // still serve these for parity with the other Tale services. The
  // artifact set is materialised in the Docker builder stage and served
  // from `./dist-seo` here.
  const handleArtifact = async (request: Request): Promise<Response> => {
    const server = await platformArtifactsServer();
    const response = await server.handle(request);
    return response ?? new Response('Not found', { status: 404 });
  };
  app.all('/llms.txt', (c) => handleArtifact(c.req.raw));
  app.all('/llms-full.txt', (c) => handleArtifact(c.req.raw));
  app.all('/robots.txt', (c) => handleArtifact(c.req.raw));

  // Public, unauthenticated overall up/down. Hono catches this before the
  // SPA `*` fallback below, so it bypasses the TanStack Router shell. Caddy
  // forwards `/status` and `/status.json` to this handler via the default
  // `reverse_proxy platform:3000` (no `/api/*` collision with the
  // Convex-bound block). Both routes project from the same `StatusFeed`
  // so the human and machine views cannot drift.
  app.get('/status', async (c) => {
    const feed = buildStatusFeed(await probeServices());
    const html = renderStatusPage(feed, c.req.header('accept-language') ?? '');
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=5',
      },
    });
  });

  app.get('/status.json', async () => {
    const feed = buildStatusFeed(await probeServices());
    return new Response(renderStatusJson(feed), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=5',
      },
    });
  });

  app.get('/events/file', async (c) => {
    if (!env.FILE_EVENTS_ENABLED) return c.notFound();

    // Auth gate. SSE clients (EventSource) cannot set Authorization
    // headers but DO send same-origin cookies, so we forward the
    // request's Cookie to Convex's `/api/sse/auth` httpAction which
    // validates the Better Auth session and returns the user's org
    // memberships. Anonymous / cross-tenant fan-out used to leak
    // every org's config-item names; per-client `allowedOrgSlugs`
    // gates events at fan-out time so foreign-org payloads never
    // reach the wire.
    const cookieHeader = c.req.header('cookie');
    const allowedOrgSlugs = await resolveAllowedOrgSlugs(cookieHeader);
    if (allowedOrgSlugs === null) {
      return new Response('Unauthenticated', {
        status: 401,
        headers: {
          'Cache-Control': 'no-store',
          Vary: 'Cookie',
          'WWW-Authenticate': 'Cookie',
        },
      });
    }

    let client: SseClient;
    const stream = new ReadableStream({
      start(controller) {
        client = { controller, allowedOrgSlugs };
        sseClients.add(client);
        controller.enqueue('data: {"type":"connected"}\n\n');
      },
      cancel() {
        sseClients.delete(client);
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Vary: 'Cookie',
      },
    });
  });

  app.get('/metrics', () => metricsResponse());

  app.get('/metrics/convex', (c) =>
    convexMetricsResponse(c.req.query('format') ?? null),
  );

  // Branding images. Defense-in-depth: filename is already locked
  // down (no `/`, no `..`), but the prefix check uses `path.sep` so a
  // future sibling dir like `imagesXYZ/` cannot prefix-match via
  // string compare. We also pin Content-Type from an allowlist
  // instead of letting Bun.file infer it from the extension so a
  // mis-renamed file cannot be served with a script-y content type.
  const BRANDING_MIME: Record<string, string> = {
    png: 'image/png',
    svg: 'image/svg+xml',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ico: 'image/x-icon',
  };
  app.get('/branding/images/:filename', async (c) => {
    if (!brandingImagesDir) return c.notFound();
    const filename = c.req.param('filename');
    if (!filename || filename.includes('/') || filename.includes('..')) {
      return c.notFound();
    }
    const filePath = resolve(brandingImagesDir, filename);
    if (
      !filePath.startsWith(brandingImagesDir + sep) &&
      filePath !== brandingImagesDir
    ) {
      return c.notFound();
    }
    const file = Bun.file(filePath);
    if (!(await file.exists())) return c.notFound();
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const contentType = BRANDING_MIME[ext];
    if (!contentType) return c.notFound();
    return new Response(file, {
      headers: {
        'Cache-Control': 'no-cache, must-revalidate',
        'Content-Type': contentType,
      },
    });
  });

  // WebDAV server (/dav/<orgSlug>/...). HTTP Basic auth with per-user
  // app-passwords; Caddy default fallback already routes /dav/* here so
  // no proxy rule is needed. Code lives in `lib/webdav/`; the same
  // protocol layer is mirrored into Vite dev by `vite-plugins/serve-webdav.ts`.
  //
  // CSP / security-headers from `secureHeaders` would clobber blob
  // responses on GET — webdav handlers set their own Content-Type and
  // we want the raw bytes through. Skip the middleware on this path.
  const webdavAdminKey = process.env.ADMIN_KEY ?? '';
  // Dev parity: `docker-entrypoint.sh` derives this deterministically from
  // INSTANCE_SECRET in prod; ensureWebdavHmacKey mirrors that derivation so
  // `bun dev` works without an explicit operator step. An explicit env var
  // always wins — operators rotating the HMAC key set it directly in
  // .env.local.
  const webdavHmacKey = ensureWebdavHmacKey() ?? '';
  const webdavConvexUrl = process.env.CONVEX_URL ?? 'http://convex:3210';
  // Boot-time visibility into the two preconditions for /dav/*. We log
  // and continue instead of throwing so the rest of the platform serves
  // even when the operator hasn't configured WebDAV yet; the per-request
  // handler then 500s with an actionable message.
  if (!webdavAdminKey) {
    console.warn(
      '[webdav] ADMIN_KEY unset — /dav/* will 500. Set via docker-entrypoint (prod) or .env.local (dev).',
    );
  }
  if (!webdavHmacKey || webdavHmacKey.length < WEBDAV_HMAC_KEY_MIN_LENGTH) {
    console.warn(
      `[webdav] WEBDAV_APP_PASSWORD_HMAC_KEY unset or too short (need ${WEBDAV_HMAC_KEY_MIN_LENGTH} hex chars) — /dav/* will 500.`,
    );
  }
  let webdavCtx: ReturnType<typeof makeWebdavCtx> | null = null;
  function getWebdavCtx() {
    if (!webdavAdminKey) {
      throw new Error(
        'ADMIN_KEY not set — required for /dav/* (webdav server reads Convex via admin auth)',
      );
    }
    if (!webdavCtx) {
      webdavCtx = makeWebdavCtx({
        convexUrl: webdavConvexUrl,
        adminKey: webdavAdminKey,
        // Escape hatch for the GET storage-proxy fallback when the Convex
        // site origin isn't `<backend host>:3211` — e.g. an external Convex
        // on non-default ports or a single-origin HTTPS front. Defaults to
        // the :3211 derivation when unset.
        convexSiteUrl: process.env.WEBDAV_CONVEX_SITE_URL || undefined,
      });
    }
    return webdavCtx;
  }
  const webdavHandler = (c: { req: { raw: Request } }) =>
    webdavFetchAdapter(c.req.raw, getWebdavCtx());
  // Hono's `Method` union covers RFC 7231 verbs only. WebDAV adds
  // PROPFIND/PROPPATCH/MKCOL/MOVE/COPY/LOCK/UNLOCK, which Hono's router
  // accepts at runtime via `app.on(string[], ...)` but the TS overload
  // declares the narrower `Method[]`. Cast intentionally.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  app.on(WEBDAV_METHODS as unknown as string[], '/dav/*', webdavHandler);
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  app.on(WEBDAV_METHODS as unknown as string[], '/dav', webdavHandler);

  // Static files + index.html fallback (TanStack Router SPA).
  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;

    if (pathname !== '/') {
      const filePath = resolve(distDir, pathname.slice(1));
      if (filePath.startsWith(distDir)) {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      }
    }

    if (!indexHtmlTemplate) {
      const indexFile = Bun.file(join(distDir, 'index.html'));
      if (!(await indexFile.exists())) {
        console.error(`Missing dist/index.html in ${distDir}`);
        return c.text('Internal Server Error', 500);
      }
      indexHtmlTemplate = await indexFile.text();
    }

    const acceptLanguage = c.req.header('accept-language') ?? '';
    const basePath = getBasePath();
    // Per-request nonce produced by `secureHeaders` middleware. Injected
    // into every <script> tag so the strict CSP `script-src` (which uses
    // a nonce token instead of `'unsafe-inline'`) accepts the inline
    // __ENV__ injection and any other inline scripts in index.html.
    const nonce = c.get('secureHeadersNonce');

    let html = indexHtmlTemplate
      .replace(
        /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
        `window.__ENV__ = ${JSON.stringify(env)};`,
      )
      .replace(
        /window\.__ACCEPT_LANGUAGE__\s*=\s*['"]__ACCEPT_LANGUAGE_PLACEHOLDER__['"];/,
        `window.__ACCEPT_LANGUAGE__ = ${JSON.stringify(acceptLanguage)};`,
      );

    if (nonce) {
      html = html.replace(
        /<script(?![^>]*\bnonce=)/g,
        `<script nonce="${nonce}"`,
      );
    }

    html = html.replace(
      '<head>',
      `<head>\n    <base href="${escapeHtmlAttr(basePath)}/">`,
    );

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  });

  return app;
}

if (import.meta.main) {
  initTelemetry();
  const app = createApp();
  Bun.serve({
    port,
    hostname: '0.0.0.0',
    fetch: app.fetch,
  });
}
