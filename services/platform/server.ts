import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrecompiledServer, type ArtifactsServer } from '@tale/ui/seo';
import { Hono } from 'hono';
import { NONCE, secureHeaders } from 'hono/secure-headers';

import {
  buildCanvasPreviewCsp,
  wrapCanvasPreviewHtml,
} from './lib/canvas-preview-shell';
import { createConfigWatcher } from './lib/config-watcher';
import { createOrgObjectStorageOriginsProvider } from './lib/org-storage-origins';
import {
  createScreencastRelayHandler,
  type ScreencastWsData,
} from './lib/screencast-relay';
import { injectBootShell, shouldServeBootShell } from './lib/shared/boot-shell';
import { isValidOrgSlug } from './lib/shared/constants/org-slug';
import { parseSessionIdleTimeoutMinutes } from './lib/shared/session-idle';
import { slaRulesResponse } from './sla-targets';
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
  // stream. The only org-agnostic message is the `{type:"connected"}`
  // ping, which is enqueued directly at stream start and never passes
  // through the watcher fan-out.
  allowedOrgSlugs: Set<string>;
}

const sseClients = new Set<SseClient>();

/**
 * Fan-out predicate for config-watcher SSE events. Default-deny: an event
 * is delivered only when it carries a string `orgSlug` the client is a
 * member of. Every config-watcher event carries an `orgSlug` (see
 * lib/config-watcher.ts: parseConfigChange always sets it for valid
 * paths); if a future event type appears without one, it reaches no
 * client — the legacy fan-out-to-everyone behavior is what this closes.
 */
export function shouldDeliverSseEvent(
  event: unknown,
  allowedOrgSlugs: ReadonlySet<string>,
): boolean {
  const eventOrg =
    typeof event === 'object' && event !== null && 'orgSlug' in event
      ? (event as { orgSlug?: unknown }).orgSlug
      : undefined;
  return typeof eventOrg === 'string' && allowedOrgSlugs.has(eventOrg);
}

const fileEventsEnabled = process.env.TALE_FILE_EVENTS === 'true';
const configDir = process.env.TALE_CONFIG_DIR;
// TALE_CONFIG_DIR points at the org config-store volume (still named
// `convex-data` so no operator has to migrate a volume for a rename)
// mounted read-only on the platform container (for config-file SSE + branding
// image serving). Skip watcher setup gracefully if the directory is absent.
if (fileEventsEnabled && configDir && existsSync(configDir)) {
  const watcher = createConfigWatcher(configDir);
  watcher.onChange((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      // Per-event org filter — see shouldDeliverSseEvent for the
      // default-deny contract.
      if (!shouldDeliverSseEvent(event, client.allowedOrgSlugs)) continue;
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

// Live view of the org BYO object-storage endpoint origins the CSP must
// allow (see the security-headers comment block below). Deliberately NOT
// gated by TALE_FILE_EVENTS — security headers must not depend on the SSE
// feature flag; the provider is a no-op returning `[]` when the config dir
// isn't mounted.
const defaultOrgStorageOrigins = createOrgObjectStorageOriginsProvider(
  configDir ?? null,
);

/**
 * The backend tier this process asks for verdicts it cannot reach a database
 * to answer (the two oracles in `backend/realtime/oracle-routes.ts`). Compose
 * sets TALE_BACKEND_URL to the in-network name; the loopback default is what
 * `bun dev` uses, matching vite.config.ts and status-probe.ts.
 *
 * Read per call, never frozen at import: the module is loaded before the
 * process env is fully assembled in some entry paths.
 */
function backendBaseUrl(): string {
  const configured = (process.env.TALE_BACKEND_URL ?? '').replace(/\/+$/, '');
  return configured === '' ? 'http://127.0.0.1:3005' : configured;
}

async function resolveAllowedOrgSlugs(
  cookieHeader: string | undefined,
): Promise<Set<string> | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${backendBaseUrl()}/api/sse/auth`, {
      headers: { cookie: cookieHeader },
    });
    if (res.status === 401) return null;
    if (!res.ok) {
      console.warn(`[/events/file] backend auth lookup returned ${res.status}`);
      return null;
    }
    const body: unknown = await res.json();
    const slugs =
      body && typeof body === 'object' && 'orgSlugs' in body
        ? body.orgSlugs
        : null;
    if (!Array.isArray(slugs)) return new Set();
    return new Set(
      slugs.filter((s): s is string => typeof s === 'string' && s.length > 0),
    );
  } catch (err) {
    console.warn('[/events/file] backend auth lookup failed', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Screencast (live browser view) WebSocket termination.
//
// The browser opens `wss://<site>/screencast/<threadId>` (noVNC). This is the
// ONLY browser-facing WS termination in the deployment. server.ts authenticates
// the upgrade (cookie+org) by forwarding the Cookie header to the backend's
// `/api/sandbox/screencast-auth` oracle — this process has no database, so the
// oracle runs the thread-view boundary and maps the thread → its live sandbox
// session. On 200 we upgrade and relay raw binary RFB
// frames to the spawner WS (lib/screencast-relay.ts). The chain:
//   browser → [here] → spawner WS (HMAC) → runnerd tunnel → x11vnc.
// ---------------------------------------------------------------------------

/** `GET /screencast/<threadId>` — the (percent-encoded) threadId is the single
 * path segment. Anchored so it can't match a deeper path. */
export const SCREENCAST_ROUTE_RE = /^\/screencast\/([^/]+)$/;

type ScreencastAuthResult =
  | { ok: true; sessionId: string; control: boolean }
  | { ok: false; status: number; body: string; contentType: string };

/**
 * Authorize a screencast WS upgrade by forwarding the request Cookie to the
 * backend's `/api/sandbox/screencast-auth` door (the same mechanism
 * `resolveAllowedOrgSlugs` uses). The oracle resolves identity from the
 * session cookie and runs the thread-view boundary, returning the live
 * sessionId on success. We propagate its status (401/403/409/429) verbatim
 * so the browser sees the same refusal the workspace-file route would give.
 */
export async function authorizeScreencast(
  threadId: string,
  cookieHeader: string | undefined,
  control = false,
): Promise<ScreencastAuthResult> {
  const deny = (
    status: number,
    body: string,
    contentType = 'text/plain',
  ): ScreencastAuthResult => ({ ok: false, status, body, contentType });
  if (!cookieHeader) return deny(401, 'Unauthenticated');
  let res: Response;
  try {
    const target = `${backendBaseUrl()}/api/sandbox/screencast-auth?threadId=${encodeURIComponent(
      threadId,
    )}${control ? '&control=1' : ''}`;
    res = await fetch(target, { headers: { cookie: cookieHeader } });
  } catch (err) {
    console.warn('[/screencast] backend auth lookup failed', err);
    return deny(502, 'Bad Gateway');
  }
  if (res.status === 200) {
    let sessionId: unknown;
    let controlGranted = false;
    try {
      const body: unknown = await res.json();
      sessionId =
        body && typeof body === 'object' && 'sessionId' in body
          ? body.sessionId
          : undefined;
      controlGranted =
        body !== null &&
        typeof body === 'object' &&
        (body as { control?: unknown }).control === true;
    } catch (err) {
      console.warn('[/screencast] backend auth 200 with unreadable body', err);
      return deny(502, 'Bad Gateway');
    }
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      return { ok: true, sessionId, control: controlGranted };
    }
    return deny(502, 'Bad Gateway');
  }
  // Non-200: forward the oracle's status + body so the client sees the same
  // refusal (409 session_not_running is JSON; 401/403/429 are plain text).
  const contentType = res.headers.get('content-type') ?? 'text/plain';
  let body: string;
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  return deny(res.status, body, contentType);
}

const screencastWsHandler = createScreencastRelayHandler();

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
  SESSION_IDLE_TIMEOUT_MINUTES?: number;
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: readonly string[];
}

const port = process.env.PORT || 3000;
const moduleDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(moduleDir, 'dist');
const distSeoDir = join(moduleDir, 'dist-seo');

// Content-hashed bundler output — `assets/<name>-<hash>.js|css` (+ its `.map`) —
// is content-addressed: a given filename never maps to different bytes across
// builds (Vite's default hashing; the deploy publishes a fresh tree and never
// reuses a name), so it is safe to cache forever as immutable. Everything else
// served from `dist/` has a stable name that CAN change across deploys —
// `index.html`, `sw.js`, `manifest.webmanifest`, favicons, the un-hashed
// `public/assets/*` images, and version-pinned `/canvas-libs/*` — so those must
// revalidate. Scoping to `/assets/` + the `.js|.css` extension keeps the
// un-hashed images (svg/png) and `/canvas-libs/*` out of the immutable bucket;
// the hash pattern is belt-and-suspenders. `{8,}` (not `{8}`) because Rollup
// extends a hash past its usual 8 chars to break collisions between same-named
// chunks (e.g. several `queries-*.js`). Fail-safe: an unmatched hashed file
// merely loses the optimization (revalidates), never serves stale bytes.
const IMMUTABLE_ASSET =
  /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css)(?:\.map)?$/;
export function cacheControlForStaticPath(pathname: string): string {
  return IMMUTABLE_ASSET.test(pathname)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}
// Branding is per-org: images live at
// `${TALE_CONFIG_DIR}/<orgSlug>/branding/images/<filename>`. The org slug is a
// path segment in the request (`/branding/images/:orgSlug/:filename`) and is
// validated against the slug allowlist before being joined, so it can't be
// used for traversal. The `default` slug backs the pre-auth shell.
const brandingConfigRoot = process.env.TALE_CONFIG_DIR ?? null;
function resolveBrandingImagesDir(orgSlug: string): string | null {
  if (!brandingConfigRoot || !isValidOrgSlug(orgSlug)) return null;
  return join(brandingConfigRoot, orgSlug, 'branding', 'images');
}

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

// Prerendered dashboard boot shell (dist/boot-shell.html, written by
// scripts/prerender-boot-shell.tsx after `vite build`). Injected into #root
// for dashboard navigations so the first paint shows the sidebar rail —
// before any JS runs. A missing artifact degrades to the empty-#root
// behaviour (memoized so prod doesn't stat per request; dev hot-reload
// re-reads like the index template).
let bootShellTemplate: string | null | undefined;

async function readBootShellTemplate(): Promise<string | null> {
  if (!DEV_HOT_RELOAD && bootShellTemplate !== undefined) {
    return bootShellTemplate;
  }
  const file = Bun.file(join(distDir, 'boot-shell.html'));
  const content = (await file.exists()) ? await file.text() : null;
  if (content === null && bootShellTemplate === undefined) {
    console.warn(
      'Missing dist/boot-shell.html — dashboard first paint falls back to an empty shell (did the build run prerender-boot-shell?)',
    );
  }
  bootShellTemplate = content;
  return content;
}

// In `docker:dev` hot-reload, the entrypoint's frontend watcher rebuilds
// dist/index.html on every change with freshly content-hashed chunk names (and
// deletes the old chunks). Memoizing the template would keep serving a stale
// index.html that
// references already-deleted chunks → the browser gets the SPA fallback (HTML)
// for a missing `.js` and the page goes blank. So in that mode (and only then)
// re-read index.html per request. Gating matches the entrypoint's watcher
// gate (NODE_ENV=development + TALE_DEV_HOT_RELOAD≠0); production keeps the
// one-time cache untouched.
const DEV_HOT_RELOAD =
  process.env.NODE_ENV === 'development' &&
  process.env.TALE_DEV_HOT_RELOAD !== '0';

// Dev live-reload: a build id that changes whenever the frontend watcher
// publishes a new dist/ (the atomic symlink swap rewrites index.html, so its
// mtime moves). Returns '0' if dist/index.html is momentarily absent. The
// injected client script (below) polls this and hard-reloads when it changes —
// so an edit shows up on its own ~1s after the rebuild lands, with no HMR
// websocket (which we deliberately avoid through Caddy's self-signed TLS).
function devBuildId(): string {
  try {
    return String(statSync(join(distDir, 'index.html')).mtimeMs);
  } catch {
    return '0';
  }
}

// Polls the build id and reloads when it changes. Relative URL resolves against
// the injected <base href>, so it is base-path safe. Gets a CSP nonce from the
// same pass that nonces index.html's own scripts. Only injected when
// DEV_HOT_RELOAD is on.
const DEV_RELOAD_SCRIPT = `<script>
(() => {
  let current = null;
  const poll = () =>
    fetch('__dev/reload-id', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : null))
      .then((id) => {
        if (id == null) return;
        if (current === null) current = id;
        else if (id !== current) location.reload();
      })
      .catch(() => {});
  setInterval(poll, 1000);
})();
</script>`;

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
    // Idle-timeout window for the client watchdog (#1502). Validated/clamped
    // server-side; `undefined` (omitted from __ENV__) when the feature is off.
    SESSION_IDLE_TIMEOUT_MINUTES: parseSessionIdleTimeoutMinutes() ?? undefined,
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
//   - Org bring-your-own object storage: endpoint origins read from
//     `<TALE_CONFIG_DIR>/<orgSlug>/object-storage/connection.json` are
//     appended to connect-src (browser-direct presigned PUT uploads +
//     fetch-based downloads) and img-src / media-src (the `/storage`
//     route 302s media to presigned GETs on the same endpoint). These are
//     org-admin-configured storage backends holding the org's OWN data —
//     the org, not a third party, is the controller — so they don't fall
//     under the CDN prohibition above. Sourced live from config (see
//     `lib/org-storage-origins.ts`), never from env.
//
// All OTHER backend traffic — including deployment-default storage uploads
// and downloads — flows same-origin through Caddy (`/api/*`), so `'self'`
// covers it. The one exception is the org BYO object-storage lane above:
// the upload door
// hands the browser a presigned PUT addressed directly at the org's
// endpoint, deliberately bypassing the platform so multi-hundred-MB blobs
// never transit (or OOM) the server. SITE_URL hostname determines
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

// Canonical origin the platform builds its own absolute asset URLs from.
// Branding assets (custom favicons, logos, and any branding-served font) are
// addressed by `buildBrandingImageUrl` as `<SITE_URL>/branding/...`, i.e. an
// absolute URL pinned to the canonical SITE_URL. When the app is reached from
// a host that differs from SITE_URL (reverse proxy, custom domain, www/apex
// split), those assets are cross-origin to the document and `'self'` no longer
// matches — so they're blocked by `img-src`/`font-src 'self'`. Locally
// SITE_URL is usually unset, the URLs are relative, and everything is
// same-origin, which is why this only bites in production. This is the
// operator's OWN origin (never a third-party CDN), so allow-listing it keeps
// the policy strict and needs no third-party data-transfer review.
function siteOriginFromUrl(siteUrl: string | undefined): string | null {
  if (!siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    return url.origin;
  } catch (err) {
    console.warn('Invalid SITE_URL, skipping CSP allow-list entry:', err);
    return null;
  }
}

function buildContentSecurityPolicy(
  env: EnvConfig,
  orgStorageOrigins: readonly string[] = [],
) {
  const sentryOrigin = sentryOriginFromDsn(env.SENTRY_DSN);
  const sentry = sentryOrigin ? [sentryOrigin] : [];
  const figmaMcp = isLoopbackSite(env) ? ['https://mcp.figma.com'] : [];
  // The platform's own canonical origin, so branding assets served as
  // absolute `<SITE_URL>/branding/...` URLs load even when the document is
  // reached from a different host than SITE_URL. Omitted (empty) when
  // SITE_URL is unset/relative — then assets are same-origin and `'self'`
  // already covers them.
  const siteOrigin = siteOriginFromUrl(env.SITE_URL);
  const branding = siteOrigin ? [siteOrigin] : [];
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
    imgSrc: ["'self'", 'data:', 'blob:', ...branding, ...orgStorageOrigins],
    fontSrc: ["'self'", 'data:', ...branding],
    connectSrc: ["'self'", ...sentry, ...orgStorageOrigins],
    workerSrc: ["'self'", 'blob:'],
    frameSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    // TTS playback streams audio from same-origin `/http_api/api/tts-audio`
    // via `<audio>.src`, so `'self'` is required. Org BYO storage origins
    // are included because `/storage` 302s audio/video attachments to
    // presigned GETs on the org's endpoint.
    mediaSrc: ["'self'", ...orgStorageOrigins],
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

export interface CreateAppOptions {
  /**
   * Test seam for the org BYO object-storage origins fed into the CSP.
   * Production uses the TTL-cached `TALE_CONFIG_DIR` scan.
   */
  orgStorageOrigins?: () => readonly string[];
}

export function createApp(
  env: EnvConfig = getEnvConfig(),
  opts: CreateAppOptions = {},
): Hono {
  const app = new Hono();

  const makeSecure = (storageOrigins: readonly string[]) =>
    secureHeaders({
      contentSecurityPolicy: buildContentSecurityPolicy(env, storageOrigins),
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
        // copy-to-clipboard hook is wired into many UI surfaces; live-browser
        // human takeover reads the host clipboard (`navigator.clipboard.readText`)
        // to bridge a paste into the remote session — both need same-origin grants.
        geolocation: ['self'],
        clipboardWrite: ['self'],
        clipboardRead: ['self'],
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
  // Org BYO storage endpoints are runtime config (the org data-residency
  // panel writes them, no restart involved), so the CSP has to follow
  // without a process restart: re-check the (TTL-cached) origin set per
  // request and rebuild the middleware only when it actually changed.
  const orgStorageOrigins = opts.orgStorageOrigins ?? defaultOrgStorageOrigins;
  let secureOriginsKey: string | null = null;
  let secure = makeSecure([]);
  const currentSecure = () => {
    const origins = orgStorageOrigins();
    const key = origins.join(' ');
    if (key !== secureOriginsKey) {
      secureOriginsKey = key;
      secure = makeSecure(origins);
    }
    return secure;
  };
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
    return currentSecure()(c, next);
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
  // backend-bound block). Both routes project from the same `StatusFeed`
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
    // request's Cookie to the backend's `/api/sse/auth` door, which
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

    // `undefined` until start() runs — a cancel that fires before then
    // must not call `sseClients.delete(undefined)`, so cancel() guards.
    let client: SseClient | undefined;
    const stream = new ReadableStream({
      start(controller) {
        client = { controller, allowedOrgSlugs };
        sseClients.add(client);
        controller.enqueue('data: {"type":"connected"}\n\n');
      },
      cancel() {
        if (client) sseClients.delete(client);
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

  // Generated Prometheus recording + alerting rules for the response-time
  // SLAs, derived from the canonical targets in `sla-targets.ts`. Operators
  // load these instead of hand-copying thresholds; the rule expressions track
  // the same budgets exposed as `tale_sla_target_seconds` on `/metrics`.
  app.get('/metrics/sla-rules', () => slaRulesResponse());

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
  app.get('/branding/images/:orgSlug/:filename', async (c) => {
    const imagesDir = resolveBrandingImagesDir(c.req.param('orgSlug'));
    if (!imagesDir) return c.notFound();
    const filename = c.req.param('filename');
    if (!filename || filename.includes('/') || filename.includes('..')) {
      return c.notFound();
    }
    const filePath = resolve(imagesDir, filename);
    if (!filePath.startsWith(imagesDir + sep) && filePath !== imagesDir) {
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

  // Dev live-reload build-id endpoint (polled by DEV_RELOAD_SCRIPT). Registered
  // before the SPA catch-all so it is not swallowed by it; dev-only.
  if (DEV_HOT_RELOAD) {
    app.get('/__dev/reload-id', (c) =>
      c.text(devBuildId(), 200, { 'Cache-Control': 'no-store' }),
    );
  }

  // Static files + index.html fallback (TanStack Router SPA).
  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;

    if (pathname !== '/') {
      const filePath = resolve(distDir, pathname.slice(1));
      if (filePath.startsWith(distDir)) {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          // Bun infers Content-Type from the file extension; we only add the
          // caching directive (immutable for content-hashed chunks).
          return new Response(file, {
            headers: { 'Cache-Control': cacheControlForStaticPath(pathname) },
          });
        }
      }
    }

    let template = indexHtmlTemplate;
    if (template === null || DEV_HOT_RELOAD) {
      const indexFile = Bun.file(join(distDir, 'index.html'));
      if (!(await indexFile.exists())) {
        console.error(`Missing dist/index.html in ${distDir}`);
        return c.text('Internal Server Error', 500);
      }
      template = await indexFile.text();
      // Only memoize in production; in dev the next rebuild invalidates it.
      if (!DEV_HOT_RELOAD) {
        indexHtmlTemplate = template;
      }
    }

    const acceptLanguage = c.req.header('accept-language') ?? '';
    const basePath = getBasePath();
    // Per-request nonce produced by `secureHeaders` middleware. Injected
    // into every <script> tag so the strict CSP `script-src` (which uses
    // a nonce token instead of `'unsafe-inline'`) accepts the inline
    // __ENV__ injection and any other inline scripts in index.html.
    const nonce = c.get('secureHeadersNonce');

    let html = template
      .replace(
        /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
        `window.__ENV__ = ${JSON.stringify(env)};`,
      )
      .replace(
        /window\.__ACCEPT_LANGUAGE__\s*=\s*['"]__ACCEPT_LANGUAGE_PLACEHOLDER__['"];/,
        `window.__ACCEPT_LANGUAGE__ = ${JSON.stringify(acceptLanguage)};`,
      );

    // Dashboard navigations get the prerendered boot shell injected into
    // #root — the SPA's stand-in for SSR: the sidebar rail is already on
    // screen before the bundle loads. Script-free markup, so it needs no
    // nonce from the CSP pass below.
    if (shouldServeBootShell(pathname, basePath)) {
      const shell = await readBootShellTemplate();
      if (shell) {
        html = injectBootShell(html, shell);
      }
    }

    // Inject the dev live-reload poller before nonce-stamping so it is covered
    // by the same CSP nonce pass as index.html's own scripts.
    if (DEV_HOT_RELOAD) {
      html = html.replace('</body>', `    ${DEV_RELOAD_SCRIPT}\n  </body>`);
    }

    if (nonce) {
      html = html.replace(
        /<script(?![^>]*\bnonce=)/g,
        // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- nonce is a server-generated CSP nonce, not user input
        `<script nonce="${nonce}"`,
      );
    }

    html = html.replace(
      '<head>',
      `<head>\n    <base href="${escapeHtmlAttr(basePath)}/">`,
    );

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        // Never cache the SPA shell without revalidation: it embeds the
        // content-hashed chunk filenames, which change on every deploy, so a
        // heuristically-cached shell would reference deleted chunks. In dev a
        // live-reload must fetch the freshly-published index.html, and
        // `no-store` additionally blocks any reuse of a stale shell.
        'Cache-Control': DEV_HOT_RELOAD ? 'no-store' : 'no-cache',
      },
    });
  });

  return app;
}

if (import.meta.main) {
  initTelemetry();
  const app = createApp();
  Bun.serve<ScreencastWsData>({
    port,
    hostname: '0.0.0.0',
    // Bun's default idleTimeout (10s) would kill the long-lived `/events/file`
    // SSE stream and an idle (no input/no framebuffer delta) screencast WS.
    // Match the spawner's screencast server: 255 (Bun's max). RFB sends
    // periodic framebuffer updates and noVNC pings, so a healthy viewer never
    // trips this; it only backstops a wedged socket.
    idleTimeout: 255,
    // Wrapper around the Hono app: intercept the browser-facing screencast WS
    // upgrade (which needs the live Server instance for `server.upgrade`, only
    // available here), and delegate EVERYTHING else to app.fetch unchanged so
    // every existing route (incl. the `/events/file` SSE) is preserved.
    async fetch(req, server) {
      const url = new URL(req.url);
      const screencastMatch =
        req.method === 'GET' &&
        req.headers.get('upgrade')?.toLowerCase() === 'websocket'
          ? SCREENCAST_ROUTE_RE.exec(url.pathname)
          : null;
      if (screencastMatch) {
        // The captured segment is percent-encoded by the client
        // (buildScreencastUrl → encodeURIComponent). Decode before handing it
        // to the auth oracle / session resolver.
        let threadId: string;
        try {
          threadId = decodeURIComponent(screencastMatch[1] ?? '');
        } catch {
          return new Response('Bad Request', { status: 400 });
        }
        if (!threadId) return new Response('Bad Request', { status: 400 });

        // `?control=1` requests a WRITABLE browser (human takeover); the oracle
        // decides whether to grant it (pending handoff + owner + lease) and a
        // denied control request still streams read-only.
        const wantControl = url.searchParams.get('control') === '1';
        // Auth BEFORE upgrade: a denied viewer never reaches the relay.
        const auth = await authorizeScreencast(
          threadId,
          req.headers.get('cookie') ?? undefined,
          wantControl,
        );
        if (!auth.ok) {
          return new Response(auth.body, {
            status: auth.status,
            headers: {
              'Content-Type': auth.contentType,
              'Cache-Control': 'no-store',
              Vary: 'Cookie',
            },
          });
        }
        const upgraded = server.upgrade(req, {
          data: { sessionId: auth.sessionId, threadId, control: auth.control },
        });
        // On success Bun owns the socket and `fetch` must return undefined.
        if (upgraded) return undefined;
        return new Response('Upgrade failed', { status: 500 });
      }
      return app.fetch(req, server);
    },
    websocket: screencastWsHandler,
  });
}
