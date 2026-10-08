import { describe, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';

import {
  bootNativeHostAdmission,
  readNativeAdmissionInventory,
  requireNativeAdmissionConfig,
} from './host-admission-native.ts';
import { TEST_SESSION_CONFIG } from './session/session-test-config.ts';
import type { RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

const self = 'a'.repeat(64);
const record = 'b'.repeat(64);
const peer = 'c'.repeat(64);
const identity = {
  daemonId: 'daemon',
  hostBootId: 'boot',
  containerId: self,
  imageId: `sha256:${'d'.repeat(64)}`,
  startedAt: '2026-10-08T00:00:00Z',
  generation: 'generation',
  recordId: record,
};
const cfg = {
  backend: 'docker' as const,
  runtimeTier: 'runc' as const,
  dockerInContainer: false,
  dockerBuildCache: false,
  dockerWorkloads: [] as ('project' | 'workflow')[],
  hub: null,
  deviceConfigPath: null,
  instance: '',
};
function projection(id: string, running = false) {
  return {
    id,
    name: `/object-${id.slice(0, 5)}`,
    running,
    status: running ? 'running' : 'created',
    privileged: false,
    pidMode: '',
    labels: {} as Record<string, string>,
    mounts: [] as { Type: string; Source: string; Destination: string }[],
  };
}
function fixture() {
  const calls: string[][] = [];
  const state = {
    rows: [projection(self, true), projection(record), projection(peer, true)],
    truncate: false,
    listed: 0,
    changeOnFinal: false,
    elapsed: 0,
  };
  const run = (args: string[], timeoutMs: number): Promise<RunDockerResult> => {
    calls.push(args);
    expect(timeoutMs).toBeLessThanOrEqual(5000);
    let stdout: string;
    if (args[0] === 'ps') {
      state.listed++;
      stdout = state.rows
        .map((row) => row.id)
        .filter(
          (id) => !(state.changeOnFinal && state.listed > 1 && id === peer),
        )
        .join('\n');
    } else
      stdout = args
        .slice(3)
        .map((id) => JSON.stringify(state.rows.find((row) => row.id === id)))
        .join('\n');
    return Promise.resolve({
      stdout,
      stderr: '',
      exitCode: 0,
      stdoutTruncated: state.truncate,
      stderrTruncated: false,
    });
  };
  const read = () =>
    readNativeAdmissionInventory(
      identity,
      () => Promise.resolve(),
      run,
      () => state.elapsed,
    );
  return { state, calls, read };
}

describe('native admission topology boundary', () => {
  test('disabled boot returns before reading even a configuration getter', async () => {
    const complete: SpawnerConfig = {
      ...cfg,
      port: 8003,
      sandboxToken: 'fixture',
      runtimeImage: 'fixture',
      buildkitdImage: 'fixture',
      buildkitdMirrorImage: 'fixture',
      transparentEgress: false,
      maxTimeoutMs: 1000,
      hostSessionRoot: '/unused',
      cacheVolumePrefix: { pip: 'p', npm: 'n', bun: 'b' },
      egressNetwork: 'fixture',
      egressProxy: 'http://unused',
      stdoutMaxBytes: 1000,
      stderrMaxBytes: 1000,
      maxRequestBodyBytes: 1000,
      k8s: {
        namespace: 'fixture',
        runtimeClassName: null,
        workspaceSizeLimit: '1Gi',
      },
      session: TEST_SESSION_CONFIG,
    };
    const config = new Proxy(complete, {
      get() {
        throw new Error('disabled path read config');
      },
    });
    // Disabled is intentionally generic at runtime: no native capability is constructed.
    expect(await bootNativeHostAdmission(config)).toBeUndefined();
  });
  test('v1 accepts only explicit local runc without helper/remote writer capabilities', () => {
    expect(() => requireNativeAdmissionConfig(cfg)).not.toThrow();
    for (const changed of [
      { backend: 'kubernetes' as const },
      { runtimeTier: 'sysbox' as const },
      { dockerInContainer: true },
      { dockerBuildCache: true },
      { dockerWorkloads: undefined },
      { dockerWorkloads: ['project'] as const },
      { deviceConfigPath: '/device.json' },
      { instance: 'peer' },
    ])
      expect(() =>
        requireNativeAdmissionConfig({ ...cfg, ...changed }),
      ).toThrow();
  });
  test('complete inventory includes unrelated containers and uses no instance label filter', async () => {
    const { read, calls } = fixture();
    expect((await read()).map((row) => row.id)).toEqual([self, record, peer]);
    expect(calls.filter((args) => args[0] === 'ps')).toEqual([
      ['ps', '--all', '--no-trunc', '--format', '{{.ID}}'],
      ['ps', '--all', '--no-trunc', '--format', '{{.ID}}'],
    ]);
  });
  test.each([
    'socket',
    'socket-parent',
    'root',
    'privileged',
    'host-pid',
    'mode-off-spawner',
    'stopped-spawner',
    'buildkit',
    'dind',
  ] as const)('a %s peer prevents phase-capable admission', async (kind) => {
    const { state, read } = fixture();
    const row = state.rows[2];
    if (!row) throw new Error('Missing fixture peer');
    if (kind === 'socket')
      row.mounts.push({
        Type: 'bind',
        Source: '/run/docker.sock',
        Destination: '/var/run/docker.sock',
      });
    if (kind === 'socket-parent')
      row.mounts.push({
        Type: 'bind',
        Source: '/var/run',
        Destination: '/host-runtime',
      });
    if (kind === 'root')
      row.mounts.push({ Type: 'bind', Source: '/', Destination: '/host' });
    if (kind === 'privileged') row.privileged = true;
    if (kind === 'host-pid') row.pidMode = 'host';
    if (kind === 'stopped-spawner') {
      row.running = false;
      row.status = 'exited';
      row.labels['com.docker.compose.service'] = 'sandbox';
    }
    if (kind === 'mode-off-spawner')
      row.labels['com.docker.compose.service'] = 'sandbox';
    if (kind === 'buildkit') row.labels['tale.buildkitd'] = '1';
    if (kind === 'dind') row.labels['tale.docker'] = 'true';
    await rejects(read(), /unavailable/);
  });
  test('legacy session labels and foreign instances cannot masquerade as fully observed sessions', async () => {
    const { state, read } = fixture();
    const row = state.rows[2];
    if (!row) throw new Error('Missing fixture peer');
    row.labels['tale.session'] = 'legacy';
    await rejects(read(), /unavailable/);
    row.labels = {
      'tale.session': 'peer',
      'tale.sandbox-instance': 'device',
      'tale.docker': 'false',
      'tale.created': '1000',
      'tale.create-attempt': 'known',
    };
    await rejects(read(), /unavailable/);
  });
  test('truncated or changing daemon inventory is unknown, never an empty gone proof', async () => {
    const { state, read } = fixture();
    state.truncate = true;
    await rejects(read(), /unavailable/);
    state.truncate = false;
    state.listed = 0;
    state.changeOnFinal = true;
    await rejects(read(), /unavailable/);
  });
});
