import type { Sql } from 'postgres';
import * as client from 'prom-client';

import { registerSlaTargetMetrics } from '../sla-targets.ts';
import { probeStores } from './store-health.ts';

/**
 * Prometheus metrics for the 0.5 Postgres backend.
 *
 * The platform's `/metrics` covers a static-file server whose "real backend
 * was Convex" (telemetry.ts says so in as many words). Post-cutover the
 * interesting process IS this one, so it collects the same process-level
 * defaults plus what only the backend knows: how much work is queued and
 * in flight, how many hint streams are open, and how its HTTP surface is
 * behaving.
 *
 * The collectors are pull-time (`prom-client` `collect()` callbacks), so a
 * scrape costs a few cheap aggregate queries and nothing runs between
 * scrapes. Every query is bounded and read-only; a failing one leaves its
 * gauge unset for that scrape rather than failing the whole endpoint —
 * metrics must never be the reason a deploy probe goes red.
 *
 * `tale_backend_store_up` is the exception to "nothing runs between scrapes":
 * it reaches OUT of the process, to the databases and the blob store, so it
 * reads a cached probe rather than a fresh one (`store-health.ts`). It exists
 * because a deployment whose stores are external infrastructure has no other
 * signal that one of them stopped answering.
 *
 * The SLA target gauges are REUSED from the platform's `sla-targets.ts`
 * (one source of truth for the contractual budgets, as that module's own
 * doc-comment requires), so dashboards read the same numbers whichever
 * process they scrape.
 */

let initialized = false;
let openHintStreams = 0;

/** One hint stream opened — call on `/events` entry (paired with `closed`). */
export function hintStreamOpened(): void {
  openHintStreams += 1;
}

/** One hint stream closed — always paired, including on abort. */
export function hintStreamClosed(): void {
  openHintStreams = Math.max(0, openHintStreams - 1);
}

/** Test seam: the current open-stream count. */
export function openHintStreamCount(): number {
  return openHintStreams;
}

export const httpRequests = new client.Counter({
  name: 'tale_backend_http_requests_total',
  help: 'Backend HTTP responses by method, route class and status class.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [],
});

export const httpDuration = new client.Histogram({
  name: 'tale_backend_http_request_duration_seconds',
  help: 'Backend HTTP request duration by route class.',
  labelNames: ['method', 'route'] as const,
  // Web-request shape: sub-100ms reads through multi-second turn doors.
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [],
});

/** Mounted app domains only. Unknown paths share one series; an arbitrary
 * first path segment is just as unbounded as a document id further down. */
const APP_ROUTE_DOMAINS: ReadonlySet<string> = new Set([
  'agent-secrets',
  'api-keys',
  'approvals',
  'audit-logs',
  'automations',
  'branding',
  'changelog',
  'chat',
  'cloud-import',
  'collab',
  'connector-credentials',
  'connector-oauth-apps',
  'contacts',
  'conversations',
  'deployment',
  'documents',
  'erasure',
  'feedback',
  'files',
  'folders',
  'google-drive',
  'governance',
  'identity',
  'knowledge',
  'knowledge-entries',
  'legal-holds',
  'members',
  'notifications',
  'object-storage',
  'onedrive',
  'organizations',
  'products',
  'projects',
  'provider-credentials',
  'providers',
  'retention',
  'sandbox',
  'sandbox-devices',
  'scim',
  'skills',
  'sso',
  'tasks',
  'teams',
  'trusted-headers',
  'tts',
  'two-factor',
  'user-preferences',
  'users',
  'video-links',
  'webdav',
  'websites',
]);

const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
  // WebDAV's finite extension vocabulary.
  'PROPFIND',
  'PROPPATCH',
  'MKCOL',
  'COPY',
  'MOVE',
  'LOCK',
  'UNLOCK',
]);

/** HTTP extension methods are caller-controlled too. */
export function methodClass(method: string): string {
  return HTTP_METHODS.has(method) ? method : 'OTHER';
}

/**
 * The route LABEL for a request path — a bounded vocabulary, never the raw
 * path. Ids in a path would make the label set unbounded (one series per
 * thread/org/document), which is the classic way to melt a Prometheus.
 */
export function routeClass(path: string): string {
  if (path.startsWith('/api/app/')) {
    const end = path.indexOf('/', '/api/app/'.length);
    const segment = path.slice(
      '/api/app/'.length,
      end === -1 ? undefined : end,
    );
    return APP_ROUTE_DOMAINS.has(segment) ? `/api/app/${segment}` : '/api/app';
  }
  if (path.startsWith('/api/auth/')) return '/api/auth';
  if (path.startsWith('/api/tools')) return '/api/tools';
  if (path.startsWith('/api/v1')) return '/api/v1';
  if (path.startsWith('/api/control')) return '/api/control';
  if (path.startsWith('/api/sso') || path.startsWith('/http_api/api/sso')) {
    return '/api/sso';
  }
  if (path.startsWith('/scim/v2') || path.startsWith('/http_api/scim/v2')) {
    return '/scim/v2';
  }
  if (
    path.startsWith('/api/automations/webhook') ||
    /^\/api\/projects\/[^/]+\/automations\/webhook(?:\/|$)/.test(path)
  ) {
    return '/api/automations/webhook';
  }
  if (path.startsWith('/dav')) return '/dav';
  if (path === '/events') return '/events';
  if (path === '/api/image-proxy') return '/api/image-proxy';
  if (
    path === '/ping' ||
    path === '/ready' ||
    path === '/metrics' ||
    path === '/health/stores'
  ) {
    return path;
  }
  return 'other';
}

/**
 * Register the pull-time gauges. Split out so tests can drive the collectors
 * against a throwaway registry without booting a server.
 */
export function registerBackendCollectors(sql: Sql): client.Gauge[] {
  const hintStreams = new client.Gauge({
    name: 'tale_backend_hint_streams_open',
    help: 'Currently open /events (invalidation hint) streams on this pod.',
    collect() {
      this.set(openHintStreams);
    },
  });

  const generations = new client.Gauge({
    name: 'tale_backend_generations_inflight',
    help: 'Chat generations with a live heartbeat (in-flight turns).',
    async collect() {
      try {
        const rows = await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM app.generations
          WHERE heartbeat_at_ms > ${Date.now() - 10 * 60_000}
        `;
        this.set(Number(rows[0]?.count ?? '0'));
      } catch (error) {
        console.warn('[metrics] generations gauge failed:', error);
      }
    },
  });

  const jobs = new client.Gauge({
    name: 'tale_backend_jobs',
    help: 'pg-boss jobs by state (queue depth and failure backlog).',
    labelNames: ['state'] as const,
    async collect() {
      try {
        const rows = await sql<{ state: string; count: string }[]>`
          SELECT state::text AS state, count(*)::text AS count
          FROM pgboss.job GROUP BY state
        `;
        // The row set is the whole truth: a state with no rows has no GROUP
        // BY row, and a labelled child once set is retained by prom-client —
        // without the reset a drained 'active'/'failed' series would keep
        // exporting its last non-zero count (and keep depth alerts firing).
        // Reset only AFTER a successful read so a failed scrape keeps the
        // previous values rather than reporting an empty queue.
        this.reset();
        for (const row of rows) {
          this.set({ state: row.state }, Number(row.count));
        }
      } catch (error) {
        console.warn('[metrics] job-state gauge failed:', error);
      }
    },
  });

  const drain = new client.Gauge({
    name: 'tale_backend_drain_active',
    help: 'Whether this deployment is refusing new chat turns (deploy drain).',
    async collect() {
      try {
        const rows = await sql<{ draining: boolean }[]>`
          SELECT (draining AND drain_expires_at_ms > ${Date.now()}) AS draining
          FROM app.backend_control WHERE key = 'singleton' LIMIT 1
        `;
        this.set((rows[0]?.draining ?? false) ? 1 : 0);
      } catch (error) {
        console.warn('[metrics] drain gauge failed:', error);
      }
    },
  });

  const triggerScan = new client.Gauge({
    name: 'tale_backend_automation_trigger_scan_last_success_timestamp_seconds',
    help: 'Database completion time of the last executed automation schedule scan; zero when missing or unreadable. Does not prove individual trigger or agent success.',
    async collect() {
      // Failure must invalidate an earlier healthy sample. Process uptime,
      // queued jobs and drain handovers are not successful scan executions.
      this.set(0);
      try {
        this.set(
          await readSuccessfulScanCompletion(sql, 'automation.trigger_scan'),
        );
      } catch (error) {
        console.warn('[metrics] trigger-scan gauge failed:', error);
      }
    },
  });

  const stores = new client.Gauge({
    name: 'tale_backend_store_up',
    help: 'Whether each of the deployment’s three stores is reachable.',
    labelNames: ['store'] as const,
    async collect() {
      try {
        // Cached behind its own TTL, so a tight scrape interval does not turn
        // into a round-trip to every store (see store-health.ts).
        for (const status of await probeStores(sql)) {
          this.set({ store: status.name }, status.up ? 1 : 0);
        }
      } catch (error) {
        console.warn('[metrics] store-health gauge failed:', error);
      }
    },
  });

  // Returned so a test can drive the collectors against a throwaway
  // registry; the constructors already self-register on the default one.
  return [hintStreams, generations, jobs, drain, triggerScan, stores];
}

/** Native completion read shared with the isolated real-Postgres proof. The
 * collector names exactly one queue, so no user/organization labels or IDs
 * enter metrics. The existing (name,id) index scopes this to that queue's
 * retained jobs (normally seven days, about 10,080 minutely scans). */
export async function readSuccessfulScanCompletion(
  sql: Sql,
  queue: string,
): Promise<number> {
  const rows = await sql<{ completed: number | null }[]>`
    SELECT extract(epoch FROM max(completed_on))::float8 AS completed
    FROM pgboss.job
    WHERE name = ${queue} AND state = 'completed'
      AND output -> 'triggerScanCompleted' = 'true'::jsonb
      AND completed_on > now() - interval '10 minutes'
  `;
  const completed = rows[0]?.completed;
  return typeof completed === 'number' &&
    Number.isFinite(completed) &&
    completed > 0
    ? completed
    : 0;
}

export function initBackendTelemetry(sql: Sql): void {
  if (initialized) return;
  client.collectDefaultMetrics();
  client.register.registerMetric(httpRequests);
  client.register.registerMetric(httpDuration);
  registerSlaTargetMetrics();
  registerBackendCollectors(sql);
  initialized = true;
}

// Concurrent scrapes share the aggregate reads and rendering, but not the
// Response body (each reader must be able to consume its own stream).
let metricsInFlight: Promise<string> | undefined;

export async function backendMetricsResponse(): Promise<Response> {
  try {
    metricsInFlight ??= client.register.metrics().finally(() => {
      metricsInFlight = undefined;
    });
    return new Response(await metricsInFlight, {
      headers: { 'Content-Type': client.register.contentType },
    });
  } catch (error) {
    console.error('[metrics] render failed:', error);
    return new Response('Metrics unavailable', { status: 500 });
  }
}
