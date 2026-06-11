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
} from './k8s-session-pod-spec.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtime: 'runsc',
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: 'gvisor',
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '8Gi',
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
});
