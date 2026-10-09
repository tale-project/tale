import { describe, expect, test } from 'bun:test';

import { MetricsRegistry } from '../../src/metrics/index.ts';
import { loadPlanSchema, type LoadPlan } from '../../src/plan.ts';
import {
  benchmarkAddress,
  mulberry32,
  personaFor,
  userSeed,
} from '../../src/runner/assign.ts';
import { exitCodeOf } from '../../src/runner/command.ts';
import { splitTarget } from '../../src/runner/orchestrator.ts';
import { UserPool } from '../../src/runner/pool.ts';
import {
  diffDatabase,
  diffServerMetrics,
  parsePrometheus,
  type DatabaseSnapshot,
  type MetricsScrape,
} from '../../src/runner/probes.ts';
import {
  buildProfile,
  profileSeconds,
  targetAt,
} from '../../src/runner/profiles.ts';
import {
  mergeReports,
  renderMarkdown,
  type RunReport,
} from '../../src/runner/report.ts';
import {
  DEFAULT_PERSONA_WEIGHTS,
  PERSONA_NAMES,
  scenarioOptionsSchema,
  type VirtualUserContext,
} from '../../src/scenario/contract.ts';

const PLAN: LoadPlan = loadPlanSchema.parse({
  version: 1,
  createdAt: '2026-10-08T00:00:00Z',
  target: 'http://127.0.0.1:1',
  runId: 'test1234',
  users: {
    count: 100,
    emailDomain: 'load.tale.invalid',
    password: 'Load!Passw0rd-123',
    sessionsMinted: false,
  },
  organizations: {
    count: 1,
    size: 100,
    megaOrgSize: 0,
    list: [
      {
        index: 0,
        id: 'o1',
        slug: 'load-test1234-o0',
        name: 'Test',
        ownerIndex: 0,
        projectId: null,
        providerSlug: null,
        modelId: null,
      },
    ],
  },
  provider: null,
});

describe('profiles', () => {
  test('a load profile ramps linearly, holds, then winds down', () => {
    const profile = buildProfile({
      profile: 'load',
      users: 1000,
      rampSeconds: 100,
      holdSeconds: 50,
    });
    expect(targetAt(profile, 0).users).toBe(0);
    expect(targetAt(profile, 50).users).toBe(500);
    expect(targetAt(profile, 120)).toEqual({ users: 1000, stage: 0 });
    expect(targetAt(profile, 150 + 30).users).toBe(500);
    expect(targetAt(profile, profileSeconds(profile) + 1)).toEqual({
      users: 0,
      stage: profile.stages.length,
    });
  });

  test('a stress profile climbs in equal steps and stops at a breakpoint', () => {
    const profile = buildProfile({
      profile: 'stress',
      users: 5000,
      rampSeconds: 50,
      holdSeconds: 60,
      steps: 5,
    });
    expect(profile.stages.map((s) => s.users)).toEqual([
      1000, 2000, 3000, 4000, 5000,
    ]);
    expect(profile.stopOnThresholdFailure).toBe(true);
  });

  test('connections and sign-in storm switch the right journeys off', () => {
    const connections = buildProfile({ profile: 'connections', users: 10 });
    expect(connections.scenario.chat).toBe(false);
    expect(connections.personas).toEqual({ browser: 1 });
    const storm = buildProfile({ profile: 'signin-storm', users: 10 });
    expect(storm.scenario.passwordSignInRate).toBe(1);
  });
});

describe('deterministic assignment', () => {
  test('the same user always plays the same persona, and the mix follows the weights', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 20_000; i += 1) {
      const persona = personaFor(DEFAULT_PERSONA_WEIGHTS, 7, i);
      expect(personaFor(DEFAULT_PERSONA_WEIGHTS, 7, i)).toBe(persona);
      counts.set(persona, (counts.get(persona) ?? 0) + 1);
    }
    const total = Object.values(DEFAULT_PERSONA_WEIGHTS).reduce(
      (sum, w) => sum + w,
      0,
    );
    for (const [name, weight] of Object.entries(DEFAULT_PERSONA_WEIGHTS)) {
      const share = (counts.get(name) ?? 0) / 20_000;
      expect(Math.abs(share - weight / total)).toBeLessThan(0.02);
    }
  });

  test('per-user random streams are reproducible and distinct', () => {
    const a = mulberry32(userSeed(1, 5));
    const b = mulberry32(userSeed(1, 5));
    const c = mulberry32(userSeed(1, 6));
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
  });

  test('benchmark addresses stay in 198.18.0.0/15', () => {
    for (const index of [0, 255, 256, 65_535, 65_536, 131_071, 131_072]) {
      const [a, b, c, d] = benchmarkAddress(index).split('.').map(Number);
      expect(a).toBe(198);
      expect(b === 18 || b === 19).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(255);
    }
    expect(benchmarkAddress(1)).not.toBe(benchmarkAddress(2));
  });
});

describe('splitTarget', () => {
  test('splits in proportion to capacity and never exceeds it', () => {
    expect(splitTarget(10, [5, 5])).toEqual([5, 5]);
    expect(splitTarget(7, [10, 10, 10])).toEqual([3, 2, 2]);
    expect(splitTarget(100, [3, 4])).toEqual([3, 4]);
    expect(splitTarget(5, [0, 10])).toEqual([0, 5]);
    const shares = splitTarget(1001, [400, 300, 301]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1001);
  });

  test('only ever raises a share as the target rises', () => {
    for (const capacities of [
      [3, 3, 2, 2],
      [2, 2, 1, 1, 1],
      [5],
      [7, 0, 4],
      [125, 125, 124, 124, 124, 124, 124, 124],
    ]) {
      const total = capacities.reduce((a, b) => a + b, 0);
      let previous = splitTarget(0, capacities);
      for (let target = 1; target <= total + 2; target += 1) {
        const shares = splitTarget(target, capacities);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(Math.min(target, total));
        shares.forEach((share, i) => {
          expect(share).toBeGreaterThanOrEqual(previous[i] ?? 0);
          expect(share).toBeLessThanOrEqual(capacities[i] ?? 0);
        });
        previous = shares;
      }
    }
  });
});

describe('UserPool', () => {
  function pool(range: { start: number; end: number }) {
    const started: number[] = [];
    const stopped: number[] = [];
    const metrics = new MetricsRegistry();
    const users = new UserPool({
      plan: PLAN,
      range,
      baseUrls: ['http://a', 'http://b'],
      agents: [{} as never],
      metrics,
      authSecret: null,
      personas: DEFAULT_PERSONA_WEIGHTS,
      personaAssignment: 'weighted',
      scenario: scenarioOptionsSchema.parse({}),
      forwardedFor: true,
      seed: 1,
      runUser: (ctx: VirtualUserContext) => {
        started.push(ctx.index);
        return new Promise<void>((resolve) => {
          ctx.signal.addEventListener('abort', () => {
            stopped.push(ctx.index);
            resolve();
          });
        });
      },
    });
    return { users, started, stopped, metrics };
  }

  test('follows the target, never runs an index twice, stops the newest first', async () => {
    const { users, started, stopped } = pool({ start: 10, end: 15 });
    users.setTarget(3);
    expect(users.active).toBe(3);
    expect(started).toEqual([10, 11, 12]);
    users.setTarget(99);
    expect(users.active).toBe(5);
    expect(new Set(started).size).toBe(started.length);
    users.setTarget(2);
    await Promise.resolve();
    expect(stopped).toEqual([14, 13, 12]);
    expect(users.active).toBe(2);
    expect(await users.stopAll(1_000)).toBe(0);
    expect(users.active).toBe(0);
  });

  test('regrowing right after a shrink starts what it can, never throws', async () => {
    const { users, started } = pool({ start: 0, end: 3 });
    users.setTarget(3);
    // Stopped users are still winding down: their indexes are taken.
    users.setTarget(1);
    expect(() => users.setTarget(3)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    users.setTarget(3);
    expect(users.active).toBe(3);
    expect(started.length).toBeGreaterThanOrEqual(3);
    await users.stopAll(1_000);
  });

  test('stopAll waits for users a falling target stopped earlier too', async () => {
    const metrics = new MetricsRegistry();
    const finish: Array<() => void> = [];
    const users = new UserPool({
      plan: PLAN,
      range: { start: 0, end: 2 },
      baseUrls: ['http://a'],
      agents: [{} as never],
      metrics,
      authSecret: null,
      personas: DEFAULT_PERSONA_WEIGHTS,
      personaAssignment: 'weighted',
      scenario: scenarioOptionsSchema.parse({}),
      forwardedFor: false,
      seed: 1,
      // A user that winds down only when the test lets it.
      runUser: () =>
        new Promise<void>((resolve) => {
          finish.push(resolve);
        }),
    });
    users.setTarget(2);
    users.setTarget(0);
    expect(users.active).toBe(0);
    expect(await users.stopAll(50)).toBe(2);
    for (const done of finish) done();
  });

  test('round-robin personas cover every persona among a few users', () => {
    const personas: string[] = [];
    const users = new UserPool({
      plan: PLAN,
      range: { start: 0, end: 14 },
      baseUrls: ['http://a'],
      agents: [{} as never],
      metrics: new MetricsRegistry(),
      authSecret: null,
      personas: DEFAULT_PERSONA_WEIGHTS,
      personaAssignment: 'round-robin',
      scenario: scenarioOptionsSchema.parse({}),
      forwardedFor: false,
      seed: 1,
      runUser: (ctx: VirtualUserContext) => {
        personas.push(ctx.persona);
        return Promise.resolve();
      },
    });
    users.setTarget(PERSONA_NAMES.length);
    expect(new Set(personas)).toEqual(new Set(PERSONA_NAMES));
  });

  test('a crashing user is counted, not hidden', async () => {
    const metrics = new MetricsRegistry();
    const users = new UserPool({
      plan: PLAN,
      range: { start: 0, end: 2 },
      baseUrls: ['http://a'],
      agents: [{} as never],
      metrics,
      authSecret: null,
      personas: DEFAULT_PERSONA_WEIGHTS,
      personaAssignment: 'weighted',
      scenario: scenarioOptionsSchema.parse({}),
      forwardedFor: false,
      seed: 1,
      runUser: () => Promise.reject(new Error('boom')),
    });
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      users.setTarget(1);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      console.error = original;
    }
    expect(metrics.errorCount('user', 'crashed')).toBe(1);
    expect(errors).toHaveLength(1);
    expect(users.active).toBe(0);
  });
});

describe('probes', () => {
  const scrape = (text: string, at: number): MetricsScrape => ({
    url: 'http://x/metrics',
    at,
    ok: true,
    samples: parsePrometheus(text),
  });

  test('parses the exposition format, labels and all', () => {
    const samples = parsePrometheus(
      [
        '# HELP x y',
        'tale_backend_http_requests_total{method="GET",route="/api/app/x",status="200"} 5',
        'process_cpu_seconds_total 1.5',
        'weird{label="a \\"quoted\\" value"} 2',
      ].join('\n'),
    );
    expect(samples).toHaveLength(3);
    expect(samples[0]?.labels).toEqual({
      method: 'GET',
      route: '/api/app/x',
      status: '200',
    });
    expect(samples[1]?.value).toBe(1.5);
  });

  test('diffs a run’s backend requests, mean durations and CPU', () => {
    const before = scrape(
      [
        'tale_backend_http_requests_total{method="GET",route="/a",status="200"} 10',
        'tale_backend_http_request_duration_seconds_sum{method="GET",route="/a"} 1',
        'tale_backend_http_request_duration_seconds_count{method="GET",route="/a"} 10',
        'process_cpu_seconds_total 5',
      ].join('\n'),
      0,
    );
    const after = scrape(
      [
        'tale_backend_http_requests_total{method="GET",route="/a",status="200"} 30',
        'tale_backend_http_request_duration_seconds_sum{method="GET",route="/a"} 5',
        'tale_backend_http_request_duration_seconds_count{method="GET",route="/a"} 30',
        'process_cpu_seconds_total 12',
        'tale_backend_hint_streams_open 42',
      ].join('\n'),
      1000,
    );
    const delta = diffServerMetrics(before, after);
    expect(delta.requests).toEqual([
      { route: 'GET /a', status: '200', count: 20 },
    ]);
    expect(delta.meanSeconds[0]?.seconds).toBeCloseTo(0.2);
    expect(delta.cpuSeconds).toBe(7);
    expect(delta.gauges.tale_backend_hint_streams_open).toBe(42);
  });

  test('diffs statement statistics by time spent', () => {
    const snapshot = (
      at: number,
      calls: number,
      totalMs: number,
    ): DatabaseSnapshot => ({
      at,
      ok: true,
      statements: [
        {
          queryId: '1',
          query: 'SELECT 1',
          calls,
          totalMs,
          rows: calls,
          sharedBlocksRead: 0,
        },
      ],
      database: {
        commits: calls,
        rollbacks: 0,
        tuplesReturned: 0,
        tuplesFetched: 0,
        tuplesInserted: 0,
        tuplesUpdated: 0,
        tuplesDeleted: 0,
        deadlocks: 0,
      },
      connections: { idle: 3 },
    });
    const delta = diffDatabase(
      snapshot(0, 100, 50),
      snapshot(10_000, 1100, 550),
    );
    expect(delta.topStatements[0]?.calls).toBe(1000);
    expect(delta.topStatements[0]?.meanMs).toBeCloseTo(0.5);
    expect(delta.transactionsPerSecond).toBeCloseTo(100);
  });
});

describe('mergeReports', () => {
  function report(requests: number, peakUsers: number): RunReport {
    const metrics = new MetricsRegistry({ shard: { index: 0, count: 2 } });
    for (let i = 0; i < requests; i += 1)
      metrics.request('GET /x', 10 + i, 200);
    const snapshot = metrics.snapshot();
    return {
      version: 1,
      tool: '@tale/load',
      profile: 'load',
      peakUsers,
      planRunId: 'test1234',
      targets: ['http://a'],
      shard: { index: 0, count: 2 },
      processes: 1,
      startedAt: '2026-10-08T00:00:00.000Z',
      endedAt: '2026-10-08T00:01:00.000Z',
      outcome: {
        stoppedEarly: false,
        breakingPoint: null,
        stages: [],
        workerFailures: [],
        stragglers: 0,
      },
      thresholdSpec: { 'http.p95': '<1000' },
      thresholds: [],
      passed: true,
      summary: undefined as never,
      server: { metrics: [], database: null },
      snapshot,
    };
  }

  test('merges shard distributions exactly and re-judges the thresholds', () => {
    const merged = mergeReports([report(100, 10), report(300, 30)]);
    expect(merged.summary.http.count).toBe(400);
    expect(merged.peakUsers).toBe(40);
    expect(merged.shard.count).toBe(2);
    expect(merged.thresholds.every((t) => t.ok)).toBe(true);
    expect(merged.passed).toBe(true);
  });

  test('sums every shard into each stage and breaks at the earliest shard', () => {
    const stage = (
      index: number,
      users: number,
      requests: number,
      errors: number,
      p95Ms: number,
      held: boolean,
    ) => ({
      stage: index,
      users,
      requests,
      errors,
      errorRate: errors / requests,
      p95Ms,
      held,
    });
    const a = report(10, 300);
    a.outcome.stages = [
      stage(0, 100, 1000, 0, 200, true),
      stage(1, 200, 2000, 10, 400, true),
      stage(2, 300, 3000, 600, 2500, false),
    ];
    a.outcome.breakingPoint = { stage: 1, users: 200 };
    const b = report(10, 200);
    b.outcome.stages = [
      stage(0, 100, 1000, 10, 300, true),
      stage(1, 200, 2000, 400, 1900, false),
    ];
    b.outcome.breakingPoint = { stage: 0, users: 100 };
    const merged = mergeReports([a, b]);
    expect(merged.outcome.stages).toEqual([
      stage(0, 200, 2000, 10, 300, true),
      stage(1, 400, 4000, 410, 1900, false),
    ]);
    expect(merged.outcome.breakingPoint).toEqual({ stage: 0, users: 200 });
    expect(renderMarkdown(merged)).toContain(
      'held through 200 users (stage 1)',
    );
    expect(renderMarkdown(merged)).toContain('Merged from 2 shards');
    // One shard's own report of a two-shard run makes no merge claim.
    const { mergedFrom: _, ...shardOwn } = merged;
    expect(renderMarkdown(shardOwn)).not.toContain('Merged from');
  });

  test('a harness failure exits 2, a threshold failure 1', () => {
    const failed = report(10, 1);
    failed.outcome.workerFailures = ['worker 0 exited with code 1'];
    expect(exitCodeOf(mergeReports([failed, report(10, 1)]))).toBe(2);
    const slow = report(10, 1);
    slow.passed = false;
    expect(exitCodeOf(slow)).toBe(1);
    expect(exitCodeOf(report(10, 1))).toBe(0);
  });
});
