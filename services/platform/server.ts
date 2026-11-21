import { createHash, randomUUID } from 'node:crypto';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve, type ServerType } from '@hono/node-server';
import { parseSessionIdleTimeoutMinutes } from '@tale/shared/utils/session-idle';
import {
  requestSiteOrigin,
  resolveSiteOrigins,
} from '@tale/shared/utils/site-urls';
import { createAnalytics } from '@tale/ui/analytics/server';
// The precompiled server alone: the `@tale/ui/seo` barrel also loads the
// compiler behind it (markdown parsers, an HTML parser), which only the
// build runs.
import type { ArtifactsServer } from '@tale/ui/seo/runtime/on-demand-server';
import { createPrecompiledServer } from '@tale/ui/seo/runtime/precompiled-server';
import {
  createServingIdentity,
  SERVING_IDENTITY_HEADER,
} from '@tale/ui/server/serving-identity';
import { Hono } from 'hono';
import { NONCE, secureHeaders } from 'hono/secure-headers';

import { closeHttpServer } from './backend/lib/close-http-server';
import {
  BACKEND_SERVER_OPTIONS,
  headContentLength,
  installClientErrorEnvelope,
} from './backend/lib/http-hygiene';
import { PLATFORM_ROOT } from './backend/lib/layout';
import {
  parseAuthenticatorEnv,
  type AuthenticatorEnv,
} from './lib/authenticator-env';
import {
  buildCanvasPreviewCsp,
  wrapCanvasPreviewHtml,
} from './lib/canvas-preview-shell';
import { createConfigWatcher } from './lib/config-watcher';
import { parseContactSupportUrl } from './lib/contact-support-url';
import { createOrgFrameAncestorsProvider } from './lib/org-frame-ancestors';
import { createOrgObjectStorageOriginsProvider } from './lib/org-storage-origins';
import { injectBootShell, shouldServeBootShell } from './lib/shared/boot-shell';
import { isValidOrgSlug } from './lib/shared/constants/org-slug';
import {
  publishStaticAssets,
  maintainStaticAssets,
  retainedAssetName,
  STATIC_ASSETS_DIR,
} from './lib/static-assets';
import { readTextFile, staticFileResponse } from './lib/static-file';
import { inlineScriptJson, replaceLiteral } from './lib/utils/inline-script';
import { slaRulesResponse } from './sla-targets';
import {
  buildStatusFeed,
  probeServices,
  renderStatusJson,
  renderStatusPage,
} from './status-probe';
import { metricsResponse } from './telemetry';

// The run markers, files in /tmp this process and the runtime set. The
// entrypoint deletes all of them, as root, at every start.
const MARKER_DIRECTORY = '/tmp';
// Graceful shutdown marker, written when the process is told to stop
// (`startWebServer`'s `markShuttingDown`). When present, /api/health returns
// 503 so a balancer that checks each replica drains traffic before the
// process actually terminates.
const SHUTDOWN_MARKER = 'platform-shutting-down';
// Written once the process serves (`markReady`): the compose healthcheck's
// gate.
const READY_MARKER = 'platform-ready';
// Set by a blue/green runtime that takes this replica out of its traffic
// switch (Incus), read by `/api/admission` alone. Docker never sets it.
const WITHDRAWN_MARKER = 'platform-withdrawn';

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
  // The periodic comment frame (see SSE_HEARTBEAT_MS); cleared when the
  // client goes away by either door (cancel, or a failed enqueue).
  heartbeat: ReturnType<typeof setInterval>;
}

const sseClients = new Set<SseClient>();

/**
 * How often an idle `/events/file` stream writes a `: ping` comment frame.
 * Config changes are rare, so without it a quiet client sits silent until
 * something between it and this process gives the connection up for idle
 * (the edge and many corporate proxies do, within minutes); the EventSource
 * then reconnects, costing a backend auth lookup per cycle and dropping any
 * change event that lands in the gap. 30 s keeps a healthy client well
 * inside any such timeout; a comment frame is invisible to EventSource
 * consumers.
 */
const SSE_HEARTBEAT_MS = 30_000;

/** Forget a client and stop its heartbeat — the one place both happen. */
function dropSseClient(client: SseClient): void {
  clearInterval(client.heartbeat);
  sseClients.delete(client);
}

/**
 * End every open `/events/file` stream, for a process that is stopping: the
 * streams never end on their own, so a listener waiting for its connections
 * to finish would wait for the force deadline. A client reconnects to
 * whichever replica answers next. Returns how many were open.
 */
export function endFileEventStreams(): number {
  const open = [...sseClients];
  for (const client of open) {
    dropSseClient(client);
    try {
      client.controller.close();
    } catch (error) {
      // Closed already from the other end; the client is forgotten either way.
      console.warn('SSE close at shutdown failed (ignored)', error);
    }
  }
  return open.length;
}

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
// TALE_CONFIG_DIR points at the org config-store volume (`config-data`)
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
        dropSseClient(client);
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

// Live view of the web origins organizations allow to embed their pages in
// a frame (the `embedding` governance policy) — the SPA shell's
// `frame-ancestors`. Same provider shape and the same independence from
// TALE_FILE_EVENTS as the storage origins above.
const defaultOrgFrameAncestors = createOrgFrameAncestorsProvider(
  configDir ?? null,
);

/**
 * The API this app asks for verdicts it cannot reach a database to answer
 * (the oracle in `backend/realtime/oracle-routes.ts`), where the app was
 * given no address of its own (`CreateAppOptions.backendUrl`, which a backend
 * process that serves this app beside its API sets to its own listener): at
 * TALE_BACKEND_URL. A process that serves the web tier alone (the `web`
 * role) gets the in-network name there from compose, or failing that from
 * the container's env.sh. The loopback default is what `bun dev` uses,
 * matching vite.config.ts and status-probe.ts.
 *
 * Read per call, never frozen at import: the module is loaded before the
 * process env is fully assembled in some entry paths.
 */
function backendBaseUrl(): string {
  const configured = (process.env.TALE_BACKEND_URL ?? '').replace(/\/+$/, '');
  return configured === '' ? 'http://127.0.0.1:3005' : configured;
}

/** Upper bound on one session-oracle round trip to the backend. */
const SESSION_ORACLE_TIMEOUT_MS = 5_000;

/**
 * Validate the request's session cookie against the backend's `/api/sse/auth`
 * door and answer the caller's org memberships — `null` means "no valid
 * session". Shared by the `/events/file` SSE gate and the `/canvas-preview`
 * gate; this app holds no database connection of its own, in whichever
 * process it runs, so the API is the oracle.
 */
async function resolveAllowedOrgSlugs(
  cookieHeader: string | undefined,
  backendUrl: string,
): Promise<Set<string> | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${backendUrl}/api/sse/auth`, {
      headers: { cookie: cookieHeader },
      // A hung backend must not leave every `/events/file` and
      // `/canvas-preview` request pending forever; the catch below turns
      // the timeout into a 401 like any other failed lookup.
      signal: AbortSignal.timeout(SESSION_ORACLE_TIMEOUT_MS),
    });
    if (res.status === 401) return null;
    if (!res.ok) {
      console.warn(`[session auth] backend auth lookup returned ${res.status}`);
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
    console.warn('[session auth] backend auth lookup failed', err);
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

interface EnvConfig extends AuthenticatorEnv {
  /**
   * The canonical public origin. Per REQUEST this is replaced by the origin
   * the browser is actually on when that is one of the configured site
   * origins, so the SPA builds its absolute URLs (SSO doors, OAuth starts,
   * TTS audio, the postMessage origin check) against its own domain — see
   * `renderIndexHtml`.
   */
  SITE_URL: string | undefined;
  /** Every origin this deployment answers on, canonical first. */
  SITE_ORIGINS: readonly string[];
  BASE_PATH: string;
  FILE_EVENTS_ENABLED: boolean;
  SENTRY_DSN: string | undefined;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_TRACES_SAMPLE_RATE: number;
  TALE_VERSION: string | undefined;
  SESSION_IDLE_TIMEOUT_MINUTES?: number;
  /**
   * Where the error displays' "contact support" link points; omitted (the
   * `https://tale.dev/contact` default) when unset or not an http(s) URL.
   */
  TALE_CONTACT_SUPPORT_URL?: string;
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: readonly string[];
}

// The built app and the precompiled SEO artifacts, beside the platform's
// other trees: `services/platform/dist` in a checkout, `/app/dist` in the
// image. From the platform's root and not from this module's own location,
// which is `backend-dist/` once the backend build has folded it in.
const distDir = fileURLToPath(new URL('dist', PLATFORM_ROOT));
const distSeoDir = fileURLToPath(new URL('dist-seo', PLATFORM_ROOT));

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
export function cacheControlForStaticPath(pathname: string): string {
  return retainedAssetName(pathname) !== undefined &&
    /\.(?:js|css)(?:\.map)?$/.test(pathname)
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

/** The request id an API-shaped refusal on this tier answers: the caller's
 * own when it is a sane token (the alphabet and length `hono/request-id`
 * accepts on the API tier), else a fresh one — the same rule as the API's. */
function apiRequestId(inbound: string | undefined): string {
  return inbound !== undefined && /^[A-Za-z0-9_-]{1,255}$/.test(inbound)
    ? inbound
    : randomUUID();
}

/**
 * Every configured site origin, canonical first. A malformed
 * `ADDITIONAL_SITE_URLS` is logged and ignored rather than thrown: the
 * backend already refuses to boot on it, and the web tier serving only the
 * canonical domain beats serving nothing.
 */
function safeSiteOrigins(): readonly string[] {
  try {
    return resolveSiteOrigins({
      SITE_URL: process.env.SITE_URL,
      ADDITIONAL_SITE_URLS: process.env.ADDITIONAL_SITE_URLS,
    });
  } catch (err) {
    console.warn(
      'Invalid ADDITIONAL_SITE_URLS, serving the canonical SITE_URL only:',
      err,
    );
    return resolveSiteOrigins({ SITE_URL: process.env.SITE_URL });
  }
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
  const content = await readTextFile(join(distDir, 'boot-shell.html'));
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
    // A malformed ADDITIONAL_SITE_URLS entry must not take the web tier
    // down — the backend validates it at boot and fails loudly there; here
    // a bad list degrades to the canonical origin alone.
    SITE_ORIGINS: safeSiteOrigins(),
    BASE_PATH: getBasePath(),
    FILE_EVENTS_ENABLED: fileEventsEnabled,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
    SENTRY_TRACES_SAMPLE_RATE: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
    ),
    TALE_VERSION: process.env.TALE_VERSION,
    // Idle-timeout window for the client watchdog (#1502). Validated/clamped
    // server-side; `undefined` (omitted from __ENV__) when the feature is off.
    SESSION_IDLE_TIMEOUT_MINUTES: parseSessionIdleTimeoutMinutes() ?? undefined,
    // The deployment's own support page for the error displays. Validated as
    // an absolute http(s) URL; `undefined` (omitted from __ENV__) otherwise.
    TALE_CONTACT_SUPPORT_URL: parseContactSupportUrl(),
    // The client and environment authenticator entries name, so a downloaded
    // set of backup codes carries the same words. Each is omitted when unset
    // or invalid.
    ...parseAuthenticatorEnv(),
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
// All OTHER backend traffic flows same-origin through Caddy (`/api/*`), so
// `'self'` covers it. Deployment-default storage uploads and downloads do
// too: their presigned URLs are signed for the site origin the browser is on
// (`browserFacing` in `backend/core/lib/storage/object_store.ts`) and reach
// the store through the proxy's `/<bucket>/*` lane on that same origin. The
// one exception is the org BYO object-storage lane above: the upload door
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

/** Whether an `If-None-Match` header names this `ETag` — `*`, or a
 * comma-separated list, the weak `W/` form matching too (the `/openapi.json`
 * validator, 2026-09-18 evaluation, J9-2). */
function etagMatches(header: string, etag: string): boolean {
  const normalize = (tag: string): string => tag.trim().replace(/^W\//, '');
  if (header.trim() === '*') return true;
  const target = normalize(etag);
  return header.split(',').some((tag) => normalize(tag) === target);
}

function buildContentSecurityPolicy(
  env: EnvConfig,
  orgStorageOrigins: readonly string[] = [],
  frameAncestors: readonly string[] = [],
) {
  const sentryOrigin = sentryOriginFromDsn(env.SENTRY_DSN);
  const sentry = sentryOrigin ? [sentryOrigin] : [];
  const figmaMcp = isLoopbackSite(env) ? ['https://mcp.figma.com'] : [];
  // The platform's OWN origins, so branding assets served as absolute
  // `<SITE_URL>/branding/...` URLs load even when the document is reached
  // from a different host than the one the URL was built on — which is the
  // normal case on a multi-domain deployment. Omitted (empty) when SITE_URL
  // is unset/relative: then assets are same-origin and `'self'` covers them.
  // Union, not either/or: the canonical origin is always allowed even if a
  // caller hands us a SITE_URL outside the configured list, and every
  // additional origin is allowed on top.
  const siteOrigin = siteOriginFromUrl(env.SITE_URL);
  const branding = [
    ...(siteOrigin ? [siteOrigin] : []),
    ...env.SITE_ORIGINS.filter((origin) => origin !== siteOrigin),
  ];
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
    // Nothing may frame Tale unless an organization's `embedding` policy
    // names the host page's origin (`lib/org-frame-ancestors.ts`); then the
    // shell admits `'self'` plus that union, and X-Frame-Options — which
    // cannot express an allowlist — is left off so the CSP alone rules.
    frameAncestors:
      frameAncestors.length > 0 ? ["'self'", ...frameAncestors] : ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    // TTS playback streams audio from same-origin `/api/app/tts/audio/…`
    // via `<audio>.src`, so `'self'` is required. Org BYO storage origins
    // are included because `/storage` 302s audio/video attachments to
    // presigned GETs on the org's endpoint. Local attachment metadata probes
    // and dictation previews read browser-created object URLs.
    mediaSrc: ["'self'", 'blob:', ...orgStorageOrigins],
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
  /** Built files and retained artifacts; injectable for release handover tests. */
  distDirectory?: string;
  retainedAssetsDirectory?: string;
  /**
   * Test seam for the org BYO object-storage origins fed into the CSP.
   * Production uses the TTL-cached `TALE_CONFIG_DIR` scan.
   */
  orgStorageOrigins?: () => readonly string[];
  /**
   * Test seam for the frame-ancestor origins fed into the CSP (the union of
   * every organization's enabled `embedding` policy). Production uses the
   * TTL-cached `TALE_CONFIG_DIR` scan.
   */
  orgFrameAncestors?: () => readonly string[];
  /**
   * Test seam for the OpenAPI document `/openapi.json` answers. Production
   * reads the built `dist/openapi.json` once.
   */
  openapiDocument?: () => Promise<Record<string, unknown> | null>;
  /**
   * Test seam for the SPA shell template the fallback route renders.
   * Production reads the built `dist/index.html` (once, outside dev hot
   * reload).
   */
  indexHtml?: string;
  /**
   * Test seam for the directory of the run markers (shutdown, ready,
   * withdrawn) the health and admission probes read. Production: `/tmp`.
   */
  markerDirectory?: string;
  /**
   * What `/metrics` answers. A process that serves this app alone answers
   * its own registry (`telemetry.ts`, the default). A backend process that
   * serves it beside its API has one registry for the whole process, the
   * backend's, and answers that here too: the process figures are the same
   * process's, and two sets of default metrics cannot register twice.
   */
  metrics?: () => Promise<Response>;
  /**
   * Where this app asks the API for what it cannot answer itself: the
   * session verdicts and the status page's probes. A backend process that
   * serves it beside its API names its own API listener here, so a replica
   * answers for itself and never for the one a shared network name happens
   * to resolve to. Unset — the `web` role, tests — TALE_BACKEND_URL.
   */
  backendUrl?: string;
  /**
   * Told each time something asks `/api/health` or `/api/admission`: the two
   * doors a balancer or a traffic switch checks a replica through. The
   * listener keeps the time of the last one ({@link startWebServer}).
   */
  onHealthCheck?: () => void;
}

let openapiDocumentPromise: Promise<Record<string, unknown> | null> | null =
  null;

/** The built OpenAPI document, parsed once per process (re-read in dev). */
function builtOpenapiDocument(): Promise<Record<string, unknown> | null> {
  if (openapiDocumentPromise !== null && !DEV_HOT_RELOAD) {
    return openapiDocumentPromise;
  }
  openapiDocumentPromise = (async () => {
    const text = await readTextFile(join(distDir, 'openapi.json'));
    if (text === null) return null;
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON object
        (parsed as Record<string, unknown>)
      : null;
  })();
  return openapiDocumentPromise;
}

export function createApp(
  env: EnvConfig = getEnvConfig(),
  opts: CreateAppOptions = {},
): Hono {
  const app = new Hono();
  const servingIdentity = createServingIdentity('platform');
  const analytics = createAnalytics(process.env, env.BASE_PATH);
  // Per request, like the variable behind it: see `backendBaseUrl`.
  const backendUrl = () => opts.backendUrl ?? backendBaseUrl();

  const makeSecure = (
    storageOrigins: readonly string[],
    frameAncestors: readonly string[],
  ) =>
    secureHeaders({
      contentSecurityPolicy: buildContentSecurityPolicy(
        env,
        storageOrigins,
        frameAncestors,
      ),
      // One year — the platform-wide value, repeated by every producer
      // (`backend/lib/http-hygiene.ts`, `@tale/ui` security headers, the
      // proxy's edge refusals). No `includeSubDomains`, no `preload` —
      // self-deployed operators run on varied domains (an apex with
      // plain-http siblings included) and don't own preload submission.
      strictTransportSecurity: isHttpsSite(env) ? 'max-age=31536000' : false,
      xContentTypeOptions: 'nosniff',
      // With frame ancestors configured the CSP directive is the rule;
      // X-Frame-Options knows only DENY/SAMEORIGIN and would contradict it.
      xFrameOptions: frameAncestors.length > 0 ? false : 'DENY',
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
        // `bluetooth` is an experimental directive most engines do not
        // register: Chrome on Linux and Firefox logged "Unrecognized
        // feature: 'bluetooth'" on every page load — the only console noise
        // an otherwise clean page produced (2026-09-14 evaluation, g9-5b).
        // No script here calls Web Bluetooth, and `script-src 'self'` holds.
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
  const orgFrameAncestors = opts.orgFrameAncestors ?? defaultOrgFrameAncestors;
  let secureOriginsKey: string | null = null;
  let secure = makeSecure([], []);
  const currentSecure = () => {
    const origins = orgStorageOrigins();
    const ancestors = orgFrameAncestors();
    const key = `${origins.join(' ')}|${ancestors.join(' ')}`;
    if (key !== secureOriginsKey) {
      secureOriginsKey = key;
      secure = makeSecure(origins, ancestors);
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
    strictTransportSecurity: isHttpsSite(env) ? 'max-age=31536000' : false,
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
  // Branding images are org-admin-uploaded bytes (SVG included) served on
  // the app origin. In the app they are embedded ONLY as `<img>` / `<link
  // rel="icon">`, where a response CSP is irrelevant — but a direct
  // NAVIGATION to the URL makes an SVG a same-origin document whose scripts
  // run with the app origin (stored XSS from any org's admin against every
  // user of every org on the deployment). A bare `sandbox` CSP directive (no
  // allow-* flags) turns any such navigation into an inert opaque-origin
  // document — no script, no same-origin reach — while pixel rendering in
  // image contexts is untouched. nosniff pins the allowlisted Content-Type.
  const secureForBrandingImages = secureHeaders({
    contentSecurityPolicy: { sandbox: [] },
    strictTransportSecurity: isHttpsSite(env) ? 'max-age=31536000' : false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });
  app.use('*', async (c, next) => {
    // Only the POST (preview render) escapes the strict headers — its
    // handler sets the bespoke sandboxed CSP itself. A GET here falls
    // through to the SPA shell and must keep the standard policy.
    if (c.req.path === '/canvas-preview' && c.req.method === 'POST')
      return next();
    if (c.req.path.startsWith('/branding/images/'))
      return secureForBrandingImages(c, next);
    if (c.req.path.startsWith('/dav/') || c.req.path === '/dav')
      return secureForDav(c, next);
    return currentSecure()(c, next);
  });

  app.post('/canvas-preview', async (c) => {
    // Session gate. This response deliberately escapes the SPA's strict CSP
    // (inline/eval script allowed), so it must never render for an anonymous
    // caller: an attacker could otherwise form-POST a victim's browser here
    // and have their HTML echoed on the app origin. The backend session
    // oracle (the same door `/events/file` uses) validates the cookie. The
    // in-app preview posts same-origin, so the session cookie always rides
    // along. Defense-in-depth on top of the gate, the response CSP carries a
    // `sandbox` directive (see buildCanvasPreviewCsp) so even an
    // authenticated victim navigated here top-level gets an opaque-origin
    // document with no reach into the app.
    const allowedOrgSlugs = await resolveAllowedOrgSlugs(
      c.req.header('cookie'),
      backendUrl(),
    );
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
    const body = await c.req.parseBody();
    const userHtml = typeof body.html === 'string' ? body.html : '';
    // The SPA frames this document; when a host page frames the SPA in turn
    // (the `embedding` policy) every ancestor is checked, so the admitted
    // origins ride here as well and X-Frame-Options — SAMEORIGIN would
    // contradict them — is left off, the same rule as the shell's headers.
    const frameAncestors = orgFrameAncestors();
    return new Response(wrapCanvasPreviewHtml(userHtml), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': buildCanvasPreviewCsp(
          env.CANVAS_PREVIEW_CSP_EXTRA_ORIGINS,
          frameAncestors,
        ),
        ...(frameAncestors.length > 0
          ? {}
          : { 'X-Frame-Options': 'SAMEORIGIN' }),
        // Per-request bespoke HTML — no caching.
        'Cache-Control': 'no-store',
        Vary: 'Cookie',
      },
    });
  });

  // HEAD on the web tier's own doors carries the length the GET would —
  // the docs promise it, and the adapter stamped `content-length: 0` on
  // all four (2026-09-13 round-e evaluation, E1-03). The REST door
  // measures its own answers behind `restDoorHeaders()`.
  // The three precompiled text artifacts and the SPA shell answered HEAD
  // with `content-length: 0` too — a mirror sizing `/llms-full.txt` read
  // it as empty (2026-09-19 evaluation, K9-3).
  for (const door of [
    '/api/health',
    '/status',
    '/status.json',
    '/openapi.json',
    '/llms.txt',
    '/llms-full.txt',
    '/robots.txt',
  ]) {
    app.use(door, headContentLength());
  }

  const markerDirectory = opts.markerDirectory ?? MARKER_DIRECTORY;
  const marked = (name: string) => existsSync(join(markerDirectory, name));

  app.get('/api/health', (c) => {
    opts.onHealthCheck?.();
    c.header('Cache-Control', 'no-store');
    c.header(SERVING_IDENTITY_HEADER, servingIdentity);
    if (marked(SHUTDOWN_MARKER)) {
      return c.json({ status: 'shutting_down' }, 503);
    }
    return c.json({
      status: 'ok',
      version: process.env.TALE_VERSION ?? 'dev',
    });
  });

  // ADMISSION: whether a traffic switch in front of the replicas (the Incus
  // runtime's) may send this replica new requests. 503 while it is withdrawn
  // or shutting down, and while it is not ready yet; it reads only the run
  // markers. Separate from /api/health, which the edge checks through that
  // switch: a withdrawn replica must leave the switch without the edge ever
  // seeing a 503 there, which would cut the whole site. The edge routes every
  // other /api/* path to the backend, so this is not reachable from outside.
  app.get('/api/admission', (c) => {
    opts.onHealthCheck?.();
    c.header('Cache-Control', 'no-store');
    c.header(SERVING_IDENTITY_HEADER, servingIdentity);
    if (marked(WITHDRAWN_MARKER) || marked(SHUTDOWN_MARKER)) {
      return c.json({ status: 'withdrawn' }, 503);
    }
    if (!marked(READY_MARKER)) {
      return c.json({ status: 'starting' }, 503);
    }
    return c.json({ status: 'ok' });
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
    const feed = buildStatusFeed(
      await probeServices(fetch, Date.now, backendUrl()),
    );
    const html = renderStatusPage(feed, c.req.header('accept-language') ?? '');
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=5',
      },
    });
  });

  // The JSON twin is the one a browser-based monitor polls, so it is the
  // one door of this tier that answers CORS: a public, key-less verdict
  // carries nothing an origin could misuse, and without the header every
  // dashboard had to proxy it. The HTML page gets no CORS — a person
  // opens it directly.
  const STATUS_JSON_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
  app.get('/status.json', async () => {
    const feed = buildStatusFeed(
      await probeServices(fetch, Date.now, backendUrl()),
    );
    return new Response(renderStatusJson(feed), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=5',
        ...STATUS_JSON_CORS,
      },
    });
  });
  // A preflight or a method probe on either status door answers 204 with
  // the verbs it takes — the SPA fallback used to answer 404 to OPTIONS,
  // which failed every cross-origin poll before it was made.
  app.on('OPTIONS', ['/status', '/status.json'], (c) => {
    const headers: Record<string, string> = { Allow: 'GET, HEAD, OPTIONS' };
    if (c.req.path === '/status.json') Object.assign(headers, STATUS_JSON_CORS);
    return new Response(null, { status: 204, headers });
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
    const allowedOrgSlugs = await resolveAllowedOrgSlugs(
      cookieHeader,
      backendUrl(),
    );
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
    // must not drop `undefined`, so cancel() guards.
    let client: SseClient | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(': ping\n\n');
          } catch (err) {
            console.warn('SSE heartbeat failed; dropping client', err);
            if (client) dropSseClient(client);
          }
        }, SSE_HEARTBEAT_MS);
        client = { controller, allowedOrgSlugs, heartbeat };
        sseClients.add(client);
        controller.enqueue('data: {"type":"connected"}\n\n');
      },
      cancel() {
        if (client) dropSseClient(client);
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

  app.get('/metrics', () => (opts.metrics ?? metricsResponse)());

  // Generated Prometheus recording + alerting rules for the response-time
  // SLAs, derived from the canonical targets in `sla-targets.ts`. Operators
  // load these instead of hand-copying thresholds; the rule expressions track
  // the same budgets exposed as `tale_sla_target_seconds` on `/metrics`.
  app.get('/metrics/sla-rules', () => slaRulesResponse());

  // Branding images. Defense-in-depth: filename is already locked
  // down (no `/`, no `..`), but the prefix check uses `path.sep` so a
  // future sibling dir like `imagesXYZ/` cannot prefix-match via
  // string compare. We also pin Content-Type from an allowlist
  // instead of inferring it from the extension so a mis-renamed file
  // cannot be served with a script-y content type.
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
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const contentType = BRANDING_MIME[ext];
    if (!contentType) return c.notFound();
    return (
      (await staticFileResponse(filePath, c.req.raw, {
        contentType,
        headers: { 'Cache-Control': 'no-cache, must-revalidate' },
      })) ?? c.notFound()
    );
  });

  // Dev live-reload build-id endpoint (polled by DEV_RELOAD_SCRIPT). Registered
  // before the SPA catch-all so it is not swallowed by it; dev-only.
  if (DEV_HOT_RELOAD) {
    app.get('/__dev/reload-id', (c) =>
      c.text(devBuildId(), 200, { 'Cache-Control': 'no-store' }),
    );
  }

  // The OpenAPI document with `servers` bound to the origin this request
  // arrived on: the static copy carries an `{origin}` template a reader
  // fills in by hand; a running instance answers its own, so a client
  // generated from a fetched document — and Swagger UI's "try it out" —
  // targets this deployment. Before the SPA catch-all, or the raw static
  // file would answer first.
  const loadOpenapi = opts.openapiDocument ?? builtOpenapiDocument;
  app.get('/openapi.json', async (c) => {
    const document = await loadOpenapi();
    if (document === null) {
      return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    }
    const origin =
      requestSiteOrigin(
        {
          url: c.req.url,
          host: c.req.header('host'),
          forwardedProto: c.req.header('x-forwarded-proto'),
        },
        env.SITE_ORIGINS,
      ) ??
      siteOriginFromUrl(env.SITE_URL) ??
      new URL(c.req.url).origin;
    const body = JSON.stringify({
      ...document,
      servers: [
        { url: `${origin}${env.BASE_PATH}`, description: 'This deployment' },
      ],
    });
    // The document is ~1 MB and the docs tell a client to re-fetch it to see
    // whether the instance moved; a validator lets that be a 304 instead of a
    // full download (2026-09-18 evaluation, J9-2). The tag is over the served
    // bytes, so it varies with the origin bound into `servers[]` above.
    const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
    const ifNoneMatch = c.req.header('if-none-match');
    if (ifNoneMatch !== undefined && etagMatches(ifNoneMatch, etag)) {
      return c.body(null, 304, {
        ETag: etag,
        'Cache-Control': 'public, max-age=300',
      });
    }
    return c.body(body, 200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
      ETag: etag,
    });
  });

  app.all(
    '/_a/*',
    async (c) => (await analytics.handle(c.req.raw)) ?? c.notFound(),
  );

  // Static files + index.html fallback (TanStack Router SPA). A HEAD on
  // the shell (`/docs`, any app route) carries the GET's length, like the
  // web tier's own doors above.
  app.use('*', headContentLength());
  app.get('*', async (c) => {
    const pathname = new URL(c.req.url).pathname;

    // An API-shaped path no route owns is a 404 in the API's own JSON
    // envelope, never the SPA shell: the proxy hands `/api/*` to the
    // backend, so what lands here is a lane the proxy did not route (or a
    // stack without the proxy) — and an HTML 200 read as "the API
    // answered", with no key asked. The bare `/api` and the `/.well-known/`
    // discovery paths a protocol client probes (an MCP client looking for
    // OAuth resource metadata) are the same kind of question: a machine
    // asked, and an HTML shell is not an answer it can read.
    // A doubled leading slash is the same question (`//api/v1/me`): the
    // edge merges slashes for its own matching but proxies the raw URI.
    const asked = pathname.replace(/^\/{2,}/, '/');
    if (
      asked === '/api' ||
      asked.startsWith('/api/') ||
      asked.startsWith('/.well-known/')
    ) {
      // The envelope is the API's, so it carries what every API refusal
      // carries: the request id a caller quotes (the API's own rule — an
      // inbound id in the documented alphabet is echoed, anything else is
      // replaced) and `no-store`; the mistyped base URL `$TALE_URL/api` is
      // the commonest newcomer error, and a support thread could not
      // correlate it (2026-09-19 evaluation, K9-4). No contract version:
      // this tier answers no version of the contract.
      return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404, {
        'cache-control': 'no-store',
        'x-request-id': apiRequestId(c.req.header('x-request-id')),
      });
    }

    if (pathname !== '/') {
      const staticDist = opts.distDirectory ?? distDir;
      const filePath = resolve(staticDist, pathname.slice(1));
      if (filePath.startsWith(staticDist + sep)) {
        if (pathname === '/offline.html') {
          const canonical = await readTextFile(filePath);
          if (canonical !== null) {
            const html =
              new URL(c.req.url).searchParams.get('__tale_offline') === '1'
                ? canonical
                : canonical.replace(
                    'src="/pwa-recovery.js"',
                    () => `src="${env.BASE_PATH}/pwa-recovery.js"`,
                  );
            return c.html(html, 200, {
              'Cache-Control': 'no-cache',
              'X-Tale-PWA-Offline': '1',
            });
          }
        } else {
          // The file decides its type, length and coding (a precompressed
          // neighbour when the request accepts one); this adds the caching
          // directive (immutable for content-hashed chunks).
          const response = await staticFileResponse(filePath, c.req.raw, {
            headers: { 'Cache-Control': cacheControlForStaticPath(pathname) },
            precompressed: true,
          });
          if (response !== null) return response;
        }
      }
    }

    const retained = retainedAssetName(pathname);
    if (retained) {
      const response = await staticFileResponse(
        join(opts.retainedAssetsDirectory ?? STATIC_ASSETS_DIR, retained),
        c.req.raw,
        {
          headers: { 'Cache-Control': cacheControlForStaticPath(pathname) },
          precompressed: true,
        },
      );
      if (response !== null) return response;
    }
    // A missing module is an asset miss, never an HTML 200 that a browser
    // might cache under an immutable bundle name.
    if (
      pathname.startsWith('/assets/') ||
      pathname === '/sw.js' ||
      pathname === '/pwa-recovery.js'
    ) {
      return c.text('Not found', 404, { 'Cache-Control': 'no-store' });
    }

    let template = opts.indexHtml ?? indexHtmlTemplate;
    if (template === null || (DEV_HOT_RELOAD && opts.indexHtml === undefined)) {
      template = await readTextFile(
        join(opts.distDirectory ?? distDir, 'index.html'),
      );
      if (template === null) {
        console.error(`Missing dist/index.html in ${distDir}`);
        return c.text('Internal Server Error', 500);
      }
      // Only memoize in production; in dev the next rebuild invalidates it.
      if (!DEV_HOT_RELOAD) {
        indexHtmlTemplate = template;
      }
    }

    const acceptLanguage = c.req.header('accept-language') ?? '';
    const basePath = env.BASE_PATH;
    // Per-request nonce produced by `secureHeaders` middleware. Injected
    // into every <script> tag so the strict CSP `script-src` (which uses
    // a nonce token instead of `'unsafe-inline'`) accepts the inline
    // __ENV__ injection and any other inline scripts in index.html.
    const nonce = c.get('secureHeadersNonce');

    // The SPA builds absolute URLs (the SSO doors, the OAuth starts, the TTS
    // audio src, the silent-SSO postMessage origin check) from SITE_URL, and
    // those must stay on the domain this document was served from — a
    // cross-domain jump would leave the session cookie behind. So the value
    // handed to THIS page is the browser's own origin whenever it is one of
    // the configured site origins; otherwise the canonical one, unchanged.
    const requestOrigin = requestSiteOrigin(
      {
        url: c.req.url,
        host: c.req.header('host'),
        forwardedProto: c.req.header('x-forwarded-proto'),
      },
      env.SITE_ORIGINS,
    );
    const pageEnv =
      requestOrigin === null || requestOrigin === env.SITE_URL
        ? env
        : { ...env, SITE_URL: requestOrigin };

    // Runtime values go in verbatim (`replaceLiteral`: no `$&`-style
    // expansion) and script-safe (`inlineScriptJson`: no `</script>`), since
    // neither the operator's env nor the request's Accept-Language is ours.
    let html = replaceLiteral(template, '<head>', `<head>${analytics.html}`);
    html = replaceLiteral(
      html,
      /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
      `window.__ENV__ = ${inlineScriptJson(pageEnv)};`,
    );
    html = replaceLiteral(
      html,
      /window\.__ACCEPT_LANGUAGE__\s*=\s*['"]__ACCEPT_LANGUAGE_PLACEHOLDER__['"];/,
      `window.__ACCEPT_LANGUAGE__ = ${inlineScriptJson(acceptLanguage)};`,
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

    html = replaceLiteral(
      html,
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

/** The port the web tier listens on unless `APP_PORT` names another. */
export const DEFAULT_WEB_PORT = 3000;

/** The port `APP_PORT` names, or the default when it is unset or blank. A
 * value that is no port fails the start: a web tier on a guessed port is a
 * site that answers nowhere. */
export function webPort(value: string | undefined = process.env.APP_PORT) {
  const text = value?.trim() ?? '';
  if (text === '') return DEFAULT_WEB_PORT;
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65_535) {
    throw new Error(`APP_PORT must be a port number, got: ${value}`);
  }
  return port;
}

/** How long a stopping web tier keeps answering once `/api/health` says
 * 503, unless `SHUTDOWN_DRAIN_SECONDS` names another span (0 to 300): a
 * balancer that checks each replica needs a check or two to stop sending it
 * requests, and the edge checks every five seconds. */
export const DEFAULT_WEB_DRAIN_MS = 6_000;

/** The span `SHUTDOWN_DRAIN_SECONDS` names, in milliseconds, or the default
 * when it is unset, blank or no such number. Never fails a stop over it. */
export function webDrainMs(
  value: string | undefined = process.env.SHUTDOWN_DRAIN_SECONDS,
): number {
  const text = value?.trim() ?? '';
  if (text === '') return DEFAULT_WEB_DRAIN_MS;
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) {
    console.warn(
      `[web] SHUTDOWN_DRAIN_SECONDS must be a number from 0 to 300, got: ${value} — using ${DEFAULT_WEB_DRAIN_MS / 1000}`,
    );
    return DEFAULT_WEB_DRAIN_MS;
  }
  return Math.round(seconds * 1000);
}

/**
 * How recent the last health check must be for a stopping web tier to wait
 * for its balancer: three of the edge's five-second checks. A replica
 * nothing has checked for that long has no balancer that would act on the
 * 503, so its wait would only delay the stop: the web tier a `backend-api`
 * replica serves but no edge routes to, a process on a workstation.
 */
export const HEALTH_CHECK_WINDOW_MS = 15_000;

export interface WebServerOptions {
  /** The port to listen on; `APP_PORT`, else 3000. */
  port?: number;
  /** The interface to listen on; every interface when omitted. */
  hostname?: string;
  /** Passed to {@link createApp}. */
  app?: CreateAppOptions;
}

export interface WebServer {
  server: ServerType;
  /** Write the ready marker: the compose healthcheck's gate, and what
   * `/api/admission` waits for. Called once everything the process serves is
   * up — by this function's caller, which knows what else that is. */
  markReady(): void;
  /** Write the shutdown marker, so `/api/health` answers 503 from now on and
   * a balancer that checks each replica stops sending it requests. */
  markShuttingDown(): void;
  /** How long to keep answering between {@link markShuttingDown} and
   * {@link close}: the span of {@link webDrainMs} while something checks
   * this replica's health ({@link HEALTH_CHECK_WINDOW_MS}), and none when
   * nothing does. */
  drainMs(): number;
  /** Stop serving: end the `/events/file` streams, which never end on their
   * own, close the listener once its requests have finished (or the force
   * deadline has passed), stop the upkeep of the shared assets and delete
   * the two markers. */
  close(): Promise<void>;
}

/**
 * Serve the web tier: the built app with its shell, the status page, the
 * OpenAPI document, branding images and the other doors of {@link createApp}.
 *
 * It runs in the backend process, beside the API, on a port of its own
 * (`backend/main.ts`; the api and all roles), or alone as the `web` role
 * (`backend/web-main.ts`). Either way on Node: there is no second JavaScript
 * server behind the site any more.
 */
export async function startWebServer(
  options: WebServerOptions = {},
): Promise<WebServer> {
  // Named volumes exist before the process starts. Publishing must finish
  // before /api/health can succeed on a newly joining blue/green replica.
  let stopMaintenance: (() => Promise<void>) | undefined;
  if (existsSync(STATIC_ASSETS_DIR)) {
    await publishStaticAssets(join(distDir, 'assets'));
    stopMaintenance = maintainStaticAssets(join(distDir, 'assets'));
  }
  const markerDirectory = options.app?.markerDirectory ?? MARKER_DIRECTORY;
  const marker = (name: string) => join(markerDirectory, name);
  // A marker of the previous run would answer for this one: `/tmp` outlives
  // a restart that keeps the container's filesystem. The entrypoint deletes
  // them as root; a start that never was root (a container run as the app
  // user, a workstation) deletes its own here, before the listener can read
  // one. A marker it may not delete is the entrypoint's to deal with, and
  // must not stop the start.
  for (const name of [READY_MARKER, SHUTDOWN_MARKER]) {
    try {
      rmSync(marker(name), { force: true });
    } catch (error) {
      console.warn(
        `[web] could not delete the run marker ${marker(name)} of a previous start:`,
        error,
      );
    }
  }
  let lastHealthCheckAt: number | null = null;
  const app = createApp(getEnvConfig(), {
    ...options.app,
    onHealthCheck: () => {
      lastHealthCheckAt = Date.now();
      options.app?.onHealthCheck?.();
    },
  });
  const port = options.port ?? webPort();
  const server = await new Promise<ServerType>((resolveServer, reject) => {
    const listening = serve(
      {
        fetch: app.fetch,
        port,
        ...(options.hostname === undefined
          ? {}
          : { hostname: options.hostname }),
        // The header budget, the arrival deadline and the response class
        // the API's listener runs with (lib/http-hygiene.ts): the edge
        // forwards to both, and a long-lived `/events/file` stream needs no
        // idle timeout raised, since Node sets none on a response in
        // progress.
        serverOptions: BACKEND_SERVER_OPTIONS,
      },
      () => resolveServer(listening),
    );
    listening.once('error', reject);
  });
  installClientErrorEnvelope(server);
  console.log(`[web] serving the app on :${port}`);
  return {
    server,
    markReady: () => {
      writeFileSync(marker(READY_MARKER), '');
      // The line the dev log reader shows as "platform running"
      // (`@tale/shared` classify/sources/platform-container.ts).
      console.log(
        `Tale Platform is running!\n   Application: ${process.env.SITE_URL ?? `http://localhost:${port}`}${getBasePath()}`,
      );
    },
    markShuttingDown: () => writeFileSync(marker(SHUTDOWN_MARKER), ''),
    drainMs: () =>
      lastHealthCheckAt !== null &&
      Date.now() - lastHealthCheckAt <= HEALTH_CHECK_WINDOW_MS
        ? webDrainMs()
        : 0,
    close: async () => {
      const ended = endFileEventStreams();
      if (ended > 0) {
        console.log(`[web] ended ${ended} open event stream(s) for shutdown`);
      }
      await closeHttpServer(server, { name: 'web' });
      await stopMaintenance?.();
      for (const name of [READY_MARKER, SHUTDOWN_MARKER])
        rmSync(marker(name), { force: true });
    },
  };
}
