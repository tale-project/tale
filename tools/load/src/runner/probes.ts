/**
 * What the run saw from the server's side: Prometheus metrics endpoints and
 * the database's own statement statistics, read before and after the run.
 *
 * Client-side numbers say how slow it felt; these say why — which route the
 * backend itself timed as slow, how many streams it held, and which SQL
 * statements the run spent the database's time on. Both are optional: a
 * remote deployment's database is rarely reachable from a generator, and
 * its metrics may sit behind a bearer token.
 */

import postgres from 'postgres';

/** One Prometheus sample: `name{labels} value`. */
export interface PromSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** Parse the Prometheus text exposition format (comments skipped). */
export function parsePrometheus(text: string): PromSample[] {
  const samples: PromSample[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{(.*)\})?\s+(\S+)/.exec(line);
    if (match === null) continue;
    const labels: Record<string, string> = {};
    const labelText = match[3];
    if (labelText !== undefined && labelText !== '') {
      for (const pair of labelText.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
        const key = pair[1];
        const value = pair[2];
        if (key !== undefined && value !== undefined) labels[key] = value;
      }
    }
    const value = Number(match[4]);
    if (!Number.isFinite(value)) continue;
    samples.push({ name: match[1] ?? '', labels, value });
  }
  return samples;
}

export interface MetricsEndpoint {
  url: string;
  bearer?: string;
}

export interface MetricsScrape {
  url: string;
  at: number;
  ok: boolean;
  error?: string;
  samples: PromSample[];
}

export async function scrapeMetrics(
  endpoint: MetricsEndpoint,
): Promise<MetricsScrape> {
  const at = Date.now();
  try {
    const response = await fetch(endpoint.url, {
      headers:
        endpoint.bearer === undefined
          ? {}
          : { authorization: `Bearer ${endpoint.bearer}` },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        url: endpoint.url,
        at,
        ok: false,
        error: `HTTP ${response.status}`,
        samples: [],
      };
    }
    return { url: endpoint.url, at, ok: true, samples: parsePrometheus(text) };
  } catch (error) {
    return {
      url: endpoint.url,
      at,
      ok: false,
      error: String(error),
      samples: [],
    };
  }
}

/** The backend series worth reporting, summed over label sets. */
export interface ServerMetricsDelta {
  url: string;
  ok: boolean;
  error?: string;
  /** Requests the backend counted during the run, by route and status. */
  requests: { route: string; status: string; count: number }[];
  /** Backend-side mean request duration per route over the run, seconds. */
  meanSeconds: { route: string; seconds: number }[];
  /** Gauges as they stood at the end. */
  gauges: Record<string, number>;
  /** CPU seconds the process spent during the run. */
  cpuSeconds: number | null;
  /** Resident memory at the end, bytes. */
  residentBytes: number | null;
}

function sum(
  samples: readonly PromSample[],
  name: string,
  keyOf: (labels: Record<string, string>) => string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const sample of samples) {
    if (sample.name !== name) continue;
    const key = keyOf(sample.labels);
    out.set(key, (out.get(key) ?? 0) + sample.value);
  }
  return out;
}

function single(samples: readonly PromSample[], name: string): number | null {
  const found = samples.find((sample) => sample.name === name);
  return found === undefined ? null : found.value;
}

/** What changed on one endpoint between two scrapes. */
export function diffServerMetrics(
  before: MetricsScrape,
  after: MetricsScrape,
): ServerMetricsDelta {
  if (!before.ok || !after.ok) {
    return {
      url: after.url,
      ok: false,
      error: after.error ?? before.error ?? 'scrape failed',
      requests: [],
      meanSeconds: [],
      gauges: {},
      cpuSeconds: null,
      residentBytes: null,
    };
  }
  const reqKey = (labels: Record<string, string>) =>
    `${labels.method ?? ''} ${labels.route ?? ''}\u0000${labels.status ?? ''}`;
  const reqBefore = sum(
    before.samples,
    'tale_backend_http_requests_total',
    reqKey,
  );
  const reqAfter = sum(
    after.samples,
    'tale_backend_http_requests_total',
    reqKey,
  );
  const requests: ServerMetricsDelta['requests'] = [];
  for (const [key, value] of reqAfter) {
    const count = value - (reqBefore.get(key) ?? 0);
    if (count <= 0) continue;
    const [route = '', status = ''] = key.split('\u0000');
    requests.push({ route, status, count });
  }
  requests.sort((a, b) => b.count - a.count);

  const routeKey = (labels: Record<string, string>) =>
    `${labels.method ?? ''} ${labels.route ?? ''}`;
  const sumBefore = sum(
    before.samples,
    'tale_backend_http_request_duration_seconds_sum',
    routeKey,
  );
  const sumAfter = sum(
    after.samples,
    'tale_backend_http_request_duration_seconds_sum',
    routeKey,
  );
  const countBefore = sum(
    before.samples,
    'tale_backend_http_request_duration_seconds_count',
    routeKey,
  );
  const countAfter = sum(
    after.samples,
    'tale_backend_http_request_duration_seconds_count',
    routeKey,
  );
  const meanSeconds: ServerMetricsDelta['meanSeconds'] = [];
  for (const [route, total] of sumAfter) {
    const calls = (countAfter.get(route) ?? 0) - (countBefore.get(route) ?? 0);
    if (calls <= 0) continue;
    meanSeconds.push({
      route,
      seconds: (total - (sumBefore.get(route) ?? 0)) / calls,
    });
  }
  meanSeconds.sort((a, b) => b.seconds - a.seconds);

  const gauges: Record<string, number> = {};
  for (const name of [
    'tale_backend_hint_streams_open',
    'tale_backend_generations_inflight',
    'nodejs_eventloop_lag_p99_seconds',
    'nodejs_active_handles_total',
  ]) {
    const value = single(after.samples, name);
    if (value !== null) gauges[name] = value;
  }
  const cpuAfter = single(after.samples, 'process_cpu_seconds_total');
  const cpuBefore = single(before.samples, 'process_cpu_seconds_total');
  return {
    url: after.url,
    ok: true,
    requests: requests.slice(0, 50),
    meanSeconds: meanSeconds.slice(0, 50),
    gauges,
    cpuSeconds:
      cpuAfter === null || cpuBefore === null ? null : cpuAfter - cpuBefore,
    residentBytes: single(after.samples, 'process_resident_memory_bytes'),
  };
}

/** A statement's totals from `pg_stat_statements`. */
export interface StatementStats {
  queryId: string;
  query: string;
  calls: number;
  totalMs: number;
  rows: number;
  sharedBlocksRead: number;
}

export interface DatabaseSnapshot {
  at: number;
  ok: boolean;
  error?: string;
  statements: StatementStats[];
  /** `pg_stat_database` totals for the app database. */
  database: {
    commits: number;
    rollbacks: number;
    tuplesReturned: number;
    tuplesFetched: number;
    tuplesInserted: number;
    tuplesUpdated: number;
    tuplesDeleted: number;
    deadlocks: number;
  } | null;
  /** Connections by state at the moment of the snapshot. */
  connections: Record<string, number>;
}

/**
 * Read the cluster's statement statistics. `pg_stat_statements` lives in
 * whichever database created the extension (the Tale image creates it in
 * `tale`), and is cluster-wide: pass that database's URL plus the name of
 * the app database to keep only its statements.
 */
export async function snapshotDatabase(
  url: string,
  appDatabase: string,
): Promise<DatabaseSnapshot> {
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  const at = Date.now();
  try {
    const statements = await sql<
      {
        queryId: string;
        query: string;
        calls: string;
        totalMs: number;
        rows: string;
        blocksRead: string;
      }[]
    >`
      SELECT s.queryid::text AS "queryId", s.query,
             s.calls::text AS calls, s.total_exec_time AS "totalMs",
             s.rows::text AS rows, s.shared_blks_read::text AS "blocksRead"
      FROM pg_stat_statements s
      JOIN pg_database d ON d.oid = s.dbid
      WHERE d.datname = ${appDatabase}
    `;
    const database = await sql<
      {
        commits: string;
        rollbacks: string;
        returned: string;
        fetched: string;
        inserted: string;
        updated: string;
        deleted: string;
        deadlocks: string;
      }[]
    >`
      SELECT xact_commit::text AS commits, xact_rollback::text AS rollbacks,
             tup_returned::text AS returned, tup_fetched::text AS fetched,
             tup_inserted::text AS inserted, tup_updated::text AS updated,
             tup_deleted::text AS deleted, deadlocks::text AS deadlocks
      FROM pg_stat_database WHERE datname = ${appDatabase}
    `;
    const connections = await sql<{ state: string | null; count: string }[]>`
      SELECT state, count(*)::text AS count FROM pg_stat_activity
      WHERE datname = ${appDatabase} GROUP BY state
    `;
    const db = database[0];
    return {
      at,
      ok: true,
      statements: statements.map((row) => ({
        queryId: row.queryId,
        query: row.query,
        calls: Number(row.calls),
        totalMs: row.totalMs,
        rows: Number(row.rows),
        sharedBlocksRead: Number(row.blocksRead),
      })),
      database:
        db === undefined
          ? null
          : {
              commits: Number(db.commits),
              rollbacks: Number(db.rollbacks),
              tuplesReturned: Number(db.returned),
              tuplesFetched: Number(db.fetched),
              tuplesInserted: Number(db.inserted),
              tuplesUpdated: Number(db.updated),
              tuplesDeleted: Number(db.deleted),
              deadlocks: Number(db.deadlocks),
            },
      connections: Object.fromEntries(
        connections.map((row) => [row.state ?? 'unknown', Number(row.count)]),
      ),
    };
  } catch (error) {
    return {
      at,
      ok: false,
      error: String(error),
      statements: [],
      database: null,
      connections: {},
    };
  } finally {
    await sql.end({ timeout: 5 }).catch((error: unknown) => {
      console.warn('[load] database probe did not close cleanly:', error);
    });
  }
}

export interface DatabaseDelta {
  ok: boolean;
  error?: string;
  seconds: number;
  /** Statements by time spent during the run, the costliest first. */
  topStatements: (StatementStats & {
    meanMs: number;
    callsPerSecond: number;
  })[];
  transactionsPerSecond: number | null;
  rowsWrittenPerSecond: number | null;
  connectionsAtEnd: Record<string, number>;
}

export function diffDatabase(
  before: DatabaseSnapshot,
  after: DatabaseSnapshot,
  top = 25,
): DatabaseDelta {
  const seconds = Math.max(0.001, (after.at - before.at) / 1000);
  if (!before.ok || !after.ok) {
    return {
      ok: false,
      error: after.error ?? before.error ?? 'database probe failed',
      seconds,
      topStatements: [],
      transactionsPerSecond: null,
      rowsWrittenPerSecond: null,
      connectionsAtEnd: after.connections,
    };
  }
  const prior = new Map(before.statements.map((s) => [s.queryId, s]));
  const changed = after.statements
    .map((s) => {
      const p = prior.get(s.queryId);
      const calls = s.calls - (p?.calls ?? 0);
      const totalMs = s.totalMs - (p?.totalMs ?? 0);
      return {
        queryId: s.queryId,
        query: s.query.replace(/\s+/g, ' ').slice(0, 400),
        calls,
        totalMs,
        rows: s.rows - (p?.rows ?? 0),
        sharedBlocksRead: s.sharedBlocksRead - (p?.sharedBlocksRead ?? 0),
        meanMs: calls > 0 ? totalMs / calls : 0,
        callsPerSecond: calls / seconds,
      };
    })
    .filter((s) => s.calls > 0)
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, top);
  const db0 = before.database;
  const db1 = after.database;
  return {
    ok: true,
    seconds,
    topStatements: changed,
    transactionsPerSecond:
      db0 === null || db1 === null
        ? null
        : (db1.commits + db1.rollbacks - db0.commits - db0.rollbacks) / seconds,
    rowsWrittenPerSecond:
      db0 === null || db1 === null
        ? null
        : (db1.tuplesInserted +
            db1.tuplesUpdated +
            db1.tuplesDeleted -
            db0.tuplesInserted -
            db0.tuplesUpdated -
            db0.tuplesDeleted) /
          seconds,
    connectionsAtEnd: after.connections,
  };
}
