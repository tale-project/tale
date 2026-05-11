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

const CACHE_TTL_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;

// Default to loopback so `bun run dev` works without env overrides when the
// developer runs RAG / Crawler on the standard ports. Docker compose sets
// the env vars to the in-network DNS names (rag / crawler / convex), which
// take precedence. Matches the convention in vite.config.ts, dev.ts,
// convex/lib/helpers/rag_config.ts, convex/agent_tools/web/helpers/
// get_crawler_service_url.ts.
const CONVEX_URL = process.env.CONVEX_URL || 'http://127.0.0.1:3210';
const RAG_URL = process.env.RAG_URL || 'http://localhost:8001';
const CRAWLER_URL = process.env.CRAWLER_URL || 'http://localhost:8002';

export type OverallStatus = 'operational' | 'degraded' | 'outage';
export type ComponentId = 'convex' | 'rag' | 'crawler';

export interface ComponentResult {
  id: ComponentId;
  up: boolean;
}

export interface StatusResult {
  overall: OverallStatus;
  components: ComponentResult[];
  checkedAt: string;
}

interface Probe {
  id: ComponentId;
  url: string;
}

// Convex has no `/health`; `/version` is the established liveness probe
// (already used by services/platform/docker-entrypoint.sh and the Convex
// container's own healthcheck). Body is plain text — do NOT call .json().
const PROBES: readonly Probe[] = [
  { id: 'convex', url: `${CONVEX_URL}/version` },
  { id: 'rag', url: `${RAG_URL}/health` },
  { id: 'crawler', url: `${CRAWLER_URL}/health` },
];

let cache: { at: number; result: StatusResult } | null = null;
let inflight: Promise<StatusResult> | null = null;

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
  const ups = await Promise.all(PROBES.map((p) => probeOne(p.url, doFetch)));
  const components: ComponentResult[] = PROBES.map((p, i) => ({
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
}

// ---------------------------------------------------------------------------
// Public page rendering
//
// Server-rendered HTML for `/status` — no JavaScript, no React shell, no
// auto-refresh. The user reloads if they want a fresh state. Component
// labels are deliberately nouns ("Application" / "Knowledge base" / "Web
// & document services") rather than action verbs, so each label covers
// every failure mode of that subsystem (e.g. "Knowledge base" covers both
// indexing new docs and querying existing ones — neither aspect needs its
// own line). This also keeps the public surface free of stack names
// (Convex / RAG / Crawler).
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
      rag: 'Knowledge base',
      crawler: 'Web & document services',
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
      rag: 'Wissensdatenbank',
      crawler: 'Web- & Dokumentendienste',
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
      rag: 'Base de connaissances',
      crawler: 'Services web et documents',
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
  result: StatusResult,
  acceptLanguage: string,
): string {
  const t = STRINGS[pickLocale(acceptLanguage)];
  const banner = COLORS[result.overall];
  const headline = t[result.overall];

  const rows = result.components
    .map((c) => {
      const label = escapeHtml(t.components[c.id]);
      const statusWord = escapeHtml(c.up ? t.statusUp : t.statusDown);
      const dotColor = c.up ? DOT.up : DOT.down;
      return `    <li>
      <span class="dot" style="background:${dotColor}" aria-hidden="true"></span>
      <span class="label">${label}</span>
      <span class="state state-${c.up ? 'up' : 'down'}">${statusWord}</span>
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
  <p class="checked">${escapeHtml(t.checkedAt)}: <time datetime="${result.checkedAt}">${formatChecked(result.checkedAt)}</time></p>
</main>
</body>
</html>
`;
}
