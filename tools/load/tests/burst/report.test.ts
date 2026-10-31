import { describe, expect, test } from 'bun:test';

import {
  type BurstObservation,
  type Check,
  defaultReserveBytes,
  judgeBurst,
  renderBurstMarkdown,
} from '../../src/burst/report.ts';
import type { RunTrack, TaskTrack } from '../../src/burst/runs.ts';

const GIB = 1024 ** 3;
const STARTED_AT = '2026-10-31T00:00:00.000Z';
const START_MS = Date.parse(STARTED_AT);
const MOCK_METRICS = 'http://127.0.0.1:4200/metrics';
/** What the mock answers once a hog's result came back. */
const ANSWER =
  'According to `Bash`, the result starts with "held 2048 MiB and spun 60 s".';

function run(id: string, overrides: Partial<RunTrack> = {}): RunTrack {
  return {
    id,
    taskId: `task-of-${id}`,
    agentId: 'agent-1',
    trigger: 'assignment',
    place: 'settled',
    failureCode: null,
    error: null,
    resultText: ANSWER,
    startedAt: START_MS,
    launchedAt: START_MS + 5_000,
    settledAt: START_MS + 90_000,
    reasons: [],
    parkedWithoutReason: 0,
    parkedMs: 0,
    longestPendingMs: 1_000,
    placeSinceMs: START_MS + 90_000,
    ...overrides,
  };
}

function task(index: number, runs: RunTrack[]): TaskTrack {
  return {
    taskId: `task-${index}`,
    title: `Burst run ${index + 1}`,
    agentIndex: index,
    createdAtMs: START_MS + index * 15_000,
    runs,
    doneAtMs: START_MS + 100_000 + index * 15_000,
    longestWithoutRunMs: 0,
  };
}

/** A burst that held: two runs, one waited for the host and then settled. */
function held(): BurstObservation {
  return {
    settings: {
      target: 'http://10.0.0.5:3005',
      spawnerUrl: 'http://127.0.0.1:8003',
      organizationId: 'org-0',
      projectId: 'project-0',
      agents: 2,
      runs: 2,
      windowSeconds: 30,
      hogMib: 2048,
      hogSeconds: 60,
      projectSessions: 22,
      deploymentSessions: 25,
      pendingGraceSeconds: 60,
      deadlineSeconds: 1_800,
      host: { cpus: 4, totalMemoryBytes: 16 * GIB },
    },
    startedAt: STARTED_AT,
    durationMs: 130_000,
    timedOut: false,
    creations: [
      {
        index: 0,
        agentIndex: 0,
        atMs: 0,
        taskId: 'task-0',
        status: 200,
        code: null,
      },
      {
        index: 1,
        agentIndex: 1,
        atMs: 15_000,
        taskId: 'task-1',
        status: 200,
        code: null,
      },
    ],
    tasks: [
      task(0, [run('run-0')]),
      task(1, [run('run-1', { reasons: ['host'], parkedMs: 40_000 })]),
    ],
    maxConcurrentRuns: 1,
    memory: {
      samples: 130,
      errors: 0,
      firstError: null,
      totalBytes: 16 * GIB,
      minAvailableBytes: 3 * GIB,
      minAtMs: 70_000,
    },
    admission: {
      samples: 65,
      errors: 0,
      firstError: null,
      admits: 40,
      holds: { memory: 25 },
      reserveBytes: 1.6 * GIB,
      minAvailableBytes: 3 * GIB,
      maxRunning: 1,
      maxStarting: 1,
      limit: 25,
    },
    health: {
      path: '/api/health/ready',
      probes: 520,
      failures: 0,
      firstFailure: null,
      p50Ms: 3,
      p95Ms: 11,
      p99Ms: 40,
      maxMs: 310,
    },
    oom: {
      vmstatBefore: 4,
      vmstatAfter: 5,
      kernelLogError: null,
      kills: [
        {
          atSeconds: 1_234.5,
          scope: 'cgroup',
          pid: 4242,
          process: 'python3',
          line: '[ 1234.500000] Memory cgroup out of memory: Killed process 4242 (python3)',
        },
      ],
    },
    load: { url: MOCK_METRICS, error: null, calls: 2, results: 2 },
    logs: [
      {
        path: 'logs/api-0.log',
        counts: { 'pool connect timeout': 0 },
        examples: [],
      },
      {
        path: 'logs/worker-0.log',
        counts: { 'pool connect timeout': 0 },
        examples: [],
      },
    ],
  };
}

function check(observation: BurstObservation, key: string): Check {
  const found = judgeBurst(observation).checks.find((c) => c.key === key);
  if (found === undefined) throw new Error(`no check ${key}`);
  return found;
}

describe('judgeBurst', () => {
  test('a burst the host held passes every expectation', () => {
    const report = judgeBurst(held());
    expect(report.checks.map((c) => [c.key, c.pass])).toEqual([
      ['load-applied', true],
      ['host-oom', true],
      ['memory-reserve', true],
      ['pool-timeouts', true],
      ['health-p95', true],
      ['visible-waits', true],
      ['capacity-failures', true],
      ['runs-complete', true],
    ]);
    expect(report.pass).toBe(true);
    expect(check(held(), 'host-oom').figure).toBe(
      '0 host-wide, 1 inside session cgroups (vmstat oom_kill +1)',
    );
    expect(check(held(), 'visible-waits').figure).toBe(
      '1 runs waited (host ×1); 0 waits without a reason',
    );
    expect(check(held(), 'load-applied').figure).toBe(
      '2 hogs ran to their end for 2 runs; 2 hog calls sent',
    );
  });

  test('a turn whose hog never ran to its end misses', () => {
    const observation = held();
    observation.load = { ...observation.load, calls: 2, results: 1 };
    const load = check(observation, 'load-applied');
    expect(load.pass).toBe(false);
    expect(load.figure).toBe(
      '1 hogs ran to their end for 2 runs; 2 hog calls sent',
    );
    expect(load.details).toEqual([
      '1 hog calls brought back no hog that ran to its end: the command failed or was killed, or its turn ended first',
    ]);
  });

  test('turns the mock never asked to run the hog miss', () => {
    const observation = held();
    observation.load = { ...observation.load, calls: 0, results: 0 };
    const load = check(observation, 'load-applied');
    expect(load.pass).toBe(false);
    expect(load.details).toEqual([
      "2 of 2 runs' turns got no hog call: the mock saw no shell tool or no [[mock:hog]] in them, or the run never reached its turn",
    ]);
  });

  test("a retried run's extra hog call is no miss", () => {
    const observation = held();
    observation.load = { ...observation.load, calls: 3, results: 2 };
    const load = check(observation, 'load-applied');
    expect(load.pass).toBe(true);
    expect(load.details).toEqual([]);
  });

  test('hog counts that could not be read miss, with the reason', () => {
    const observation = held();
    observation.load = {
      url: MOCK_METRICS,
      error: `${MOCK_METRICS} did not answer: ECONNREFUSED`,
      calls: null,
      results: null,
    };
    const load = check(observation, 'load-applied');
    expect(load.pass).toBe(false);
    expect(load.figure).toBe(
      `not observed: no hog counts from ${MOCK_METRICS}`,
    );
    expect(load.details).toEqual([
      `${MOCK_METRICS} did not answer: ECONNREFUSED`,
    ]);
  });

  test('a host-wide OOM kill misses', () => {
    const observation = held();
    observation.oom.kills.push({
      atSeconds: 1_300,
      scope: 'host',
      pid: 900,
      process: 'node',
      line: '[ 1300.000000] Out of memory: Killed process 900 (node)',
    });
    const host = check(observation, 'host-oom');
    expect(host.pass).toBe(false);
    expect(host.details).toEqual([
      '[ 1300.000000] Out of memory: Killed process 900 (node)',
    ]);
  });

  test('without the kernel log, only no OOM kill at all passes', () => {
    const observation = held();
    observation.oom = {
      vmstatBefore: 4,
      vmstatAfter: 4,
      kernelLogError:
        'dmesg: read kernel buffer failed: Operation not permitted',
      kills: [],
    };
    expect(check(observation, 'host-oom').pass).toBe(true);
    observation.oom.vmstatAfter = 6;
    expect(check(observation, 'host-oom').pass).toBe(false);
    observation.oom.vmstatAfter = null;
    expect(check(observation, 'host-oom').pass).toBe(false);
  });

  test("memory at or below the spawner's reserve misses", () => {
    const observation = held();
    observation.memory.minAvailableBytes = 1.6 * GIB;
    const memory = check(observation, 'memory-reserve');
    expect(memory.pass).toBe(false);
    expect(memory.figure).toContain('reserve 1.60 GiB (spawner)');
  });

  test('without the spawner, the default reserve decides', () => {
    expect(defaultReserveBytes(16 * GIB)).toBe(Math.floor(1.6 * GIB));
    expect(defaultReserveBytes(4 * GIB)).toBe(GIB);
    const observation = held();
    observation.admission = null;
    observation.memory.minAvailableBytes = 1.5 * GIB;
    const memory = check(observation, 'memory-reserve');
    expect(memory.pass).toBe(false);
    expect(memory.figure).toContain('(default)');
  });

  test('a figure nobody observed misses', () => {
    const observation = held();
    observation.memory = {
      samples: 0,
      errors: 3,
      firstError: 'cannot read /proc/meminfo: ENOENT',
      totalBytes: null,
      minAvailableBytes: null,
      minAtMs: null,
    };
    observation.admission = null;
    observation.logs = null;
    observation.health = { ...observation.health, probes: 0 };
    observation.load = { url: null, error: null, calls: null, results: null };
    const report = judgeBurst(observation);
    const failed = report.checks.filter((c) => !c.pass).map((c) => c.key);
    expect(failed).toEqual([
      'load-applied',
      'memory-reserve',
      'pool-timeouts',
      'health-p95',
    ]);
    expect(report.checks[0]?.figure).toBe(
      "not observed: no mock provider's metrics to read",
    );
    expect(report.pass).toBe(false);
    expect(renderBurstMarkdown(report)).toContain(
      "- Each run's turn holds 2048 MiB and keeps a CPU busy for 60 s; no mock provider's hog counts were read",
    );
  });

  test('a pool timeout in any log misses, with its lines', () => {
    const observation = held();
    observation.logs = [
      {
        path: 'logs/worker-0.log',
        counts: { 'pool connect timeout': 2, CONNECT_TIMEOUT: 0 },
        examples: ['timeout exceeded when trying to connect'],
      },
    ];
    const pool = check(observation, 'pool-timeouts');
    expect(pool.pass).toBe(false);
    expect(pool.figure).toBe('2 in 1 process logs');
    expect(pool.details).toEqual([
      'logs/worker-0.log: pool connect timeout ×2, CONNECT_TIMEOUT ×0',
      '  timeout exceeded when trying to connect',
    ]);
  });

  test('a slow or failing readiness door misses', () => {
    const slow = held();
    slow.health.p95Ms = 1_000;
    expect(check(slow, 'health-p95').pass).toBe(false);
    const failing = held();
    failing.health.failures = 1;
    failing.health.firstFailure = '/api/health/ready answered HTTP 503';
    const health = check(failing, 'health-p95');
    expect(health.pass).toBe(false);
    expect(health.details).toEqual([
      'first failure: /api/health/ready answered HTTP 503',
    ]);
  });

  test('a wait the board did not explain misses', () => {
    const observation = held();
    observation.tasks[0] = {
      ...task(0, []),
      doneAtMs: null,
      longestWithoutRunMs: 61_000,
    };
    observation.tasks[1] = task(1, [
      run('run-1', { parkedWithoutReason: 2, longestPendingMs: 75_000 }),
    ]);
    const waits = check(observation, 'visible-waits');
    expect(waits.pass).toBe(false);
    expect(waits.details).toEqual([
      'Burst run 1: in progress for 61.0 s without a run',
      'Burst run 2, run run-1: parked with no reason in 2 polls',
      'Burst run 2, run run-1: queued for 75.0 s neither parked nor starting',
    ]);
  });

  test('a run that failed for room misses twice', () => {
    const observation = held();
    observation.tasks[1] = task(1, [
      run('run-1', {
        place: 'failed',
        failureCode: 'park_deadline',
        error: 'no sandbox became free',
      }),
    ]);
    const report = judgeBurst(observation);
    const capacity = report.checks.find((c) => c.key === 'capacity-failures');
    expect(capacity?.pass).toBe(false);
    expect(capacity?.details).toEqual([
      'Burst run 2, run run-1: park_deadline — no sandbox became free',
    ]);
    expect(report.checks.find((c) => c.key === 'runs-complete')?.pass).toBe(
      false,
    );
  });

  test('another failure is no capacity failure, but the burst did not complete', () => {
    const observation = held();
    observation.tasks[0] = task(0, [
      run('run-0', { place: 'failed', failureCode: 'harness_error' }),
      run('run-0b'),
    ]);
    expect(check(observation, 'capacity-failures').pass).toBe(true);
    const complete = check(observation, 'runs-complete');
    expect(complete.pass).toBe(false);
    expect(complete.figure).toBe('2 of 2 tasks settled; 1 failed runs');
  });

  test('a task never created, or still open at the deadline, misses', () => {
    const observation = held();
    observation.creations[1] = {
      index: 1,
      agentIndex: 1,
      atMs: 15_000,
      taskId: null,
      status: 500,
      code: 'INTERNAL_ERROR',
    };
    observation.tasks = [task(0, [run('run-0', { place: 'running' })])];
    const [first] = observation.tasks;
    if (first !== undefined) first.doneAtMs = null;
    observation.timedOut = true;
    const complete = check(observation, 'runs-complete');
    expect(complete.pass).toBe(false);
    expect(complete.details).toEqual([
      'task 2: not created (HTTP 500 INTERNAL_ERROR)',
      'Burst run 1: not finished at the end (running)',
    ]);
    expect(complete.figure).toContain('the deadline passed');
  });
});

describe('renderBurstMarkdown', () => {
  test('leads with the verdict and a row per expectation', () => {
    const markdown = renderBurstMarkdown(judgeBurst(held()));
    expect(markdown).toStartWith(
      '# Agent-run burst: 2 runs across 2 agents in 30 s — PASSED',
    );
    expect(markdown).toContain(
      '| No host-wide OOM kill | 0 host-wide, 1 inside session cgroups (vmstat oom_kill +1) | held |',
    );
    expect(markdown).toContain(
      `| Burst run 2 | 2 | +15.0 s | 1 | host (40.0 s) | settled at +115.0 s | ${ANSWER} |`,
    );
    expect(markdown).toContain(
      `- Each run's turn holds 2048 MiB and keeps a CPU busy for 60 s; the mock provider counts its hogs at ${MOCK_METRICS}`,
    );
    expect(markdown).toContain('- 65 answers: 40 admit, holds memory ×25');
    expect(markdown).toContain('## Kernel OOM kills during the burst');
  });

  test('names what missed', () => {
    const observation = held();
    observation.health.p95Ms = 2_400;
    observation.health.failures = 3;
    observation.health.firstFailure = 'it | broke';
    const markdown = renderBurstMarkdown(judgeBurst(observation));
    expect(markdown).toContain('— FAILED');
    expect(markdown).toContain('1 of 8 expectations missed.');
    expect(markdown).toContain(
      '| `/api/health/ready` p95 under 1 s | p95 2400 ms (p50 3, p99 40, max 310); 3 of 520 probes failed | **missed** |',
    );
    expect(markdown).toContain('first failure: it | broke');
  });

  test("shows the start of each run's answer on one line", () => {
    const observation = held();
    const long = `line one\nline | two ${'x'.repeat(200)}`;
    observation.tasks = [
      task(0, [run('run-0', { resultText: long })]),
      task(1, [run('run-1', { resultText: null })]),
    ];
    const markdown = renderBurstMarkdown(judgeBurst(observation));
    const flat = long.replace(/\s+/g, ' ');
    expect(markdown).toContain(
      `| ${flat.slice(0, 120).replace('|', '\\|')}… |`,
    );
    expect(markdown).not.toContain('x'.repeat(150));
    expect(markdown).toContain('| settled at +115.0 s | – |');
  });
});
