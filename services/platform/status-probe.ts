/**
 * Probes for the public `/status` page.
 *
 * Hits the backend's health endpoints on the Docker network and aggregates
 * to a single overall up/down state. A single-flight in-memory cache bounds
 * upstream probe load: an unauthenticated `/status` route cannot afford to
 * pay for fan-out probes on every request.
 *
 * The liveness probe inspects the HTTP status alone — its body is
 * discarded. The stores probe reads a body, because the verdict it needs
 * (which store answers) IS the body: it is read under a small byte cap and
 * held to one exact shape — three booleans under fixed names — so a
 * misbehaving (or compromised) upstream can neither push arbitrary bytes
 * into the public response nor into this process's memory; anything but
 * that shape reads as "down".
 */

const CACHE_TTL_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;
/** The stores verdict is ~90 bytes; anything past this cap is not it. */
const STORES_BODY_MAX_BYTES = 1024;

// The backend tier serves every door the app depends on; `/ping` is its own
// liveness route (the same one its container healthcheck uses). Compose sets
// TALE_BACKEND_URL to the in-network DNS name; the loopback default is what
// `bun run dev` and `vite preview` use, matching vite.config.ts.
// Read lazily, never frozen at import: the module is imported before the
// process env is fully assembled in some entry paths, and a test must be
// able to stub it.
function backendUrl(): string {
  const configured = (process.env.TALE_BACKEND_URL ?? '').replace(/\/+$/, '');
  return configured === '' ? 'http://127.0.0.1:3005' : configured;
}

export type OverallStatus = 'operational' | 'degraded' | 'outage';
// Three components, in the order the page lists them: the backend tier
// that serves every request the app makes (its `/ping`), and the two kinds
// of store it depends on — `database` folds the app database and the
// deployment-default knowledge database into one row (a person reading the
// page does not care which schema is unreachable, and naming them apart
// would leak the stack), `object-store` is the deployment-default bucket.
// Both store rows come from the backend's own `/health/stores`, so a
// backend that is down takes every row down with it, which is what a user
// sees. The union is kept open so a further lane — e.g. a worker-liveness
// signal — can join without a shape change.
export type ComponentId = 'backend' | 'database' | 'object-store';
export const COMPONENT_IDS: readonly ComponentId[] = [
  'backend',
  'database',
  'object-store',
];

// Binary today because each probe answers up or down. The wider
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

let cache: { at: number; result: StatusResult } | null = null;
let inflight: Promise<StatusResult> | null = null;

/** The backend's `/ping`: reachability + 2xx, body dropped unread. */
async function probeLiveness(doFetch: typeof fetch): Promise<boolean> {
  try {
    const res = await doFetch(`${backendUrl()}/ping`, {
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

/** The stores verdict as the page reads it: the two rows it shows. */
interface StoresVerdict {
  database: boolean;
  'object-store': boolean;
}

const STORES_DOWN: StoresVerdict = { database: false, 'object-store': false };

/** The exact shape `/health/stores` answers; anything else is no verdict. */
function readStoresBody(text: string): StoresVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const stores: unknown = Reflect.get(parsed, 'stores');
  if (typeof stores !== 'object' || stores === null) return null;
  const flag = (name: string): boolean | null => {
    const value: unknown = Reflect.get(stores, name);
    return typeof value === 'boolean' ? value : null;
  };
  const appDb = flag('app_db');
  const knowledgeDb = flag('knowledge_db');
  const objectStore = flag('object_store');
  if (appDb === null || knowledgeDb === null || objectStore === null) {
    return null;
  }
  return { database: appDb && knowledgeDb, 'object-store': objectStore };
}

/**
 * The backend's `/health/stores`, read for its body: a 503 there still
 * carries the per-store booleans (that is the point of the route), so the
 * status is not the verdict — the shape is. A body over the cap, one that
 * is not JSON, or one missing a flag counts as every store down; so does
 * any transport failure, which is what a user sees when the backend that
 * would have answered is itself gone.
 */
async function probeStoresVerdict(
  doFetch: typeof fetch,
): Promise<StoresVerdict> {
  try {
    const res = await doFetch(`${backendUrl()}/health/stores`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: 'error',
    });
    if (res.status !== 200 && res.status !== 503) {
      res.body?.cancel().catch(() => {});
      return STORES_DOWN;
    }
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > STORES_BODY_MAX_BYTES) {
      res.body?.cancel().catch(() => {});
      return STORES_DOWN;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > STORES_BODY_MAX_BYTES) return STORES_DOWN;
    return readStoresBody(new TextDecoder().decode(bytes)) ?? STORES_DOWN;
  } catch {
    // As for the liveness probe: any failure to get a verdict is "down",
    // and nothing the upstream sent reaches the public response.
    return STORES_DOWN;
  }
}

async function runProbes(doFetch: typeof fetch): Promise<StatusResult> {
  const [backendUp, stores] = await Promise.all([
    probeLiveness(doFetch),
    probeStoresVerdict(doFetch),
  ]);
  const components: ComponentResult[] = [
    { id: 'backend', up: backendUp },
    { id: 'database', up: stores.database },
    { id: 'object-store', up: stores['object-store'] },
  ];

  const allUp = components.every((c) => c.up);
  const allDown = components.every((c) => !c.up);

  // Platform liveness is implicit — if this code is running, /status is
  // responding, so the platform is at least reachable. "outage" therefore
  // means every probe failed — a backend that is down takes its stores'
  // rows with it — which is what users effectively see; one store down
  // behind a live backend is the partial degradation the page names.
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
// labels are deliberate nouns ("Application services", "Database", "File
// storage") rather than action verbs or product names, so each covers
// every failure mode of its tier — knowledge-base and web/document work run
// inside the application tier — and the public surface stays free of stack
// names (no Postgres, no S3, no bucket vendor).
// Locale picked from Accept-Language prefix: de → German, fr → French,
// else English. Matches the locale bundles already shipped at
// services/platform/messages/{en,de,fr}.json.
// ---------------------------------------------------------------------------

type ComponentLabels = Record<ComponentId, string>;

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
      backend: 'Application services',
      database: 'Database',
      'object-store': 'File storage',
    } satisfies ComponentLabels,
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
      backend: 'Anwendungsdienste',
      database: 'Datenbank',
      'object-store': 'Dateispeicher',
    } satisfies ComponentLabels,
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
      backend: 'Services applicatifs',
      database: 'Base de données',
      'object-store': 'Stockage de fichiers',
    } satisfies ComponentLabels,
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
