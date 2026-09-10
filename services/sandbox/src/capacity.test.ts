import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { K8sClient } from './backend/kubernetes/k8s-client.ts';
import {
  CapacityReader,
  parseCpuCounters,
  parseMemory,
  usedCpuCores,
} from './capacity.ts';
import { loadConfig } from './config.ts';
import type { RunDockerResult } from './spawn-util.ts';

const oldToken = process.env.SANDBOX_TOKEN;
const oldHost = process.env.DOCKER_HOST;
const oldContext = process.env.DOCKER_CONTEXT;
afterEach(() => {
  if (oldToken === undefined) delete process.env.SANDBOX_TOKEN;
  else process.env.SANDBOX_TOKEN = oldToken;
  if (oldHost === undefined) delete process.env.DOCKER_HOST;
  else process.env.DOCKER_HOST = oldHost;
  if (oldContext === undefined) delete process.env.DOCKER_CONTEXT;
  else process.env.DOCKER_CONTEXT = oldContext;
});

function config() {
  process.env.SANDBOX_TOKEN = 'capacity-test-only';
  delete process.env.DOCKER_HOST;
  delete process.env.DOCKER_CONTEXT;
  return { ...loadConfig(), backend: 'docker' as const };
}

function ok(stdout: string): RunDockerResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

const inventory = [
  { sessionId: 'a-live', organizationId: 'a', state: 'running' },
  { sessionId: 'b-live', organizationId: 'b', state: 'running' },
  { sessionId: 'a-cold', organizationId: 'a', state: 'created' },
  { sessionId: 'a-old', organizationId: 'a', state: 'exited' },
]
  .map((row) => JSON.stringify(row))
  .join('\n');

function dockerStub() {
  return mock(async (args: string[]) => {
    if (args[0] === 'ps') return ok(inventory);
    if (args[0] === 'info')
      return ok(
        JSON.stringify({ cpus: 2, memory: 1024_000, kernel: 'test-kernel' }),
      );
    if (args[0] === 'context') return ok('"unix:///var/run/docker.sock"');
    throw new Error(`unexpected command ${args[0]}`);
  });
}

function pod(sessionId: string, organizationId: string, phase: string) {
  return {
    metadata: {
      annotations: {
        'tale.dev/session-id': sessionId,
        'tale.dev/organization-id': organizationId,
      },
    },
    status: { phase },
  };
}

function kubernetesReader(
  response: unknown,
  creating: ReadonlyMap<string, string> = new Map(),
) {
  const listNamespacedPod = mock(async () => response);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the namespaced inventory seam is exercised
  const client = { core: { listNamespacedPod } } as unknown as K8sClient;
  return new CapacityReader(
    { ...config(), backend: 'kubernetes' },
    () => creating,
    { client },
  );
}

describe('infrastructure capacity observations', () => {
  test('counts real containers and pending creates once, without leaking other org ids', async () => {
    const creating = new Map([
      ['a-cold', 'a'],
      ['a-pulling', 'a'],
    ]);
    const docker = dockerStub();
    const reader = new CapacityReader(config(), () => creating, {
      docker,
      read: async () => {
        throw new Error('proc unavailable');
      },
      kernelRelease: () => 'test-kernel',
    });
    const [a, b] = await Promise.all([
      reader.forOrganization('a'),
      reader.forOrganization('b'),
    ]);
    expect(a.sessions).toMatchObject({
      running: 2,
      starting: 2,
      organizationRunning: 1,
      organizationStarting: 2,
      limit: 8,
      organizationLimit: 8,
    });
    expect(a.runtimeSessions).toContainEqual({
      sessionId: 'a-old',
      state: 'stopped',
    });
    expect(JSON.stringify(a)).not.toContain('b-live');
    expect(b.runtimeSessions).toEqual([
      { sessionId: 'b-live', state: 'running' },
    ]);
    expect(b.sessions.organizationStarting).toBe(0);
    expect(docker.mock.calls.filter(([args]) => args[0] === 'ps')).toHaveLength(
      1,
    );
  });

  test('inventory failures and truncated inventories do not become empty capacity', async () => {
    for (const result of [
      { ...ok(''), exitCode: 1 },
      { ...ok(inventory), stdoutTruncated: true },
      ok('{invalid'),
    ]) {
      const reader = new CapacityReader(config(), () => new Map(), {
        docker: async () => result,
      });
      expect(reader.forOrganization('a')).rejects.toThrow();
    }
  });

  test('broken Docker ownership labels keep occupied slots without exposing untrusted ids', async () => {
    const rows = [
      { sessionId: 'healthy', organizationId: 'a', state: 'running' },
      { sessionId: 'bad/id', organizationId: 'a', state: 'created' },
      { sessionId: '', organizationId: 'a', state: 'running' },
      { sessionId: 'unowned', organizationId: '', state: 'running' },
      { sessionId: '', organizationId: '', state: 'running' },
      { sessionId: 'foreign', organizationId: 'b', state: 'running' },
    ];
    const reader = new CapacityReader(config(), () => new Map(), {
      docker: async (args) =>
        args[0] === 'ps'
          ? ok(rows.map((row) => JSON.stringify(row)).join('\n'))
          : ok('{}'),
    });
    const result = await reader.forOrganization('a');
    expect(result.sessions).toMatchObject({
      running: 5,
      starting: 1,
      organizationRunning: 2,
      organizationStarting: 1,
    });
    expect(result.runtimeSessions).toEqual([
      { sessionId: 'healthy', state: 'running' },
    ]);
  });

  test('unrecognized Docker states conservatively retain occupied slots', async () => {
    const reader = new CapacityReader(config(), () => new Map(), {
      docker: async (args) =>
        args[0] === 'ps'
          ? ok(
              JSON.stringify({
                sessionId: 'uncertain',
                organizationId: 'a',
                state: 'unknown',
              }),
            )
          : ok('{}'),
    });
    const result = await reader.forOrganization('a');
    expect(result.sessions.running).toBe(1);
    expect(result.sessions.organizationRunning).toBe(1);
    expect(result.runtimeSessions).toEqual([
      { sessionId: 'uncertain', state: 'running' },
    ]);
  });

  test('keeps measured totals if local usage is unavailable; no fake zero', async () => {
    const reader = new CapacityReader(config(), () => new Map(), {
      docker: dockerStub(),
      kernelRelease: () => 'other-machine',
    });
    expect((await reader.forOrganization('a')).resources).toEqual({
      cpu: { totalCores: 2, usedCores: null },
      memory: { totalBytes: 1024_000, usedBytes: null },
    });
  });

  test('an expired successful snapshot does not hide a later inventory failure', async () => {
    let now = 1000;
    let failed = false;
    const reader = new CapacityReader(config(), () => new Map(), {
      now: () => now,
      docker: async (args) =>
        args[0] === 'ps'
          ? { ...ok(inventory), exitCode: failed ? 1 : 0 }
          : ok('{}'),
    });
    expect((await reader.forOrganization('a')).sessions.running).toBe(2);
    now += 6000;
    failed = true;
    expect(reader.forOrganization('a')).rejects.toThrow();
  });

  test('samples host CPU deltas and available memory, not configured container allocations', async () => {
    let now = 10_000;
    let busy = 100;
    const reader = new CapacityReader(config(), () => new Map(), {
      docker: dockerStub(),
      now: () => now,
      kernelRelease: () => 'test-kernel',
      read: async (path) =>
        path === '/proc/stat'
          ? `cpu ${busy} 0 0 100 0 0 0 0 50 0\ncpu0 1 0 0 1\ncpu1 1 0 0 1\n`
          : 'MemTotal: 1000 kB\nMemAvailable: 400 kB\nMemFree: 10 kB\n',
    });
    const first = await reader.forOrganization('a');
    expect(first.resources.cpu.usedCores).toBeNull();
    expect(first.resources.memory.usedBytes).toBe(600 * 1024);
    now += 6_000;
    busy = 200;
    const next = await reader.forOrganization('a');
    expect(next.resources.cpu.usedCores).toBe(2);
    expect(next.observedAt).toBe(now);
    now += 3_600_000;
    busy += 100;
    expect(
      (await reader.forOrganization('a')).resources.cpu.usedCores,
    ).toBeNull();
    now += 15_000;
    busy += 100;
    expect((await reader.forOrganization('a')).resources.cpu.usedCores).toBe(2);
  });

  test('a remote Docker host never borrows the spawner machine usage', async () => {
    const cfg = config();
    process.env.DOCKER_HOST = 'tcp://remote-daemon:2376';
    const read = mock(async () => '');
    const reader = new CapacityReader(cfg, () => new Map(), {
      docker: dockerStub(),
      kernelRelease: () => 'test-kernel',
      read,
    });
    expect(
      (await reader.forOrganization('a')).resources.cpu.usedCores,
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  test('namespace inventory includes pending Pods and does not pretend to measure cluster nodes', async () => {
    const cfg = { ...config(), backend: 'kubernetes' as const };
    const listNamespacedPod = mock(async () => ({
      items: [
        {
          metadata: {
            annotations: {
              'tale.dev/session-id': 'pending',
              'tale.dev/organization-id': 'a',
            },
          },
          status: { phase: 'Pending' },
        },
        {
          metadata: {
            annotations: {
              'tale.dev/session-id': 'live',
              'tale.dev/organization-id': 'b',
            },
          },
          status: { phase: 'Running' },
        },
      ],
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the namespaced inventory seam is exercised
    const client = { core: { listNamespacedPod } } as unknown as K8sClient;
    const reader = new CapacityReader(cfg, () => new Map(), { client });
    const result = await reader.forOrganization('a');
    expect(result.scope).toBe('namespace');
    expect(result.sessions).toMatchObject({
      running: 1,
      starting: 1,
      organizationRunning: 0,
      organizationStarting: 1,
    });
    expect(result.resources.cpu.totalCores).toBeNull();
    expect(listNamespacedPod.mock.calls).toHaveLength(1);
  });

  test('unknown Pod phases count as occupied without poisoning healthy neighbors', async () => {
    const reader = kubernetesReader({
      items: [
        pod('healthy', 'a', 'Running'),
        pod('unreachable', 'a', 'Unknown'),
        pod('future', 'a', 'UnrecognizedPhase'),
        pod('pending', 'a', 'Pending'),
        pod('done', 'a', 'Succeeded'),
        pod('failed', 'a', 'Failed'),
        pod('foreign', 'b', 'Unknown'),
      ],
    });
    const result = await reader.forOrganization('a');
    expect(result.sessions).toMatchObject({
      running: 4,
      starting: 1,
      organizationRunning: 3,
      organizationStarting: 1,
    });
    expect(result.runtimeSessions).toContainEqual({
      sessionId: 'unreachable',
      state: 'running',
    });
    expect(result.runtimeSessions).toContainEqual({
      sessionId: 'done',
      state: 'stopped',
    });
    expect(JSON.stringify(result)).not.toContain('foreign');
  });

  test('malformed Pod identities retain aggregate occupancy and only valid org ownership', async () => {
    const reader = kubernetesReader({
      items: [
        pod('healthy', 'a', 'Running'),
        pod('bad/id', 'a', 'Unknown'),
        pod('', 'a', 'Pending'),
        pod('unowned', 'invalid/org', 'Running'),
        pod('foreign', 'b', 'Running'),
        { status: { phase: 'Running' } },
        { status: { phase: 'Unknown' } },
      ],
    });
    const result = await reader.forOrganization('a');
    expect(result.sessions).toMatchObject({
      running: 6,
      starting: 1,
      organizationRunning: 2,
      organizationStarting: 1,
    });
    expect(result.runtimeSessions).toEqual([
      { sessionId: 'healthy', state: 'running' },
    ]);
  });

  test('pending-create deduplication includes organization ownership', async () => {
    const reader = kubernetesReader(
      {
        items: [
          pod('same-id', 'b', 'Running'),
          pod('starting-id', 'a', 'Pending'),
        ],
      },
      new Map([
        ['same-id', 'a'],
        ['starting-id', 'a'],
      ]),
    );
    const result = await reader.forOrganization('a');
    expect(result.sessions).toMatchObject({
      running: 1,
      starting: 2,
      organizationRunning: 0,
      organizationStarting: 2,
    });
    expect(result.runtimeSessions).toHaveLength(2);
  });

  test('partial and malformed Pod lists never report complete capacity', async () => {
    for (const response of [
      { metadata: { _continue: 'next-page' }, items: [] },
      { metadata: { remainingItemCount: 1 }, items: [] },
      {},
      { items: 'invalid-list' },
    ]) {
      expect(kubernetesReader(response).forOrganization('a')).rejects.toThrow();
    }
  });
});

test('CPU counter parsing ignores already-accounted guest time and handles resets', () => {
  const parsed = parseCpuCounters(
    'cpu 10 10 10 70 10 0 0 0 100 100\ncpu0 1 1 1 1\n',
  );
  expect(parsed).toEqual({ total: 110, idle: 80, cores: 1 });
  expect(usedCpuCores({ total: 120, idle: 90, cores: 1 }, parsed!)).toBeNull();
  expect(parseCpuCounters('cpu broken')).toBeNull();
});

test('memory pressure uses MemAvailable, including genuinely zero available bytes', () => {
  expect(parseMemory('MemTotal: 1000 kB\nMemAvailable: 0 kB\n')).toEqual({
    totalBytes: 1024_000,
    usedBytes: 1024_000,
  });
  expect(parseMemory('MemTotal: 1000 kB\nMemFree: 0 kB\n')).toBeNull();
  expect(parseMemory('MemTotal: 1000 kB\nMemAvailable: 2000 kB\n')).toBeNull();
});
