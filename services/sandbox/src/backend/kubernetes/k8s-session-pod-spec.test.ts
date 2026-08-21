// Regression gate for the session-Pod builder. Asserts the single long-lived
// runner (no stage/harvest), restartPolicy Always, per-profile user, the
// readiness probe on runnerd, the per-session Secret via envFrom, /dev/shm for
// Chromium, and that unsafe identifiers are rejected. No cluster needed.

import { describe, expect, test } from 'bun:test';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import {
  buildSessionPod,
  sessionPodNameFor,
  sessionSecretNameFor,
  sessionWorkspacePvcNameFor,
} from './k8s-session-pod-spec.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtimeTier: 'gvisor',
  dockerInContainer: false,
  dockerBuildCache: false,
  buildkitdImage: 'tale-sandbox-buildkitd:test',
  buildkitdMirrorImage: 'registry:2',
  browserView: false,
  transparentEgress: false,
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: 'gvisor',
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '8Gi',
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

const input = {
  sessionId: 'sess-abc-123',
  organizationId: 'org_456',
  profile: 'agent' as const,
  createdAtMs: 1_700_000_000_000,
};

describe('buildSessionPod', () => {
  test('single long-lived runner, no stage/harvest', () => {
    const pod = buildSessionPod(cfg, input);
    expect(pod.spec?.containers).toHaveLength(1);
    expect(pod.spec?.containers[0]?.name).toBe('runner');
    expect(pod.spec?.initContainers).toBeUndefined();
    expect(pod.spec?.containers[0]?.args).toEqual(['daemon']);
    expect(pod.spec?.restartPolicy).toBe('Always');
  });

  test('agent profile: uid 10001, 4Gi limit, gVisor runtime class', () => {
    const pod = buildSessionPod(cfg, input);
    const sc = pod.spec?.containers[0]?.securityContext;
    expect(sc?.runAsUser).toBe(10001);
    expect(sc?.runAsNonRoot).toBe(true);
    expect(sc?.readOnlyRootFilesystem).toBe(true);
    expect(sc?.capabilities?.drop).toEqual(['ALL']);
    expect(pod.spec?.containers[0]?.resources?.limits?.memory).toBe('4Gi');
    expect(pod.spec?.runtimeClassName).toBe('gvisor');
    expect(pod.spec?.securityContext?.fsGroup).toBe(10001);
  });

  test('readiness probe hits runnerd /readyz; no SA token', () => {
    const pod = buildSessionPod(cfg, input);
    expect(pod.spec?.containers[0]?.readinessProbe?.httpGet?.path).toBe(
      '/readyz',
    );
    expect(pod.spec?.containers[0]?.readinessProbe?.httpGet?.port).toBe(8200);
    expect(pod.spec?.automountServiceAccountToken).toBe(false);
    expect(pod.spec?.enableServiceLinks).toBe(false);
  });

  test('per-session Secret via envFrom; /dev/shm sized for Chromium', () => {
    const pod = buildSessionPod(cfg, input);
    const c = pod.spec?.containers[0];
    expect(c?.envFrom?.[0]?.secretRef?.name).toBe(
      sessionSecretNameFor('sess-abc-123'),
    );
    const dshm = pod.spec?.volumes?.find((v) => v.name === 'dshm');
    expect(dshm?.emptyDir?.medium).toBe('Memory');
    expect(c?.volumeMounts?.some((m) => m.mountPath === '/dev/shm')).toBe(true);
    // Distinct session label so the one-shot sweep ignores it.
    expect(pod.metadata?.labels?.['tale.sandbox-session']).toBe('1');
    expect(pod.metadata?.labels?.['tale.sandbox']).toBeUndefined();
  });

  test('workspace is a per-session PVC (survives stop), not emptyDir', () => {
    const pod = buildSessionPod(cfg, input);
    const ws = pod.spec?.volumes?.find((v) => v.name === 'workspace');
    // PVC-backed so a stop (Pod delete, PVC kept) preserves /agent for
    // resume; emptyDir would die with the Pod.
    expect(ws?.emptyDir).toBeUndefined();
    expect(ws?.persistentVolumeClaim?.claimName).toBe(
      sessionWorkspacePvcNameFor('sess-abc-123'),
    );
    expect(sessionWorkspacePvcNameFor('sess-abc-123')).toBe(
      `${sessionPodNameFor('sess-abc-123')}-ws`,
    );
    const c = pod.spec?.containers[0];
    expect(c?.volumeMounts?.some((m) => m.mountPath === '/agent')).toBe(true);
  });

  test('default profile maps to uid 65534', () => {
    const pod = buildSessionPod(cfg, { ...input, profile: 'default' });
    expect(pod.spec?.containers[0]?.securityContext?.runAsUser).toBe(65534);
    expect(pod.metadata?.annotations?.['tale.dev/profile']).toBe('default');
  });

  test('deterministic, DNS-1123-safe pod + secret names', () => {
    const a = sessionPodNameFor('sess-abc-123');
    const b = sessionPodNameFor('sess-abc-123');
    expect(a).toBe(b);
    expect(a).toMatch(/^tale-sbx-ses-[a-f0-9]{16}$/);
    expect(sessionSecretNameFor('sess-abc-123')).toBe(`${a}-spec`);
  });

  test('rejects unsafe identifiers', () => {
    expect(() =>
      buildSessionPod(cfg, { ...input, sessionId: 'bad;rm -rf' }),
    ).toThrow(/sessionId/);
    expect(() =>
      buildSessionPod(cfg, { ...input, organizationId: 'bad org!' }),
    ).toThrow(/organizationId/);
  });

  describe('docker-in-container (sysbox tier)', () => {
    const dindCfg = {
      ...cfg,
      runtimeTier: 'sysbox' as const,
      dockerInContainer: true,
      k8s: { ...cfg.k8s, runtimeClassName: 'sysbox-runc' },
    };

    test('inverts the securityContext + adds an ephemeral docker-storage emptyDir', () => {
      const pod = buildSessionPod(dindCfg, input);
      expect(pod.spec?.runtimeClassName).toBe('sysbox-runc');
      const sc = pod.spec?.containers[0]?.securityContext;
      expect(sc?.runAsUser).toBe(0);
      expect(sc?.runAsNonRoot).toBe(false);
      expect(sc?.readOnlyRootFilesystem).toBe(false);
      expect(sc?.allowPrivilegeEscalation).toBe(true);
      expect(sc?.capabilities?.drop).toBeUndefined();
      expect(sc?.seccompProfile?.type).toBe('Unconfined');
      // Inner docker store: ephemeral, size-bounded emptyDir at /var/lib/docker.
      const ds = pod.spec?.volumes?.find((v) => v.name === 'docker-storage');
      expect(ds?.emptyDir?.sizeLimit).toBe(cfg.k8s.workspaceSizeLimit);
      expect(ds?.persistentVolumeClaim).toBeUndefined();
      expect(
        pod.spec?.containers[0]?.volumeMounts?.some(
          (m) => m.mountPath === '/var/lib/docker',
        ),
      ).toBe(true);
      // DinD signal + tier + apparmor unconfined annotation.
      const env = pod.spec?.containers[0]?.env ?? [];
      expect(env.find((e) => e.name === 'TALE_DIND')?.value).toBe('1');
      expect(env.find((e) => e.name === 'TALE_RUNTIME_TIER')?.value).toBe(
        'sysbox',
      );
      expect(
        pod.metadata?.annotations?.[
          'container.apparmor.security.beta.kubernetes.io/runner'
        ],
      ).toBe('unconfined');
    });

    test('DinD-off keeps the hardened securityContext and no docker-storage', () => {
      const pod = buildSessionPod(cfg, input);
      const sc = pod.spec?.containers[0]?.securityContext;
      expect(sc?.runAsNonRoot).toBe(true);
      expect(sc?.readOnlyRootFilesystem).toBe(true);
      expect(sc?.capabilities?.drop).toEqual(['ALL']);
      expect(pod.spec?.volumes?.some((v) => v.name === 'docker-storage')).toBe(
        false,
      );
      expect(
        (pod.spec?.containers[0]?.env ?? []).some(
          (e) => e.name === 'TALE_DIND',
        ),
      ).toBe(false);
    });
  });

  describe('transparent egress (SANDBOX_TRANSPARENT_EGRESS)', () => {
    // The base fixture tier is gvisor (unsupported); use runc for the supported
    // cases.
    const runcCfg = {
      ...cfg,
      runtimeTier: 'runc' as const,
      k8s: { ...cfg.k8s, runtimeClassName: null },
    };

    test('off (default): no egress sidecar, runner unchanged', () => {
      const pod = buildSessionPod(cfg, input);
      expect(pod.spec?.initContainers).toBeUndefined();
      expect(
        (pod.spec?.containers[0]?.env ?? []).some(
          (e) => e.name === 'TALE_TRANSPARENT_EGRESS',
        ),
      ).toBe(false);
    });

    test('on (runc, non-DinD): native redsocks sidecar; runner stays hardened', () => {
      const pod = buildSessionPod(
        { ...runcCfg, transparentEgress: true },
        input,
      );
      const egress = (pod.spec?.initContainers ?? []).find(
        (c) => c.name === 'egress',
      );
      expect(egress).toBeDefined();
      expect(egress?.args).toEqual(['egress-sidecar']);
      // Native sidecar: started before (and runs alongside) the runner.
      expect(egress?.restartPolicy).toBe('Always');
      // NET_ADMIN lives ONLY in the sidecar (which runs only redsocks).
      expect(egress?.securityContext?.runAsUser).toBe(0);
      expect(egress?.securityContext?.capabilities?.add).toEqual([
        'NET_ADMIN',
        'NET_RAW',
        'SETUID',
        'SETGID',
      ]);
      // The runner container is untouched — still fully hardened, no NET_ADMIN.
      const runner = pod.spec?.containers[0]?.securityContext;
      expect(runner?.runAsNonRoot).toBe(true);
      expect(runner?.capabilities?.drop).toEqual(['ALL']);
      expect(runner?.capabilities?.add).toBeUndefined();
      // Non-DinD runner gets NO inline signal (the sidecar does the install).
      expect(
        (pod.spec?.containers[0]?.env ?? []).some(
          (e) => e.name === 'TALE_TRANSPARENT_EGRESS',
        ),
      ).toBe(false);
    });

    test('on but gvisor tier: no sidecar (runsc netstack), falls back to env', () => {
      const pod = buildSessionPod({ ...cfg, transparentEgress: true }, input);
      expect(pod.spec?.initContainers).toBeUndefined();
    });

    test('on + DinD: no sidecar; the root runner installs it inline via the signal', () => {
      const pod = buildSessionPod(
        { ...runcCfg, dockerInContainer: true, transparentEgress: true },
        input,
      );
      expect(pod.spec?.initContainers).toBeUndefined();
      expect(
        (pod.spec?.containers[0]?.env ?? []).find(
          (e) => e.name === 'TALE_TRANSPARENT_EGRESS',
        )?.value,
      ).toBe('1');
    });
  });
});
