/**
 * The burst against a stand-in platform and spawner: the owner's setup, the
 * tasks it hands the agents on schedule, the runs it follows to their end,
 * and the verdict the host's figures give.
 */

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type BurstOptions,
  BurstSetupError,
  type HostProbes,
  runBurst,
} from '../../src/burst/driver.ts';
import type { BurstReport } from '../../src/burst/report.ts';
import {
  NONCE_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signSpawnerRequest,
} from '../../src/burst/spawner.ts';
import { MockMetrics, renderPrometheus } from '../../src/mock/metrics.ts';
import { type TestServer, startServer } from '../client/test-server.ts';
import {
  type FakePlatform,
  fakePlan,
  startFakePlatform,
} from '../scenario/fake-platform.ts';

setDefaultTimeout(20_000);

const GIB = 1024 ** 3;
const SPAWNER_TOKEN = 'burst-test-token';

/** One run as a poll of its task shows it; the times are filled in. */
interface RowSpec {
  id: string;
  status: 'queued' | 'running' | 'settled' | 'failed';
  /** Parked with this reason; null: parked without one. */
  parked?: string | null;
  claimed?: boolean;
  failureCode?: string;
  error?: string;
  /** What it answered at its end. */
  answer?: string;
}

/** Each task's polls, in order; the last one repeats. */
type Frames = Record<string, RowSpec[][]>;

interface Seen {
  quota: { orgId: string | null; body: unknown }[];
  agents: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function meminfo(availableGiB: number): string {
  return [
    `MemTotal:       ${16 * 1024 * 1024} kB`,
    'MemFree:         1048576 kB',
    `MemAvailable:   ${availableGiB * 1024 * 1024} kB`,
    '',
  ].join('\n');
}

/** The admission answer of a 16 GiB host, as the spawner sends it. */
function admission(verdict: 'admit' | 'hold'): Record<string, unknown> {
  return {
    verdict,
    reason: verdict === 'hold' ? 'memory' : null,
    retryAfterMs: verdict === 'hold' ? 5_000 : null,
    preset: 'default',
    observedAtMs: Date.now(),
    evidence: {
      pressure: null,
      memory: {
        availableBytes: 7 * GIB,
        reserveBytes: 1_717_986_918,
        totalBytes: 16 * GIB,
      },
      disk: null,
      sessions: { running: 2, starting: 1, limit: 25 },
      leases: { active: 0, max: 2 },
    },
  };
}

let platform: FakePlatform | null = null;
let spawner: TestServer | null = null;
let mock: TestServer | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await platform?.close();
  await spawner?.close();
  await mock?.close();
  platform = null;
  spawner = null;
  mock = null;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

/**
 * Answer the doors the burst uses: the sandbox limits, the quota, the
 * agents (the first one exists already), the tasks and their runs.
 */
function serveBurst(
  fake: FakePlatform,
  frames: Frames,
  options: {
    limits?: unknown;
    /** Tasks whose failed run the platform will retry. */
    retried?: ReadonlySet<string>;
    onTaskCreated?: (count: number) => void;
  } = {},
): Seen {
  const seen: Seen = { quota: [], agents: [], tasks: [] };
  const polls = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const once = (key: string): number => {
    const at = firstSeen.get(key) ?? Date.now();
    firstSeen.set(key, at);
    return at;
  };
  const rowOf = (spec: RowSpec): Record<string, unknown> => {
    const launched = spec.status === 'running' || spec.status === 'settled';
    const ended = spec.status === 'settled' || spec.status === 'failed';
    return {
      id: spec.id,
      status: spec.status,
      agentId: null,
      sessionId: null,
      trigger: 'assignment',
      failureCode: spec.failureCode ?? null,
      error: spec.error ?? null,
      resultText: spec.answer ?? null,
      waitingForCapacityAt:
        spec.parked === undefined ? null : once(`${spec.id} parked`),
      waitingReason: spec.parked ?? null,
      sessionClaimedAt:
        spec.claimed === true || launched ? once(`${spec.id} claimed`) : null,
      startedAt: once(`${spec.id} started`),
      launchedAt: launched ? once(`${spec.id} launched`) : null,
      settledAt: ended ? once(`${spec.id} ended`) : null,
      worker: 1,
    };
  };
  fake.overrides.push((request, response) => {
    const route = `${request.method} ${request.path}`;
    if (route === 'GET /api/app/sandbox/limits') {
      json(
        response,
        200,
        options.limits ?? {
          status: 'available',
          maxSessions: 25,
          deviceSessions: 0,
        },
      );
      return true;
    }
    if (route === 'POST /api/app/governance/policies/sandbox_quota') {
      seen.quota.push({
        orgId: request.query.get('orgId'),
        body: JSON.parse(request.body),
      });
      json(response, 200, { ok: true });
      return true;
    }
    if (route === 'POST /api/app/projects/project-0/agents') {
      const body = JSON.parse(request.body) as Record<string, unknown>;
      seen.agents.push(body);
      if (body.name === 'Burst agent 1') {
        json(response, 409, {
          error: 'An agent with this name already exists',
          code: 'CONFLICT',
        });
      } else {
        json(response, 200, { agentId: `agent-${seen.agents.length}` });
      }
      return true;
    }
    if (route === 'GET /api/app/projects/project-0/agents') {
      json(response, 200, {
        agents: [{ id: 'agent-kept', name: 'Burst agent 1' }],
      });
      return true;
    }
    if (route === 'POST /api/app/tasks') {
      seen.tasks.push(JSON.parse(request.body) as Record<string, unknown>);
      options.onTaskCreated?.(seen.tasks.length);
      json(response, 200, { taskId: `task-${seen.tasks.length}` });
      return true;
    }
    const runs = /^\/api\/app\/tasks\/([^/]+)\/agent-runs(\/latest)?$/.exec(
      request.path,
    );
    if (runs === null || request.method !== 'GET') return false;
    const taskId = decodeURIComponent(runs[1] ?? '');
    if (runs[2] !== undefined) {
      json(response, 200, {
        run: options.retried?.has(taskId)
          ? { status: 'failed', retryPending: true }
          : { status: 'failed' },
      });
      return true;
    }
    const script = frames[taskId] ?? [[]];
    const poll = polls.get(taskId) ?? 0;
    polls.set(taskId, poll + 1);
    const frame = script[Math.min(poll, script.length - 1)] ?? [];
    json(response, 200, { runs: frame.map(rowOf) });
    return true;
  });
  return seen;
}

/** A spawner that checks each signature and holds once for memory. */
async function startSpawner(): Promise<{
  server: TestServer;
  signed: boolean[];
}> {
  const signed: boolean[] = [];
  const server = await startServer((request, response) => {
    const header = (name: string): string =>
      String(request.headers[name] ?? '');
    const valid =
      header(SIGNATURE_HEADER) ===
      signSpawnerRequest({
        method: request.method,
        path: request.url,
        timestamp: header(TIMESTAMP_HEADER),
        nonce: header(NONCE_HEADER),
        body: request.body,
        token: SPAWNER_TOKEN,
      });
    signed.push(valid);
    if (!valid) {
      json(response, 401, { error: 'invalid signature' });
      return;
    }
    json(response, 200, admission(signed.length === 1 ? 'hold' : 'admit'));
  });
  return { server, signed };
}

/** The mock provider's metrics door, answering what `metrics` counted. */
async function startMockMetrics(
  answer: (metrics: MockMetrics, read: number) => string = (metrics) =>
    renderPrometheus(metrics.snapshot()),
): Promise<{ server: TestServer; metrics: MockMetrics; url: string }> {
  const metrics = new MockMetrics();
  let reads = 0;
  const server = await startServer((request, response) => {
    reads += 1;
    response.setHeader('content-type', 'text/plain; version=0.0.4');
    response.end(answer(metrics, reads));
  });
  return { server, metrics, url: `${server.url}/metrics` };
}

interface Host {
  probes: HostProbes;
  files: {
    meminfo: string;
    vmstat: string;
    apiLog: string;
    workerLog: string;
  };
  /** What the kernel log holds when the burst reads it. */
  kernel: { text: string };
}

/** A 4 CPU, 16 GiB host that booted 1000 s ago, with an OOM kill before. */
async function startHost(): Promise<Host> {
  const dir = await mkdtemp(join(tmpdir(), 'tale-load-burst-host-'));
  dirs.push(dir);
  const files = {
    meminfo: join(dir, 'meminfo'),
    vmstat: join(dir, 'vmstat'),
    apiLog: join(dir, 'api-0.log'),
    workerLog: join(dir, 'worker-0.log'),
  };
  await writeFile(files.meminfo, meminfo(8));
  await writeFile(files.vmstat, 'pgfault 1000\noom_kill 7\n');
  await writeFile(join(dir, 'uptime'), '1000.00 3000.00\n');
  // A timeout logged before the burst is not the burst's.
  await writeFile(
    files.apiLog,
    'boot: timeout exceeded when trying to connect\n',
  );
  await writeFile(files.workerLog, '');
  const kernel = {
    text: '[  900.000000] Out of memory: Killed process 1 (before)\n',
  };
  return {
    files,
    kernel,
    probes: {
      meminfo: files.meminfo,
      vmstat: files.vmstat,
      uptime: join(dir, 'uptime'),
      readKernelLog: () => Promise.resolve({ ok: true, text: kernel.text }),
      cpus: 4,
      totalMemoryBytes: 16 * GIB,
    },
  };
}

function burstOptions(
  fake: FakePlatform,
  host: Host,
  overrides: Partial<BurstOptions> = {},
): BurstOptions {
  return {
    plan: fakePlan(fake.url),
    target: fake.url,
    spawnerUrl: null,
    spawnerToken: null,
    harness: 'claude-code',
    agents: 2,
    runs: 3,
    windowSeconds: 0.06,
    hogMib: 64,
    hogSeconds: 1,
    projectSessions: null,
    pendingGraceSeconds: 60,
    deadlineSeconds: 10,
    logFiles: [host.files.apiLog, host.files.workerLog],
    mockMetricsUrl: null,
    intervals: {
      pollMs: 20,
      memoryMs: 5,
      admissionMs: 10,
      healthMs: 10,
      healthTimeoutMs: 1_000,
    },
    probes: host.probes,
    log: () => undefined,
    ...overrides,
  };
}

function results(report: BurstReport): Record<string, boolean> {
  return Object.fromEntries(report.checks.map((c) => [c.key, c.pass]));
}

describe('runBurst', () => {
  test('sets the project up, follows every run and finds the host held', async () => {
    platform = await startFakePlatform();
    const host = await startHost();
    const fakeSpawner = await startSpawner();
    spawner = fakeSpawner.server;
    const fakeMock = await startMockMetrics();
    mock = fakeMock.server;
    // Turns before the burst: their hogs are not the burst's.
    fakeMock.metrics.recordHogCall();
    fakeMock.metrics.recordHogCall();
    fakeMock.metrics.recordHogResult();
    const seen = serveBurst(
      platform,
      {
        // Waits for the host, then runs.
        'task-1': [
          [],
          [{ id: 'run-1', status: 'queued' }],
          [{ id: 'run-1', status: 'queued', parked: 'host' }],
          [{ id: 'run-1', status: 'queued', parked: 'host' }],
          [{ id: 'run-1', status: 'running' }],
          [{ id: 'run-1', status: 'settled' }],
        ],
        'task-2': [
          [{ id: 'run-2', status: 'queued', claimed: true }],
          [{ id: 'run-2', status: 'running' }],
          [{ id: 'run-2', status: 'settled', answer: 'Held and spun.' }],
        ],
        'task-3': [
          [{ id: 'run-3', status: 'running' }],
          [{ id: 'run-3', status: 'settled' }],
        ],
      },
      {
        onTaskCreated: (count) => {
          // Each run's turn runs its hog to the end.
          fakeMock.metrics.recordHogCall();
          fakeMock.metrics.recordHogResult();
          if (count !== 1) return;
          // The turns take memory, and the kernel kills one inside its
          // session's cgroup.
          writeFileSync(host.files.meminfo, meminfo(6));
          writeFileSync(host.files.vmstat, 'pgfault 1200\noom_kill 8\n');
          host.kernel.text +=
            '[ 1010.000000] Memory cgroup out of memory: Killed process 4242 (python3)\n';
        },
      },
    );
    const lines: string[] = [];
    const report = await runBurst(
      burstOptions(platform, host, {
        spawnerUrl: spawner.url,
        spawnerToken: SPAWNER_TOKEN,
        mockMetricsUrl: fakeMock.url,
        log: (line) => lines.push(line),
      }),
    );

    expect(results(report)).toEqual({
      'load-applied': true,
      'host-oom': true,
      'memory-reserve': true,
      'pool-timeouts': true,
      'health-p95': true,
      'visible-waits': true,
      'capacity-failures': true,
      'runs-complete': true,
    });
    expect(report.pass).toBe(true);
    expect(lines[0]).toBe(
      "[burst] 2 agents ready; the project may hold 22 of the deployment's 25 sessions",
    );

    // Setup: the budget, then the agents (the first one found by name).
    expect(seen.quota).toEqual([
      {
        orgId: 'org-0',
        body: {
          config: {
            maxSessionsPerOrg: 22,
            maxWorkflowSessionsPerOrg: 1,
            maxRenderSessionsPerOrg: 1,
            maxLightSessionsPerOrg: 1,
          },
        },
      },
    ]);
    expect(seen.agents[1]).toEqual({
      name: 'Burst agent 2',
      harness: 'claude-code',
      model: 'load-chat-fast',
      modelProvider: 'loadmock',
      skills: [],
      connectors: [],
    });

    // Each task is created in progress for its agent, on schedule.
    expect(seen.tasks.map((t) => t.assigneeId)).toEqual([
      'agent-kept',
      'agent-2',
      'agent-kept',
    ]);
    expect(seen.tasks[0]).toMatchObject({
      projectId: 'project-0',
      title: 'Burst run 1',
      status: 'in_progress',
      assigneeType: 'agent',
    });
    expect(String(seen.tasks[0]?.description)).toContain(
      '[[mock:hog=64]] [[mock:hog-seconds=1]]',
    );
    expect(report.creations.map((c) => c.taskId)).toEqual([
      'task-1',
      'task-2',
      'task-3',
    ]);
    // Task i is due at i × 20 ms: none went early, a clock tick aside.
    for (const creation of report.creations) {
      expect(creation.atMs).toBeGreaterThanOrEqual(creation.index * 20 - 2);
    }

    // The runs, as the board showed them.
    const [first] = report.tasks;
    expect(first?.runs.map((run) => [run.id, run.place, run.reasons])).toEqual([
      ['run-1', 'settled', ['host']],
    ]);
    expect(report.tasks.every((task) => task.doneAtMs !== null)).toBe(true);
    expect(report.timedOut).toBe(false);
    const answered = report.tasks.find((task) => task.taskId === 'task-2');
    expect(answered?.runs[0]?.resultText).toBe('Held and spun.');

    // The load the turns applied, as the mock counted it during the burst.
    expect(report.load).toEqual({
      url: fakeMock.url,
      error: null,
      calls: 3,
      results: 3,
    });
    expect(mock.requests.map((request) => request.url)).toEqual([
      '/metrics',
      '/metrics',
    ]);

    // What the host went through.
    expect(report.memory.totalBytes).toBe(16 * GIB);
    expect(report.memory.minAvailableBytes).toBe(6 * GIB);
    expect(report.admission).toMatchObject({
      errors: 0,
      holds: { memory: 1 },
      reserveBytes: 1_717_986_918,
      limit: 25,
    });
    expect(report.admission?.admits).toBeGreaterThan(0);
    expect(fakeSpawner.signed.every(Boolean)).toBe(true);
    expect(spawner.requests[0]?.url).toBe(
      '/v1/admission?organizationId=org-0&kind=start',
    );
    expect(report.oom.vmstatBefore).toBe(7);
    expect(report.oom.vmstatAfter).toBe(8);
    expect(report.oom.kills.map((kill) => [kill.scope, kill.pid])).toEqual([
      ['cgroup', 4242],
    ]);
    expect(report.logs?.map((scan) => Object.values(scan.counts))).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(report.health.probes).toBeGreaterThan(0);
    expect(report.health.failures).toBe(0);
  });

  test('names each expectation the host missed', async () => {
    platform = await startFakePlatform();
    const host = await startHost();
    const fakeSpawner = await startSpawner();
    spawner = fakeSpawner.server;
    const fakeMock = await startMockMetrics();
    mock = fakeMock.server;
    serveBurst(
      platform,
      {
        'task-1': [
          [{ id: 'run-1', status: 'running' }],
          [{ id: 'run-1', status: 'settled' }],
        ],
        // Parked without a reason, then given up for want of room.
        'task-2': [
          [{ id: 'run-2', status: 'queued', parked: null }],
          [
            {
              id: 'run-2',
              status: 'failed',
              parked: null,
              failureCode: 'park_deadline',
              error: 'no sandbox became free',
            },
          ],
        ],
        // Fails, and the platform's retry settles.
        'task-3': [
          [{ id: 'run-3', status: 'running' }],
          [{ id: 'run-3', status: 'failed', failureCode: 'harness_error' }],
          [
            { id: 'run-3b', status: 'queued' },
            { id: 'run-3', status: 'failed', failureCode: 'harness_error' },
          ],
          [
            { id: 'run-3b', status: 'settled' },
            { id: 'run-3', status: 'failed', failureCode: 'harness_error' },
          ],
        ],
      },
      {
        retried: new Set(['task-3']),
        onTaskCreated: (count) => {
          // Every turn is asked to run its hog; one runs it to the end.
          fakeMock.metrics.recordHogCall();
          if (count === 1) fakeMock.metrics.recordHogResult();
          if (count !== 1) return;
          appendFileSync(
            host.files.workerLog,
            '{"level":"error","msg":"timeout exceeded when trying to connect"}\n',
          );
          writeFileSync(host.files.vmstat, 'pgfault 1200\noom_kill 8\n');
          host.kernel.text +=
            '[ 1020.000000] Out of memory: Killed process 777 (node)\n';
        },
      },
    );
    const report = await runBurst(
      burstOptions(platform, host, {
        spawnerUrl: spawner.url,
        // Not the spawner's: every admission read is refused.
        spawnerToken: 'not-the-token',
        projectSessions: 5,
        mockMetricsUrl: fakeMock.url,
      }),
    );

    expect(results(report)).toEqual({
      'load-applied': false,
      'host-oom': false,
      'memory-reserve': true,
      'pool-timeouts': false,
      'health-p95': true,
      'visible-waits': false,
      'capacity-failures': false,
      'runs-complete': false,
    });
    expect(report.pass).toBe(false);
    expect(report.settings.projectSessions).toBe(5);
    expect(fakeSpawner.signed.some(Boolean)).toBe(false);
    expect(report.admission).toMatchObject({
      samples: 0,
      firstError: "the spawner's admission door: HTTP 401",
    });
    const check = (key: string) => report.checks.find((c) => c.key === key);
    // With no answer from the spawner, its default reserve is the bar.
    expect(check('memory-reserve')?.figure).toContain('(default)');
    expect(check('host-oom')?.details).toEqual([
      '[ 1020.000000] Out of memory: Killed process 777 (node)',
    ]);
    expect(check('pool-timeouts')?.figure).toBe('1 in 2 process logs');
    expect(check('load-applied')?.figure).toBe(
      '1 hogs ran to their end for 3 runs; 3 hog calls sent',
    );
    expect(check('capacity-failures')?.details).toEqual([
      'Burst run 2, run run-2: park_deadline — no sandbox became free',
    ]);
    expect(check('runs-complete')?.figure).toBe(
      '2 of 3 tasks settled; 2 failed runs',
    );
    const retried = report.tasks.find((task) => task.taskId === 'task-3');
    expect(retried?.runs.map((run) => [run.id, run.place])).toEqual([
      ['run-3', 'failed'],
      ['run-3b', 'settled'],
    ]);
    expect(retried?.doneAtMs).not.toBeNull();
  });

  test('stops at the deadline and says what had not finished', async () => {
    platform = await startFakePlatform();
    const host = await startHost();
    serveBurst(platform, {
      'task-1': [[{ id: 'run-1', status: 'running' }]],
    });
    const report = await runBurst(
      burstOptions(platform, host, {
        agents: 1,
        runs: 1,
        deadlineSeconds: 0.2,
        logFiles: null,
      }),
    );
    expect(report.timedOut).toBe(true);
    expect(report.admission).toBeNull();
    const complete = report.checks.find((c) => c.key === 'runs-complete');
    expect(complete?.figure).toBe(
      '0 of 1 tasks settled; 0 failed runs; the deadline passed',
    );
    expect(complete?.details).toEqual([
      'Burst run 1: not finished at the end (running)',
    ]);
    expect(report.checks.find((c) => c.key === 'pool-timeouts')?.pass).toBe(
      false,
    );
    expect(report.load).toEqual({
      url: null,
      error: null,
      calls: null,
      results: null,
    });
    expect(report.checks.find((c) => c.key === 'load-applied')?.pass).toBe(
      false,
    );
  });

  test.each([
    [
      'a metrics door that counts no hogs',
      () => '# HELP other_total Not the mock.\nother_total 3\n',
      (url: string) =>
        `${url} counts no hogs: it is not the load mock's metrics`,
    ],
    [
      'counts that went down',
      (metrics: MockMetrics, read: number) => {
        // The mock restarted between the reads, and its counts with it.
        if (read > 1) return renderPrometheus(metrics.snapshot());
        const before = new MockMetrics();
        before.recordHogCall();
        before.recordHogResult();
        return renderPrometheus(before.snapshot());
      },
      (url: string) =>
        `the hog counts at ${url} went down: the mock restarted during the burst`,
    ],
  ] as const)('does not trust %s', async (_name, answer, error) => {
    platform = await startFakePlatform();
    const host = await startHost();
    const fakeMock = await startMockMetrics(answer);
    mock = fakeMock.server;
    serveBurst(platform, {
      'task-1': [[{ id: 'run-1', status: 'settled' }]],
    });
    const report = await runBurst(
      burstOptions(platform, host, {
        agents: 1,
        runs: 1,
        mockMetricsUrl: fakeMock.url,
      }),
    );
    expect(report.load).toEqual({
      url: fakeMock.url,
      error: error(fakeMock.url),
      calls: null,
      results: null,
    });
    expect(results(report)['load-applied']).toBe(false);
  });

  test('refuses a deployment without sandboxes before creating a task', async () => {
    platform = await startFakePlatform();
    const host = await startHost();
    serveBurst(
      platform,
      {},
      { limits: { status: 'unavailable', reason: 'no_spawner' } },
    );
    const burst = runBurst(burstOptions(platform, host));
    await expect(burst).rejects.toBeInstanceOf(BurstSetupError);
    await expect(burst).rejects.toThrow(
      'the deployment has no sandbox to start runs in: no_spawner',
    );
    expect(
      platform.requests.some((request) => request.path === '/api/app/tasks'),
    ).toBe(false);
  });
});
