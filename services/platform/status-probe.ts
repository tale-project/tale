/**
 * Probes for the public `/status` page.
 *
 * Hits the per-service health endpoints on the Docker network and aggregates
 * to a single overall up/down state. A single-flight in-memory cache bounds
 * upstream probe load: an unauthenticated `/status` route cannot afford to
 * pay for fan-out probes on every request.
 *
 * Only HTTP status is inspected — response bodies are discarded — so a
 * misbehaving (or compromised) upstream cannot push arbitrary bytes into
 * the public response or this process's memory.
 */

import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

const CACHE_TTL_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;
// Node-action probes spawn a node executor on a cold path — give them more
// headroom than a plain HTTP liveness fetch before calling the lane down.
const NODE_PROBE_TIMEOUT_MS = 8000;

// Default to loopback so `bun run dev` works without env overrides; docker
// compose sets CONVEX_URL to the in-network DNS name (convex), which takes
// precedence. Knowledge-base (RAG) and web/document (crawler) work now runs
// IN-PROCESS inside the Convex backend — there are no separate rag/crawler
// HTTP services to probe, so Convex liveness is the single backend signal
// for V8 execution; the node-action lane gets its own probe below.
const CONVEX_URL = process.env.CONVEX_URL || 'http://127.0.0.1:3210';

// The 0.5 Postgres backend, once a deployment has cut over. Absent on a
// stack that hasn't: the component then simply does not appear in the feed,
// so an un-migrated deployment never reads as "degraded" for a service it
// does not run. `/ping` is the backend's own liveness route (the same one
// its container healthcheck uses).
// Read lazily, never frozen at import: the module is imported before the
// process env is fully assembled in some entry paths, and a test must be
// able to stub it.
function backendUrl(): string {
  return (process.env.TALE_BACKEND_URL ?? '').replace(/\/+$/, '');
}

export type OverallStatus = 'operational' | 'degraded' | 'outage';
// Two facets of the one backend: `convex` is V8/HTTP liveness (the
// `/version` fetch), `convexNodeActions` is the `'use node'` executor lane —
// which can wedge on its own. Observed on demo v0.3.8 (2026-07-18): every
// node action failed with "fetch failed" for hours after an upgrade restart
// while `/version` stayed green and this page said "operational".
export type ComponentId = 'convex' | 'convexNodeActions' | 'backend';

// Binary today because each probe is just `fetch.ok`. The wider
// `OverallStatus` vocabulary leaves room for a future `'degraded'`
// per-component value (e.g. latency-based) without breaking consumers.
export type ComponentStatus = 'operational' | 'outage';

export interface ComponentResult {
  id: ComponentId;
  up: boolean;
}

export interface StatusResult {
  overall: OverallStatus;
  components: ComponentResult[];
  checkedAt: string;
}

export interface StatusFeedComponent {
  id: ComponentId;
  status: ComponentStatus;
}

export interface StatusFeed {
  status: OverallStatus;
  checkedAt: string;
  components: StatusFeedComponent[];
}

interface Probe {
  id: ComponentId;
  run: (doFetch: typeof fetch) => Promise<boolean>;
}

let cache: { at: number; result: StatusResult } | null = null;
let inflight: Promise<StatusResult> | null = null;

// ---------------------------------------------------------------------------
// Node-action lane probe
//
// Rides the same admin-key ConvexHttpClient channel WebDAV uses
// (`lib/webdav/ctx.ts`), so no new public HTTP surface is exposed — the
// convex `/ping` route is internet-reachable through Caddy, and an
// unauthenticated endpoint that spawns a node process per hit would be an
// abuse lever. Skipped entirely (component absent) when ADMIN_KEY is unset,
// e.g. plain `bun run dev` without the entrypoint-provisioned key.
// ---------------------------------------------------------------------------

type NodeLaneProbe = () => Promise<boolean>;

let nodeLaneProbeOverride: NodeLaneProbe | null = null;
let adminClient: ConvexHttpClient | null = null;

function getAdminClient(adminKey: string): ConvexHttpClient {
  if (!adminClient) {
    const client = new ConvexHttpClient(CONVEX_URL);
    // setAdminAuth is @internal in convex types but present at runtime —
    // the established pattern (lib/webdav/ctx.ts, reset-owner.ts).
    // oxlint-disable-next-line no-unsafe-type-assertion
    const setAdminAuth = Reflect.get(client, 'setAdminAuth') as (
      token: string,
    ) => void;
    setAdminAuth.call(client, adminKey);
    adminClient = client;
  }
  return adminClient;
}

async function probeNodeLane(adminKey: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      getAdminClient(adminKey).action(anyApi.status.node_ping.ping, {}),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('node-lane probe timed out')),
          NODE_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return result === 'ok';
  } catch (err) {
    // Cadence is bounded by the probe cache, so this cannot spam. No
    // upstream string reaches the public response — only this log.
    console.warn(
      '[status-probe] node-action lane probe failed:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Test-only: replace (or clear) the node-lane probe implementation. */
export function _setNodeLaneProbeForTests(probe: NodeLaneProbe | null): void {
  nodeLaneProbeOverride = probe;
}

async function probeUrl(url: string, doFetch: typeof fetch): Promise<boolean> {
  return probeOne(url, doFetch);
}

// Convex has no `/health`; `/version` is the established liveness probe
// (already used by services/platform/docker-entrypoint.sh and the Convex
// container's own healthcheck). Body is plain text — do NOT call .json().
// Assembled per round (not module-level) so the node-lane component appears
// exactly when a probe implementation is available.
function buildProbes(): Probe[] {
  const probes: Probe[] = [
    { id: 'convex', run: (f) => probeUrl(`${CONVEX_URL}/version`, f) },
  ];
  const backend = backendUrl();
  if (backend !== '') {
    probes.push({ id: 'backend', run: (f) => probeUrl(`${backend}/ping`, f) });
  }
  const adminKey = process.env.ADMIN_KEY;
  if (nodeLaneProbeOverride) {
    const override = nodeLaneProbeOverride;
    probes.push({ id: 'convexNodeActions', run: () => override() });
  } else if (adminKey) {
    probes.push({
      id: 'convexNodeActions',
      run: () => probeNodeLane(adminKey),
    });
  }
  return probes;
}

async function probeOne(url: string, doFetch: typeof fetch): Promise<boolean> {
  try {
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: 'error',
    });
    // Drop the body unread — we only care about reachability + 2xx, and
    // an upstream returning a huge or hostile body must not affect us.
    res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    // Timeout, connection refused, DNS failure, redirect, or any other
    // transport error all count as "down". No upstream string is ever
    // surfaced to the public response.
    return false;
  }
}

async function runProbes(doFetch: typeof fetch): Promise<StatusResult> {
  const probes = buildProbes();
  const ups = await Promise.all(probes.map((p) => p.run(doFetch)));
  const components: ComponentResult[] = probes.map((p, i) => ({
    id: p.id,
    up: ups[i] ?? false,
  }));

  const allUp = components.every((c) => c.up);
  const allDown = components.every((c) => !c.up);

  // Platform liveness is implicit — if this code is running, /status is
  // responding, so the platform is at least reachable. "outage" therefore
  // means every backend probe failed, which is what users effectively see.
  let overall: OverallStatus;
  if (allUp) overall = 'operational';
  else if (allDown) overall = 'outage';
  else overall = 'degraded';

  return {
    overall,
    components,
    checkedAt: new Date().toISOString(),
  };
}

export async function probeServices(
  doFetch: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<StatusResult> {
  const t = now();
  if (cache && t - cache.at < CACHE_TTL_MS) {
    return cache.result;
  }
  if (inflight) return inflight;

  const pending = runProbes(doFetch)
    .then((result) => {
      cache = { at: now(), result };
      return result;
    })
    .finally(() => {
      if (inflight === pending) inflight = null;
    });
  inflight = pending;
  return pending;
}

/** Reset module state. Test-only. */
export function _resetStatusProbeCache(): void {
  cache = null;
  inflight = null;
  nodeLaneProbeOverride = null;
  adminClient = null;
}

// ---------------------------------------------------------------------------
// Canonical public-facing model
//
// `StatusFeed` is the single shape every consumer (HTML page, JSON feed,
// future RSS / webhook) reads. `buildStatusFeed` is the only place that
// interprets raw probe output (`up: boolean`) as a public status string,
// so the human view and the machine view cannot drift.
// ---------------------------------------------------------------------------

export function buildStatusFeed(result: StatusResult): StatusFeed {
  return {
    status: result.overall,
    checkedAt: result.checkedAt,
    components: result.components.map((c) => ({
      id: c.id,
      status: c.up ? 'operational' : 'outage',
    })),
  };
}

export function renderStatusJson(feed: StatusFeed): string {
  return JSON.stringify(feed);
}

// ---------------------------------------------------------------------------
// Public page rendering
//
// Server-rendered HTML for `/status` — no JavaScript, no React shell, no
// auto-refresh. The user reloads if they want a fresh state. The component
// label is a deliberate noun ("Application") rather than an action verb, so
// it covers every failure mode of the backend — knowledge-base and
// web/document work now run inside the application (Convex), so a single
// row reflects them all. This also keeps the public surface free of stack
// names (Convex / RAG / Crawler).
// Locale picked from Accept-Language prefix: de → German, fr → French,
// else English. Matches the locale bundles already shipped at
// services/platform/messages/{en,de,fr}.json.
// ---------------------------------------------------------------------------

const STRINGS = {
  en: {
    htmlLang: 'en',
    title: 'System status',
    operational: 'All systems operational',
    degraded: 'Partial degradation',
    outage: 'Service outage',
    checkedAt: 'Last checked',
    statusUp: 'Operational',
    statusDown: 'Unavailable',
    components: {
      convex: 'Application',
      convexNodeActions: 'Background processing',
      backend: 'Application services',
    },
  },
  de: {
    htmlLang: 'de',
    title: 'Systemstatus',
    operational: 'Alle Systeme verfügbar',
    degraded: 'Teilweise eingeschränkt',
    outage: 'Schwerwiegende Störung',
    checkedAt: 'Zuletzt geprüft',
    statusUp: 'Verfügbar',
    statusDown: 'Nicht verfügbar',
    components: {
      convex: 'Anwendung',
      convexNodeActions: 'Hintergrundverarbeitung',
      backend: 'Anwendungsdienste',
    },
  },
  fr: {
    htmlLang: 'fr',
    title: 'État du système',
    operational: 'Tous les systèmes opérationnels',
    degraded: 'Dégradation partielle',
    outage: 'Panne de service',
    checkedAt: 'Dernière vérification',
    statusUp: 'Opérationnel',
    statusDown: 'Indisponible',
    components: {
      convex: 'Application',
      convexNodeActions: 'Traitements en arrière-plan',
      backend: 'Services applicatifs',
    },
  },
} as const;

const COLORS: Record<OverallStatus, { bg: string; fg: string }> = {
  operational: { bg: '#dcfce7', fg: '#166534' },
  degraded: { bg: '#fef3c7', fg: '#92400e' },
  outage: { bg: '#fee2e2', fg: '#991b1b' },
};

const DOT = {
  up: '#16a34a',
  down: '#dc2626',
};

function pickLocale(acceptLanguage: string): 'en' | 'de' | 'fr' {
  // First listed language wins. "en-US,de;q=0.9" → "en-us".
  const first = (acceptLanguage.split(',')[0] ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (first?.startsWith('de')) return 'de';
  if (first?.startsWith('fr')) return 'fr';
  return 'en';
}

function formatChecked(iso: string): string {
  // HH:MM:SS UTC — short, locale-independent, no JS needed.
  return `${iso.slice(11, 19)} UTC`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderStatusPage(
  feed: StatusFeed,
  acceptLanguage: string,
): string {
  const t = STRINGS[pickLocale(acceptLanguage)];
  const banner = COLORS[feed.status];
  const headline = t[feed.status];

  const rows = feed.components
    .map((c) => {
      const up = c.status === 'operational';
      const label = escapeHtml(t.components[c.id]);
      const statusWord = escapeHtml(up ? t.statusUp : t.statusDown);
      const dotColor = up ? DOT.up : DOT.down;
      return `    <li>
      <span class="dot" style="background:${dotColor}" aria-hidden="true"></span>
      <span class="label">${label}</span>
      <span class="state state-${up ? 'up' : 'down'}">${statusWord}</span>
    </li>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(t.title)}</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    background: #f8fafc;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
  main { width: 100%; max-width: 32rem; }
  h1 {
    margin: 0;
    padding: 1.75rem 1.5rem;
    font-size: clamp(1.25rem, 2.5vw, 1.75rem);
    font-weight: 600;
    line-height: 1.3;
    text-align: center;
    border-radius: 0.75rem;
    background: ${banner.bg};
    color: ${banner.fg};
  }
  ul {
    list-style: none;
    margin: 1.5rem 0 0;
    padding: 0;
    border: 1px solid #e2e8f0;
    border-radius: 0.75rem;
    background: #ffffff;
    overflow: hidden;
  }
  li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.95rem;
  }
  li:last-child { border-bottom: 0; }
  .dot {
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
  }
  .label { color: #0f172a; font-weight: 500; }
  .state { font-size: 0.825rem; color: #475569; font-variant-numeric: tabular-nums; }
  .state-down { color: #b91c1c; font-weight: 600; }
  p.checked {
    margin: 1.25rem 0 0;
    font-size: 0.825rem;
    color: #64748b;
    text-align: center;
  }
  time { font-variant-numeric: tabular-nums; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e8f0; background: #0f172a; }
    ul { background: #1e293b; border-color: #334155; }
    li { border-bottom-color: #334155; }
    .label { color: #e2e8f0; }
    .state { color: #94a3b8; }
    .state-down { color: #fca5a5; }
    p.checked { color: #94a3b8; }
  }
</style>
</head>
<body>
<main>
  <h1 role="status">${escapeHtml(headline)}</h1>
  <ul>
${rows}
  </ul>
  <p class="checked">${escapeHtml(t.checkedAt)}: <time datetime="${feed.checkedAt}">${formatChecked(feed.checkedAt)}</time></p>
</main>
</body>
</html>
`;
}
