import type { Sql } from 'postgres';
import * as client from 'prom-client';

import { registerSlaTargetMetrics } from '../sla-targets.ts';

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
 * scrape costs three cheap aggregate queries and nothing runs between
 * scrapes. Every query is bounded and read-only; a failing one leaves its
 * gauge unset for that scrape rather than failing the whole endpoint —
 * metrics must never be the reason a deploy probe goes red.
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

/**
 * The route LABEL for a request path — a bounded vocabulary, never the raw
 * path. Ids in a path would make the label set unbounded (one series per
 * thread/org/document), which is the classic way to melt a Prometheus.
 */
export function routeClass(path: string): string {
  if (path.startsWith('/api/app/')) {
    const segment = path.slice('/api/app/'.length).split('/')[0] ?? '';
    return segment === '' ? '/api/app' : `/api/app/${segment}`;
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
  if (path.startsWith('/api/automations/webhook')) {
    return '/api/automations/webhook';
  }
  if (path.startsWith('/dav')) return '/dav';
  if (path === '/events') return '/events';
  if (path === '/ping' || path === '/metrics') return path;
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

  // Returned so a test can drive the collectors against a throwaway
  // registry; the constructors already self-register on the default one.
  return [hintStreams, generations, jobs, drain];
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

export async function backendMetricsResponse(): Promise<Response> {
  try {
    return new Response(await client.register.metrics(), {
      headers: { 'Content-Type': client.register.contentType },
    });
  } catch (error) {
    console.error('[metrics] render failed:', error);
    return new Response('Metrics unavailable', { status: 500 });
  }
}
