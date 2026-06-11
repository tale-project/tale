// Regression gate for the SESSION container argv builder. Same discipline as
// docker-args.test.ts: deterministic argv, unsafe identifiers rejected, user
// code never in argv, the agent profile distinct from the one-shot caps.

import { describe, expect, test } from 'bun:test';

import type { SpawnerConfig } from '../types.ts';
import { buildDockerSessionRunArgs } from './docker-session-args.ts';
import { TEST_SESSION_CONFIG } from './session-test-config.ts';

const cfg: SpawnerConfig = {
  backend: 'docker',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtime: 'runc',
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: 'gvisor',
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '4Gi',
  },
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  maxConcurrent: 4,
  hostSessionRoot: '/var/lib/tale-sandbox/sessions',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 5_242_880,
  stderrMaxBytes: 5_242_880,
  outputFileMaxBytes: 52_428_800,
  outputTotalMaxBytes: 104_857_600,
  maxRequestBodyBytes: 262_144,
  session: TEST_SESSION_CONFIG,
};

const goodInput = {
  sessionId: 'ses-abc-123',
  organizationId: 'org_456',
  profile: 'agent' as const,
  workspaceHostDir: '/var/lib/tale-sandbox/sessions/ses-ses-abc-123',
  pipCacheVolume: 'pip-org_456',
  npmCacheVolume: 'npm-org_456',
  bunCacheVolume: 'bun-org_456',
  runnerdToken: 'a'.repeat(64),
  createdAtMs: 1_700_000_000_000,
};

describe('buildDockerSessionRunArgs', () => {
  test('agent profile: detached, daemon entrypoint, distinct label, no cpu ulimit', () => {
    const args = buildDockerSessionRunArgs(cfg, goodInput);
    // Detached — the container outlives the create request.
    expect(args).toContain('-d');
    // Distinct session label so the one-shot sweep never reaps a session.
    expect(args).toContain('tale.sandbox-session=1');
    expect(args).not.toContain('tale.sandbox=1');
    // Daemon dispatch is the only positional; no user entry path in argv.
    expect(args[args.length - 1]).toBe('daemon');
    expect(args[args.length - 2]).toBe('tale-sandbox-runtime:test');
    // Agent resource profile (distinct from the one-shot 1cpu/1500m/128).
    expect(args).toContain('--cpus=2');
    expect(args).toContain('--memory=4g');
    expect(args).toContain('--memory-swap=4g');
    expect(args).toContain('--pids-limit=512');
    expect(args).toContain('--shm-size=512m');
    expect(args).toContain('--user');
    expect(args).toContain('10001:10001');
    // CRITICAL: no cumulative cpu-time ulimit — would kill a long-lived daemon.
    expect(args).not.toContain('cpu=600');
    const ulimitArgs = args.filter((_, i) => args[i - 1] === '--ulimit');
    expect(ulimitArgs.some((u) => u.startsWith('cpu='))).toBe(false);
    // Hardening preserved.
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--read-only');
    expect(args).toContain('no-new-privileges');
    // Gateway reachable directly (not via tinyproxy).
    expect(args).toContain('NO_PROXY=127.0.0.1,localhost,bifrost');
    // Runnerd token in env.
    expect(args).toContain(`TALE_RUNNERD_TOKEN=${'a'.repeat(64)}`);
    // Container + workspace mount.
    expect(args).toContain('tale-sbx-ses-ses-abc-123');
    expect(args).toContain(
      'type=bind,src=/var/lib/tale-sandbox/sessions/ses-ses-abc-123,dst=/workspace',
    );
    // Shared per-org caches on disk volumes — bun alongside pip/npm so its
    // cache doesn't fall to ~/.bun in the per-user workspace.
    expect(args).toContain('NPM_CONFIG_CACHE=/cache/npm');
    expect(args).toContain('BUN_INSTALL_CACHE_DIR=/cache/bun');
    expect(args).toContain('type=volume,src=bun-org_456,dst=/cache/bun');
  });

  test('default profile: one-shot-equivalent caps + uid 65534', () => {
    const args = buildDockerSessionRunArgs(cfg, {
      ...goodInput,
      profile: 'default',
    });
    expect(args).toContain('--cpus=1');
    expect(args).toContain('--memory=1500m');
    expect(args).toContain('--pids-limit=128');
    expect(args).toContain('65534:65534');
    expect(args).toContain('tale.profile=default');
  });

  test('rejects unsafe sessionId', () => {
    expect(() =>
      buildDockerSessionRunArgs(cfg, {
        ...goodInput,
        sessionId: 'bad;rm -rf /',
      }),
    ).toThrow(/sessionId/);
  });

  test('rejects unsafe workspace host dir', () => {
    expect(() =>
      buildDockerSessionRunArgs(cfg, {
        ...goodInput,
        workspaceHostDir: '/etc/../$(whoami)',
      }),
    ).toThrow(/workspaceHostDir/);
  });

  test('rejects non-hex runnerd token', () => {
    expect(() =>
      buildDockerSessionRunArgs(cfg, {
        ...goodInput,
        runnerdToken: 'not-a-hex-token!',
      }),
    ).toThrow(/runnerdToken/);
  });

  test('accepts empty runnerd token (unsigned dev mode)', () => {
    const args = buildDockerSessionRunArgs(cfg, {
      ...goodInput,
      runnerdToken: '',
    });
    expect(args).toContain('TALE_RUNNERD_TOKEN=');
  });
});
