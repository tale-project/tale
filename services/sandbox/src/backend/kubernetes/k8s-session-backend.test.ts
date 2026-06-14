// C4 regression: a Secret-create failure during a FRESH session create must
// clean up the workspace PVC it already created — the PVC has no ownerReference,
// so without the cleanup envelope K8s GC has nothing to cascade from and the
// volume leaks. Driven through a stub CoreV1Api (the same DI pattern the
// one-shot KubernetesBackend tests use) so the asymmetry is pinned without a
// cluster.

import { describe, expect, test } from 'bun:test';

import type { CoreV1Api } from '@kubernetes/client-node';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { SessionSpec } from '../types.ts';
import type { K8sClient } from './k8s-client.ts';
import { KubernetesSessionBackend } from './k8s-session-backend.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
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

const spec: SessionSpec = {
  sessionId: 'sess_c4',
  organizationId: 'org_c4',
  profile: 'agent',
  ttlMs: 86_400_000,
  idleTimeoutMs: 1_800_000,
  env: {},
  createdAtMs: 1_700_000_000_000,
};

function notFound(): Promise<never> {
  return Promise.reject(Object.assign(new Error('not found'), { code: 404 }));
}
function conflict(): Promise<never> {
  return Promise.reject(Object.assign(new Error('conflict'), { code: 409 }));
}

interface Calls {
  pvcCreated: boolean;
  pvcDeleted: boolean;
}

/** Stub CoreV1Api for a FRESH create (no pre-existing PVC): the PVC reads 404,
 * its create succeeds, and the Secret create is supplied by the test. */
function stub(createSecret: () => Promise<unknown>): {
  client: K8sClient;
  calls: Calls;
} {
  const calls: Calls = { pvcCreated: false, pvcDeleted: false };
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const core = {
    readNamespacedPersistentVolumeClaim: () => notFound(),
    createNamespacedPersistentVolumeClaim: () => {
      calls.pvcCreated = true;
      return Promise.resolve({});
    },
    deleteNamespacedPersistentVolumeClaim: () => {
      calls.pvcDeleted = true;
      return Promise.resolve({});
    },
    createNamespacedSecret: createSecret,
    createNamespacedPod: () => Promise.resolve({}),
    readNamespacedPod: () => notFound(),
    deleteNamespacedPod: () => Promise.resolve({}),
    deleteNamespacedSecret: () => Promise.resolve({}),
  } as unknown as CoreV1Api;
  return { client: { core, namespace: 'tale-sandbox' }, calls };
}

describe('KubernetesSessionBackend.createSession — PVC cleanup on Secret failure (C4)', () => {
  test('a fresh-create Secret failure deletes the just-created workspace PVC', async () => {
    const { client, calls } = stub(conflict);
    const backend = new KubernetesSessionBackend(cfg, client);

    let threw = false;
    try {
      await backend.createSession(spec);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    // The PVC was created, then the Secret failed AFTER it — the cleanup
    // envelope must destroy the orphan (fresh create ⇒ destroy, not stop).
    expect(calls.pvcCreated).toBe(true);
    expect(calls.pvcDeleted).toBe(true);
  });
});
