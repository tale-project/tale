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
  runtimeTier: 'runc',
  dockerInContainer: false,
  dockerBuildCache: false,
  buildkitdImage: 'tale-sandbox-buildkitd:test',
  buildkitdMirrorImage: 'registry:2',
  browserView: false,
  transparentEgress: false,
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: null,
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '4Gi',
  },
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
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
    // Gateway + convex http-actions reachable directly (not via tinyproxy).
    expect(args).toContain(
      'NO_PROXY=127.0.0.1,localhost,sandbox-llm-gateway,llm-gateway,convex',
    );
    // Runnerd token in env.
    expect(args).toContain(`TALE_RUNNERD_TOKEN=${'a'.repeat(64)}`);
    // Container + workspace mount.
    expect(args).toContain('tale-sbx-ses-ses-abc-123');
    expect(args).toContain(
      'type=bind,src=/var/lib/tale-sandbox/sessions/ses-ses-abc-123,dst=/agent',
    );
    // Shared per-org caches on disk volumes — bun alongside pip/npm so its
    // cache doesn't fall to ~/.bun in the per-user workspace.
    expect(args).toContain('NPM_CONFIG_CACHE=/cache/npm');
    expect(args).toContain('BUN_INSTALL_CACHE_DIR=/cache/bun');
    expect(args).toContain('type=volume,src=bun-org_456,dst=/cache/bun');
  });

  describe('live browser view (SANDBOX_BROWSER_VIEW)', () => {
    test('off (default): no TALE_BROWSER_CDP env leaks in', () => {
      const args = buildDockerSessionRunArgs(cfg, goodInput);
      expect(args).not.toContain('TALE_BROWSER_CDP=1');
    });

    test('on: appends TALE_BROWSER_CDP=1, rest unchanged', () => {
      const args = buildDockerSessionRunArgs(
        { ...cfg, browserView: true },
        goodInput,
      );
      // The browser-view signal is present (additive).
      const envIdxs = args.reduce<number[]>((acc, a, i) => {
        if (a === '--env') acc.push(i);
        return acc;
      }, []);
      expect(envIdxs.some((i) => args[i + 1] === 'TALE_BROWSER_CDP=1')).toBe(
        true,
      );
      // Everything else stays as the default hardened agent argv.
      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--read-only');
      expect(args[args.length - 1]).toBe('daemon');
    });
  });

  describe('transparent egress (SANDBOX_TRANSPARENT_EGRESS)', () => {
    test('off (default): no NET_ADMIN, no signal, runs as the profile uid', () => {
      const args = buildDockerSessionRunArgs(cfg, goodInput);
      expect(args).not.toContain('--cap-add=NET_ADMIN');
      expect(args).not.toContain('TALE_TRANSPARENT_EGRESS=1');
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('10001:10001');
      expect(args).toContain('--cap-drop=ALL');
    });

    test('on (runc, agent): adds NET_ADMIN+NET_RAW, boots root, keeps hardening, signals drop uid', () => {
      const args = buildDockerSessionRunArgs(
        { ...cfg, transparentEgress: true },
        goodInput,
      );
      // iptables caps + SETUID/SETGID for the boot-time setpriv drop, on top of
      // a still-dropped base.
      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--cap-add=NET_ADMIN');
      expect(args).toContain('--cap-add=NET_RAW');
      expect(args).toContain('--cap-add=SETUID');
      expect(args).toContain('--cap-add=SETGID');
      // Rest of the hardening preserved (read-only stays — redsocks.conf → /tmp).
      expect(args).toContain('no-new-privileges');
      expect(args).toContain('--read-only');
      // Boots as root so the entrypoint can install iptables, then setpriv-drops.
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('0:0');
      // Entrypoint signal + the profile uid to drop to (agent → 10001).
      expect(args).toContain('TALE_TRANSPARENT_EGRESS=1');
      expect(args).toContain('TALE_DROP_UID=10001');
      expect(args).toContain('TALE_DROP_GID=10001');
      // Still a daemon session.
      expect(args[args.length - 1]).toBe('daemon');
    });

    test('on + default profile: drop uid is 65534', () => {
      const args = buildDockerSessionRunArgs(
        { ...cfg, transparentEgress: true },
        { ...goodInput, profile: 'default' },
      );
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('0:0');
      expect(args).toContain('TALE_DROP_UID=65534');
      expect(args).toContain('TALE_DROP_GID=65534');
    });

    test('on but gvisor tier: skipped (runsc netstack), falls back to env proxy', () => {
      const args = buildDockerSessionRunArgs(
        { ...cfg, transparentEgress: true, runtimeTier: 'gvisor' },
        goodInput,
      );
      expect(args).not.toContain('--cap-add=NET_ADMIN');
      expect(args).not.toContain('TALE_TRANSPARENT_EGRESS=1');
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('10001:10001');
      // HTTPS_PROXY env is still present for proxy-aware clients.
      expect(args).toContain('HTTPS_PROXY=http://sandbox-egress:3128');
    });

    test('on + DinD: signal sent, but DinD hardening (not the NET_ADMIN argv) applies', () => {
      const args = buildDockerSessionRunArgs(
        {
          ...cfg,
          transparentEgress: true,
          runtimeTier: 'sysbox',
          dockerInContainer: true,
        },
        { ...goodInput, dockerStorageVolume: 'tale-dind-ses-abc-123' },
      );
      // The entrypoint installs session egress after dockerd; signal is present.
      expect(args).toContain('TALE_TRANSPARENT_EGRESS=1');
      // DinD already boots root with its caps — the non-DinD NET_ADMIN argv and
      // the explicit drop-uid env are NOT added on this path.
      expect(args).not.toContain('--cap-add=NET_ADMIN');
      expect(args.some((a) => a.startsWith('TALE_DROP_UID='))).toBe(false);
      // DinD relaxations unchanged.
      expect(args).toContain('apparmor=unconfined');
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('0:0');
    });
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

  describe('docker-in-container (sysbox tier)', () => {
    const dindCfg = {
      ...cfg,
      runtimeTier: 'sysbox' as const,
      dockerInContainer: true,
    };
    const dindInput = {
      ...goodInput,
      dockerStorageVolume: 'tale-dind-ses-abc-123',
    };

    test('relaxes hardening, runs as root, mounts the docker store, signals the entrypoint', () => {
      const args = buildDockerSessionRunArgs(dindCfg, dindInput);
      // sysbox runtime + DinD signal/tier for the entrypoint.
      expect(args).toContain('--runtime=sysbox-runc');
      expect(args).toContain('TALE_DIND=1');
      expect(args).toContain('TALE_RUNTIME_TIER=sysbox');
      // Container starts as root (entrypoint drops to 10001 after dockerd).
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('0:0');
      // Relaxations the inner dockerd needs — the userns is the real boundary.
      expect(args).toContain('apparmor=unconfined');
      expect(args).not.toContain('--cap-drop=ALL');
      expect(args).not.toContain('no-new-privileges');
      expect(args).not.toContain('--read-only');
      // Dedicated, ephemeral inner-docker store.
      expect(args).toContain(
        'type=volume,src=tale-dind-ses-abc-123,dst=/var/lib/docker',
      );
      // Shared per-org caches are OFF under DinD (userns shifting safety).
      expect(args).not.toContain('type=volume,src=bun-org_456,dst=/cache/bun');
      expect(args.some((a) => a.startsWith('PIP_CACHE_DIR='))).toBe(false);
    });

    test('throws if the docker storage volume is missing', () => {
      expect(() => buildDockerSessionRunArgs(dindCfg, goodInput)).toThrow(
        /dockerStorageVolume is required/,
      );
    });

    test('shared build cache: emits TALE_BUILDKITD_ENDPOINT when set', () => {
      const args = buildDockerSessionRunArgs(dindCfg, {
        ...dindInput,
        buildkitdEndpoint: 'tcp://tale-buildkitd:1234',
      });
      expect(args).toContain(
        'TALE_BUILDKITD_ENDPOINT=tcp://tale-buildkitd:1234',
      );
    });

    test('shared build cache: absent endpoint keeps argv byte-identical', () => {
      const withField = buildDockerSessionRunArgs(dindCfg, {
        ...dindInput,
        buildkitdEndpoint: undefined,
      });
      const without = buildDockerSessionRunArgs(dindCfg, dindInput);
      expect(withField).toEqual(without);
      expect(
        withField.some((a) => a.startsWith('TALE_BUILDKITD_ENDPOINT=')),
      ).toBe(false);
    });

    test('shared build cache: a malformed endpoint is rejected', () => {
      expect(() =>
        buildDockerSessionRunArgs(dindCfg, {
          ...dindInput,
          buildkitdEndpoint: 'http://evil; rm -rf /',
        }),
      ).toThrow(/buildkitdEndpoint value rejected/);
    });

    test('DinD-off output is unchanged (no DinD flags leak in)', () => {
      const args = buildDockerSessionRunArgs(cfg, goodInput);
      expect(args).not.toContain('TALE_DIND=1');
      expect(args).not.toContain('apparmor=unconfined');
      expect(args).toContain('--cap-drop=ALL');
      expect(args).toContain('--read-only');
      expect(args.some((a) => a.includes('dst=/var/lib/docker'))).toBe(false);
    });

    test('runc tier uses --privileged (no boundary; trusted-only)', () => {
      const runcDind = {
        ...cfg,
        runtimeTier: 'runc' as const,
        dockerInContainer: true,
      };
      const args = buildDockerSessionRunArgs(runcDind, dindInput);
      expect(args).toContain('--runtime=runc');
      expect(args).toContain('--privileged');
      expect(args).toContain('TALE_RUNTIME_TIER=runc');
      const userIdx = args.indexOf('--user');
      expect(args[userIdx + 1]).toBe('0:0');
      // privileged path doesn't bother with the per-flag relaxations.
      expect(args).not.toContain('--cap-drop=ALL');
      expect(args).not.toContain('--read-only');
      expect(args).toContain(
        'type=volume,src=tale-dind-ses-abc-123,dst=/var/lib/docker',
      );
    });

    // REGRESSION: DinD is agent-profile only. A `default`-profile (run_code)
    // session under a DinD-enabled cfg once got the DinD boot: --privileged on
    // runc, and — fatally — the entrypoint's DinD branch setpriv-drops to
    // 10001 unconditionally, which cannot write the 65534-owned workspace, so
    // the skeleton mkdir died and runnerd never became ready (3-min 502 on
    // every chat run_code).
    describe('default profile never gets DinD', () => {
      test('runc DinD cfg + transparent egress: hardened caps path, drop uid 65534, no privileged/DinD flags', () => {
        const args = buildDockerSessionRunArgs(
          {
            ...cfg,
            runtimeTier: 'runc' as const,
            dockerInContainer: true,
            transparentEgress: true,
          },
          { ...goodInput, profile: 'default' },
        );
        expect(args).not.toContain('--privileged');
        expect(args).not.toContain('TALE_DIND=1');
        expect(args.some((a) => a.startsWith('TALE_RUNTIME_TIER='))).toBe(
          false,
        );
        // Takes the transparent-egress hardening path: boots root with scoped
        // caps and pins the entrypoint's setpriv drop to the profile uid.
        expect(args).toContain('--cap-drop=ALL');
        expect(args).toContain('--cap-add=NET_ADMIN');
        expect(args).toContain('TALE_DROP_UID=65534');
        expect(args).toContain('TALE_DROP_GID=65534');
        const userIdx = args.indexOf('--user');
        expect(args[userIdx + 1]).toBe('0:0');
        // No inner-docker store, no shared build cache; per-org dep caches ON
        // (the DinD userns-shifting concern doesn't apply).
        expect(args.some((a) => a.includes('dst=/var/lib/docker'))).toBe(false);
        expect(args.some((a) => a.startsWith('TALE_BUILDKITD_ENDPOINT='))).toBe(
          false,
        );
        expect(args.some((a) => a.startsWith('PIP_CACHE_DIR='))).toBe(true);
      });

      test('sysbox DinD cfg, no egress: runs as 65534 directly, fully hardened', () => {
        const args = buildDockerSessionRunArgs(
          { ...cfg, runtimeTier: 'sysbox' as const, dockerInContainer: true },
          { ...goodInput, profile: 'default' },
        );
        expect(args).not.toContain('TALE_DIND=1');
        expect(args).not.toContain('apparmor=unconfined');
        expect(args).toContain('--cap-drop=ALL');
        expect(args).toContain('--read-only');
        const userIdx = args.indexOf('--user');
        expect(args[userIdx + 1]).toBe('65534:65534');
      });

      test('default profile does not require the docker storage volume', () => {
        expect(() =>
          buildDockerSessionRunArgs(
            { ...cfg, runtimeTier: 'sysbox' as const, dockerInContainer: true },
            { ...goodInput, profile: 'default' },
          ),
        ).not.toThrow();
      });

      test('browser stack is agent-only: default profile gets no TALE_BROWSER_CDP', () => {
        const args = buildDockerSessionRunArgs(
          { ...cfg, browserView: true },
          { ...goodInput, profile: 'default' },
        );
        expect(args).not.toContain('TALE_BROWSER_CDP=1');
      });
    });
  });
});
