// C4 regression: a Secret-create failure during a FRESH session create must
// clean up the workspace PVC it already created — the PVC has no ownerReference,
// so without the cleanup envelope K8s GC has nothing to cascade from and the
// volume leaks. Driven through a stub CoreV1Api (the same DI pattern the
// one-shot KubernetesBackend tests use) so the asymmetry is pinned without a
// cluster.

import { describe, expect, test } from 'bun:test';

import type { CoreV1Api, NetworkingV1Api } from '@kubernetes/client-node';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { SessionSpec } from '../types.ts';
import type { K8sClient } from './k8s-client.ts';
import { KubernetesSessionBackend } from './k8s-session-backend.ts';
import { sessionPodNameFor } from './k8s-session-pod-spec.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
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
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const networking = {} as unknown as NetworkingV1Api;
  return { client: { core, networking, namespace: 'tale-sandbox' }, calls };
}

/**
 * Stub for a RESUME (PVC already exists). `podPhase` is what the FIRST
 * readNamespacedPod returns (the reap probe); subsequent reads are 404 (gone),
 * so the reap's poll-until-gone exits at once. createNamespacedPod rejects with
 * a sentinel to halt the flow before runnerd readiness (which would do real
 * HTTP). The op log records call order so we can assert reap-before-recreate.
 */
function resumeStub(podPhase: 'Failed' | 'Succeeded' | 'Running' | 'Pending'): {
  client: K8sClient;
  log: string[];
} {
  const log: string[] = [];
  let podReads = 0;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const core = {
    readNamespacedPersistentVolumeClaim: () => {
      log.push('readPvc');
      return Promise.resolve({}); // PVC exists ⇒ resume
    },
    createNamespacedPersistentVolumeClaim: () => Promise.resolve({}),
    deleteNamespacedPersistentVolumeClaim: () => {
      log.push('deletePvc');
      return Promise.resolve({});
    },
    readNamespacedPod: () => {
      podReads += 1;
      if (podReads === 1) {
        log.push('readPod:probe');
        return Promise.resolve({ status: { phase: podPhase } });
      }
      log.push('readPod:gone');
      return notFound();
    },
    deleteNamespacedPod: () => {
      log.push('deletePod');
      return Promise.resolve({});
    },
    deleteNamespacedSecret: () => {
      log.push('deleteSecret');
      return Promise.resolve({});
    },
    createNamespacedSecret: () => {
      log.push('createSecret');
      return Promise.resolve({});
    },
    createNamespacedPod: () => {
      log.push('createPod');
      // Halt before readiness polling (no real runnerd in a unit test). 400 is
      // non-retryable, so withRetry rethrows at once (no retry backoff/noise).
      return Promise.reject(Object.assign(new Error('halt'), { code: 400 }));
    },
  } as unknown as CoreV1Api;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const networking = {} as unknown as NetworkingV1Api;
  return { client: { core, networking, namespace: 'tale-sandbox' }, log };
}

describe('KubernetesSessionBackend.createSession — reap a terminal Pod on resume', () => {
  /** Run a resume against a Pod stuck in `phase` and report whether the orphan
   * was deleted BEFORE the new Secret/Pod was created (i.e. proactively reaped).
   * createNamespacedPod halts the flow before readiness — the reap, not the
   * happy path, is what we assert. A `deletePod` after `createSecret` is the
   * halt-driven failed-create cleanup, NOT a proactive reap. */
  async function reapedBeforeRecreate(
    phase: 'Failed' | 'Succeeded' | 'Running' | 'Pending',
  ): Promise<boolean> {
    const { client, log } = resumeStub(phase);
    const backend = new KubernetesSessionBackend(cfg, client);
    await backend.createSession(spec).catch(() => {});
    const firstDeletePod = log.indexOf('deletePod');
    const createSecretIdx = log.indexOf('createSecret');
    expect(createSecretIdx).toBeGreaterThanOrEqual(0); // recreate was attempted
    return firstDeletePod >= 0 && firstDeletePod < createSecretIdx;
  }

  test('a provably-dead Pod (Failed/Succeeded) is reaped before the recreate', async () => {
    expect(await reapedBeforeRecreate('Failed')).toBe(true);
    expect(await reapedBeforeRecreate('Succeeded')).toBe(true);
  });

  test('a Running OR Pending peer is left untouched (concurrent-winner safety)', async () => {
    // The whole point: a Pending Pod is a peer still scheduling on another
    // replica, NOT a dead orphan — reaping it would stomp a healthy session.
    // (Regression guard for the cross-replica reap bug.)
    expect(await reapedBeforeRecreate('Running')).toBe(false);
    expect(await reapedBeforeRecreate('Pending')).toBe(false);
  });
});

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

describe('KubernetesSessionBackend durable pin (Pod annotation)', () => {
  test('setPinned merge-patches the pin annotation; listSessions reads it back', async () => {
    const patches: Array<{ name: string; body: unknown }> = [];
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const core = {
      patchNamespacedPod: (param: { name: string; body: unknown }) => {
        patches.push({ name: param.name, body: param.body });
        return Promise.resolve({});
      },
      listNamespacedPod: () =>
        Promise.resolve({
          items: [
            {
              metadata: {
                annotations: {
                  'tale.dev/session-id': 'k8s-pinned',
                  'tale.dev/organization-id': 'org_k8s',
                  'tale.dev/profile': 'agent',
                  'tale.dev/created-at': '1700000000000',
                  'tale.dev/pinned': 'true',
                },
              },
              status: { phase: 'Running' },
            },
            {
              metadata: {
                annotations: {
                  'tale.dev/session-id': 'k8s-plain',
                  'tale.dev/organization-id': 'org_k8s',
                  'tale.dev/profile': 'agent',
                  'tale.dev/created-at': '1700000000000',
                },
              },
              status: { phase: 'Running' },
            },
          ],
        }),
    } as unknown as CoreV1Api;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const networking = {} as unknown as NetworkingV1Api;
    const backend = new KubernetesSessionBackend(cfg, {
      core,
      networking,
      namespace: 'tale-sandbox',
    });

    await backend.setPinned('k8s-pinned', true);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.name).toBe(sessionPodNameFor('k8s-pinned'));
    expect(patches[0]?.body).toEqual({
      metadata: { annotations: { 'tale.dev/pinned': 'true' } },
    });

    const listed = await backend.listSessions();
    expect(listed.find((s) => s.sessionId === 'k8s-pinned')?.pinned).toBe(true);
    expect(listed.find((s) => s.sessionId === 'k8s-plain')?.pinned).toBe(false);
  });
});

describe('KubernetesSessionBackend.listSessions', () => {
  test('THROWS on an API failure instead of reporting "no sessions"', async () => {
    // An apiserver hiccup laundered into [] would leave every running session
    // Pod unregistered (unroutable, never reaped) until the next successful
    // list. 403 is non-retryable so withRetry surfaces it at once.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const core = {
      listNamespacedPod: () =>
        Promise.reject(Object.assign(new Error('forbidden'), { code: 403 })),
    } as unknown as CoreV1Api;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const networking = {} as unknown as NetworkingV1Api;
    const backend = new KubernetesSessionBackend(cfg, {
      core,
      networking,
      namespace: 'tale-sandbox',
    });
    let threw: Error | null = null;
    try {
      await backend.listSessions();
    } catch (err) {
      threw = err instanceof Error ? err : new Error(String(err));
    }
    expect(threw?.message).toBe('forbidden');
  });
});
