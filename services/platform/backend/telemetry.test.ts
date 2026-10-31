import { readFileSync } from 'node:fs';

import * as client from 'prom-client';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  backendMetricsResponse,
  hintStreamClosed,
  hintStreamOpened,
  methodClass,
  openHintStreamCount,
  registerAgentRunCollectors,
  registerBackendCollectors,
  registerPasswordHashCollectors,
  routeClass,
} from './telemetry.ts';

afterEach(() => {
  client.register.clear();
});

describe('routeClass', () => {
  test('labels app routes by their domain segment, never the raw path', () => {
    expect(routeClass('/api/app/chat/threads/abc-123/messages')).toBe(
      '/api/app/chat',
    );
    expect(routeClass('/api/app/tasks/9f2/comments')).toBe('/api/app/tasks');
    // An id must never reach the label set — two ids collapse to one series.
    expect(routeClass('/api/app/documents/a')).toBe(
      routeClass('/api/app/documents/b'),
    );
  });

  test('every mounted app domain has a named class', () => {
    const source = readFileSync(new URL('./app.ts', import.meta.url), 'utf8');
    const domains = [
      ...source.matchAll(/app\.route\(\s*'(\/api\/app\/[^']+)'/g),
    ].map((match) => match[1]!);
    expect(domains.length).toBeGreaterThan(40);
    for (const domain of domains) expect(routeClass(domain)).toBe(domain);
  });

  test('20,000 attacker-controlled paths and methods retain one label each', () => {
    const routes = new Set<string>();
    const methods = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) {
      routes.add(routeClass(`/api/app/unknown-${i}/secret-${i}`));
      methods.add(methodClass(`EXTENSION${i}`));
    }
    expect([...routes]).toEqual(['/api/app']);
    expect([...methods]).toEqual(['OTHER']);
    expect(methodClass('GET')).toBe('GET');
    expect(methodClass('PROPFIND')).toBe('PROPFIND');
  });

  test('collapses the machine doors and pre-auth lanes', () => {
    expect(routeClass('/api/auth/sign-in/email')).toBe('/api/auth');
    expect(routeClass('/api/tools/execute')).toBe('/api/tools');
    expect(routeClass('/api/v1/projects/p-1/tasks/1')).toBe('/api/v1');
    expect(routeClass('/api/control/drain')).toBe('/api/control');
    expect(routeClass('/api/sso/callback/x')).toBe('/api/sso');
    expect(routeClass('/http_api/api/sso/callback/x')).toBe('/api/sso');
    expect(routeClass('/scim/v2/Users/7')).toBe('/scim/v2');
    expect(routeClass('/http_api/scim/v2/Groups')).toBe('/scim/v2');
    expect(routeClass('/api/automations/webhook/tok')).toBe(
      '/api/automations/webhook',
    );
    expect(routeClass('/api/projects/project-1/automations/webhook/tok')).toBe(
      '/api/automations/webhook',
    );
    expect(routeClass('/dav/org/file.txt')).toBe('/dav');
  });

  test('keeps the fixed routes and buckets everything else', () => {
    expect(routeClass('/events')).toBe('/events');
    expect(routeClass('/api/image-proxy')).toBe('/api/image-proxy');
    expect(routeClass('/ping')).toBe('/ping');
    expect(routeClass('/metrics')).toBe('/metrics');
    expect(routeClass('/health/stores')).toBe('/health/stores');
    expect(routeClass('/whatever/else')).toBe('other');
  });
});

describe('hint-stream gauge', () => {
  test('pairs open/close and never goes negative', () => {
    const start = openHintStreamCount();
    hintStreamOpened();
    hintStreamOpened();
    expect(openHintStreamCount()).toBe(start + 2);
    hintStreamClosed();
    expect(openHintStreamCount()).toBe(start + 1);
    hintStreamClosed();
    hintStreamClosed();
    hintStreamClosed();
    // A double-close (abort + finally) must not drive the gauge below zero.
    expect(openHintStreamCount()).toBe(0);
  });
});

/**
 * The store-reachability gauge reaches OUT of the process (see
 * `store-health.ts`). These tests are about the database-backed collectors, so
 * it answers from a stub rather than dialling a database and a bucket.
 */
vi.mock('./store-health.ts', () => ({
  probeStores: () =>
    Promise.resolve([
      { name: 'app_db', up: true },
      { name: 'knowledge_db', up: true },
      { name: 'object_store', up: false, detail: 'stubbed' },
    ]),
}));

describe('the password hasher’s collectors', () => {
  test('state the slots in use, the queue and the refusals on scrape', async () => {
    let stats = {
      concurrency: 2,
      maxQueued: 32,
      active: 2,
      waiting: 5,
      refusedQueueFull: 3,
      refusedWaitExpired: 1,
    };
    registerPasswordHashCollectors(() => stats);

    const first = await client.register.metrics();
    expect(first).toContain('tale_backend_password_checks_active 2');
    expect(first).toContain('tale_backend_password_checks_waiting 5');
    expect(first).toContain(
      'tale_backend_password_checks_refused_total{reason="queue_full"} 3',
    );
    expect(first).toContain(
      'tale_backend_password_checks_refused_total{reason="wait_expired"} 1',
    );

    // A scrape restates the running totals; the counter never goes backwards.
    stats = { ...stats, active: 0, waiting: 0, refusedQueueFull: 7 };
    const second = await client.register.metrics();
    expect(second).toContain('tale_backend_password_checks_active 0');
    expect(second).toContain(
      'tale_backend_password_checks_refused_total{reason="queue_full"} 7',
    );
  });
});

describe('pull-time collectors', () => {
  /** A `postgres` stand-in whose tagged-template call returns fixed rows. */
  function fakeSql(rowsByQuery: (text: string) => unknown[]) {
    return ((strings: TemplateStringsArray) =>
      Promise.resolve(rowsByQuery(strings.join('?')))) as unknown as Parameters<
      typeof registerBackendCollectors
    >[0];
  }

  test('reads generations, job states and the drain flag on scrape', async () => {
    const gauges = registerBackendCollectors(
      fakeSql((text) => {
        if (text.includes('app.generations')) return [{ count: '3' }];
        if (text.includes('pgboss.job')) {
          return [
            { state: 'created', count: '12' },
            { state: 'failed', count: '2' },
          ];
        }
        if (text.includes('backend_control')) return [{ draining: true }];
        return [];
      }),
    );
    // `register.metrics()` runs every registered `collect()` itself — the
    // real scrape path, so the test exercises what Prometheus would.
    expect(gauges).toHaveLength(7);
    const metrics = await client.register.metrics();
    expect(metrics).toContain('tale_backend_generations_inflight 3');
    expect(metrics).toContain('tale_backend_jobs{state="created"} 12');
    expect(metrics).toContain('tale_backend_jobs{state="failed"} 2');
    expect(metrics).toContain('tale_backend_drain_active 1');
  });

  test('a job state that empties between scrapes drops out of the series', async () => {
    let jobRows: unknown[] = [
      { state: 'created', count: '12' },
      { state: 'failed', count: '2' },
    ];
    registerBackendCollectors(
      fakeSql((text) => (text.includes('pgboss.job') ? jobRows : [])),
    );
    expect(await client.register.metrics()).toContain(
      'tale_backend_jobs{state="failed"} 2',
    );
    // The failed jobs were retried away: no GROUP BY row for that state.
    jobRows = [{ state: 'created', count: '3' }];
    const second = await client.register.metrics();
    expect(second).toContain('tale_backend_jobs{state="created"} 3');
    // A stale child would still read 2 here and keep a backlog alert firing.
    expect(second).not.toContain('state="failed"');
  });

  test('a failing query leaves its gauge unset instead of failing the scrape', async () => {
    const gauges = registerBackendCollectors(
      fakeSql(() => {
        throw new Error('connection reset');
      }),
    );
    expect(gauges).toHaveLength(7);
    // The scrape still renders: each collector swallowed its own failure.
    await expect(client.register.metrics()).resolves.toBeTypeOf('string');
  });

  test('scan evidence advances only with a new durable completion and fails closed on missing/query failure', async () => {
    const name =
      'tale_backend_automation_trigger_scan_last_success_timestamp_seconds';
    let completed: unknown = 1_791_123_456;
    let failed = false;
    registerBackendCollectors(
      fakeSql((text) => {
        if (!text.includes('triggerScanCompleted')) return [];
        expect(text).toContain('name = ?');
        expect(text).toContain("state = 'completed'");
        expect(text).toContain("= 'true'::jsonb");
        expect(text).toContain("interval '10 minutes'");
        if (failed) throw new Error('database unavailable');
        return [{ completed }];
      }),
    );
    const sample = async () => {
      const metrics = await client.register.metrics();
      return metrics.split('\n').find((line) => line.startsWith(`${name} `));
    };
    expect(await sample()).toBe(`${name} 1791123456`);
    // Scraping a healthy API cannot move a stopped worker's timestamp.
    expect(await sample()).toBe(`${name} 1791123456`);
    completed = 1_791_123_516;
    expect(await sample()).toBe(`${name} 1791123516`);
    failed = true;
    expect(await sample()).toBe(`${name} 0`);
    failed = false;
    expect(await sample()).toBe(`${name} 1791123516`);
    for (const missing of [null, undefined, Number.NaN, Infinity, -1, '123']) {
      completed = missing;
      expect(await sample()).toBe(`${name} 0`);
    }
  });
});

describe('the dispatch heartbeat', () => {
  function fakeSql(rowsByQuery: (text: string) => unknown[]) {
    return ((strings: TemplateStringsArray) =>
      Promise.resolve(rowsByQuery(strings.join('?')))) as unknown as Parameters<
      typeof registerBackendCollectors
    >[0];
  }
  const name = 'tale_backend_dispatch_last_pass_timestamp_seconds';

  test("reports each switched-on dispatch's last pass, drops one switched off, and zeroes them when unreadable [TASK-R50]", async () => {
    let rows: unknown[] = [
      { projectId: 'fleet', at: 1_791_123_456_789 },
      { projectId: 'docs', at: null },
    ];
    let failed = false;
    registerBackendCollectors(
      fakeSql((text) => {
        if (!text.includes('app.project_dispatch d')) return [];
        expect(text).toContain('d.enabled = true');
        if (failed) throw new Error('database unavailable');
        return rows;
      }),
    );
    const sample = async () =>
      (await client.register.metrics())
        .split('\n')
        .filter((line) => line.startsWith(`${name}{`))
        .sort();
    expect(await sample()).toEqual([
      `${name}{project="docs"} 0`,
      `${name}{project="fleet"} 1791123456`,
    ]);
    rows = [{ projectId: 'fleet', at: 1_791_123_516_000 }];
    expect(await sample()).toEqual([`${name}{project="fleet"} 1791123516`]);
    failed = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await sample()).toEqual([`${name}{project="fleet"} 0`]);
  });
});

describe('the agent runs’ parks, wakes and failures [TASK-R93]', () => {
  /** A `postgres` stand-in answering by statement text and values. */
  function fakeSql(answer: (text: string, values: unknown[]) => unknown[]) {
    const query = (strings: TemplateStringsArray, ...values: unknown[]) =>
      Promise.resolve(answer(strings.join('?'), values));
    return Object.assign(query, {
      unsafe: (text: string) => text,
    }) as unknown as Parameters<typeof registerAgentRunCollectors>[0];
  }
  const scrape = async (...names: string[]) =>
    (await client.register.metrics())
      .split('\n')
      .filter((line) => names.some((name) => line.startsWith(`${name}{`)))
      .sort();

  test('states every closed label from zero and restates the deployment’s totals on each scrape', async () => {
    let totals: Record<string, unknown[]> = {
      park: [
        { label: 'host', total: '4' },
        // A label outside the closed set never becomes a series.
        { label: 'org-1', total: '9' },
      ],
      wake: [{ label: 'release', total: '3' }],
      wake_failure: [],
      failure: [{ label: 'resource_exhausted', total: '2' }],
    };
    let failed = false;
    const metrics = registerAgentRunCollectors(
      fakeSql((text, values) => {
        if (failed) throw new Error('database unavailable');
        if (text.includes('app.agent_run_counters')) {
          return totals[String(values[0])] ?? [];
        }
        if (text.includes('app.project_agent_runs')) {
          // Every organization's parked runs: no organization in the read.
          expect(text).not.toContain('org_id');
          return [
            { reason: 'model_capacity', count: 3 },
            { reason: null, count: 1 },
          ];
        }
        return [];
      }),
    );
    expect(metrics).toHaveLength(5);

    expect(
      await scrape(
        'tale_backend_agent_run_parks_total',
        'tale_backend_agent_run_wakes_total',
        'tale_backend_agent_run_wake_failures_total',
        'tale_backend_agent_runs_waiting',
      ),
    ).toEqual([
      'tale_backend_agent_run_parks_total{reason="destroy_pending"} 0',
      'tale_backend_agent_run_parks_total{reason="exec_limit"} 0',
      'tale_backend_agent_run_parks_total{reason="host"} 4',
      'tale_backend_agent_run_parks_total{reason="model_capacity"} 0',
      'tale_backend_agent_run_parks_total{reason="org_limit"} 0',
      'tale_backend_agent_run_parks_total{reason="unknown"} 0',
      'tale_backend_agent_run_wake_failures_total{source="release"} 0',
      'tale_backend_agent_run_wake_failures_total{source="scheduled"} 0',
      'tale_backend_agent_run_wake_failures_total{source="watchdog"} 0',
      'tale_backend_agent_run_wakes_total{source="release"} 3',
      'tale_backend_agent_run_wakes_total{source="scheduled"} 0',
      'tale_backend_agent_run_wakes_total{source="watchdog"} 0',
      'tale_backend_agent_runs_waiting{reason="destroy_pending"} 0',
      'tale_backend_agent_runs_waiting{reason="exec_limit"} 0',
      'tale_backend_agent_runs_waiting{reason="host"} 0',
      'tale_backend_agent_runs_waiting{reason="model_capacity"} 3',
      'tale_backend_agent_runs_waiting{reason="org_limit"} 0',
      'tale_backend_agent_runs_waiting{reason="unknown"} 1',
    ]);
    const failures = await scrape('tale_backend_agent_run_failures_total');
    expect(failures).toContain(
      'tale_backend_agent_run_failures_total{code="resource_exhausted"} 2',
    );
    expect(failures).toContain(
      'tale_backend_agent_run_failures_total{code="unknown"} 0',
    );
    expect(failures.every((line) => /\{code="[a-z_]+"\} \d+$/.test(line))).toBe(
      true,
    );

    // The database holds the running totals: a scrape restates them rather
    // than adding them to what the last scrape read.
    totals = { ...totals, park: [{ label: 'host', total: '5' }] };
    expect(await scrape('tale_backend_agent_run_parks_total')).toContain(
      'tale_backend_agent_run_parks_total{reason="host"} 5',
    );

    // An unreadable database leaves the totals without a sample rather than
    // serving this replica's last ones: behind one scrape target another
    // replica may already have served a higher total, and a lower one after
    // it reads as a counter reset. The waiting gauge keeps its last values,
    // and the scrape still renders.
    failed = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const counters = [
        'tale_backend_agent_run_parks_total',
        'tale_backend_agent_run_wakes_total',
        'tale_backend_agent_run_wake_failures_total',
        'tale_backend_agent_run_failures_total',
      ];
      expect(await scrape(...counters)).toEqual([]);
      expect(await client.register.metrics()).toContain(
        '# TYPE tale_backend_agent_run_parks_total counter',
      );
      expect(await scrape('tale_backend_agent_runs_waiting')).toContain(
        'tale_backend_agent_runs_waiting{reason="model_capacity"} 3',
      );
      for (const name of counters) {
        expect(warn).toHaveBeenCalledWith(
          `[metrics] ${name} failed:`,
          expect.any(Error),
        );
      }
    } finally {
      warn.mockRestore();
    }

    // The next good read restates the deployment's total, not a count from
    // zero.
    failed = false;
    expect(await scrape('tale_backend_agent_run_parks_total')).toContain(
      'tale_backend_agent_run_parks_total{reason="host"} 5',
    );
  });
});

describe('overlapping metrics scrapes', () => {
  test('100 simultaneous scrapes run one collection and receive independent bodies', async () => {
    const collect = vi.fn(async function (this: client.Gauge) {
      await Promise.resolve();
      this.set(42);
    });
    const gauge = new client.Gauge({
      name: 'test_scrape_singleflight',
      help: 'test',
      collect,
    });
    const responses = await Promise.all(
      Array.from({ length: 100 }, () => backendMetricsResponse()),
    );
    expect(client.register.getSingleMetric('test_scrape_singleflight')).toBe(
      gauge,
    );
    expect(collect).toHaveBeenCalledTimes(1);
    const bodies = await Promise.all(
      responses.map((response) => response.text()),
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('test_scrape_singleflight 42');
    await backendMetricsResponse();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  test('a failed render clears the in-flight promise so the next scrape recovers', async () => {
    const metrics = vi
      .spyOn(client.register, 'metrics')
      .mockRejectedValueOnce(new Error('failed'));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect((await backendMetricsResponse()).status).toBe(500);
      expect((await backendMetricsResponse()).status).toBe(200);
      expect(metrics).toHaveBeenCalledTimes(2);
    } finally {
      metrics.mockRestore();
      error.mockRestore();
    }
  });
});
