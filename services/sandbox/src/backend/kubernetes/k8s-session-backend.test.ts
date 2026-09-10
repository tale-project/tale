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
import { SessionIncarnationChangedError, type SessionSpec } from '../types.ts';
import type { K8sClient } from './k8s-client.ts';
import { KubernetesSessionBackend } from './k8s-session-backend.ts';
import {
  sessionPodNameFor,
  sessionSecretNameFor,
} from './k8s-session-pod-spec.ts';

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
  transparentEgress: false,
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: null,
    workspaceSizeLimit: '4Gi',
  },
  maxTimeoutMs: 300_000,
  hostSessionRoot: '/var/lib/tale-sandbox/sessions',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 5_242_880,
  stderrMaxBytes: 5_242_880,
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

describe('Kubernetes pressure stop', () => {
  test('fences Pod and Secret UIDs, waits through termination, and retains the workspace PVC', async () => {
    const terminating = Promise.withResolvers<void>();
    let deleting = false;
    let gone = false;
    const deletions: Array<{ kind: string; body: unknown }> = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded CoreV1 test seam
    const core = {
      readNamespacedPod: async () => {
        if (gone) return notFound();
        if (deleting) terminating.resolve();
        return {
          metadata: {
            uid: 'pod-original',
            annotations: { 'tale.dev/created-at': '1000' },
            ...(deleting ? { deletionTimestamp: new Date() } : {}),
          },
          status: { phase: 'Running' },
        };
      },
      // The documented Role grants list/create/delete on Secrets, never
      // `get`: the fence reads the Secret through a name-selected list.
      listNamespacedSecret: async (args: { fieldSelector?: string }) => {
        expect(args.fieldSelector).toBe(
          `metadata.name=${sessionSecretNameFor('fenced')}`,
        );
        return {
          items: [
            {
              metadata: {
                name: sessionSecretNameFor('fenced'),
                uid: 'secret-original',
                annotations: { 'tale.dev/created-at': '1000' },
              },
            },
          ],
        };
      },
      deleteNamespacedSecret: async (args: { body: unknown }) => {
        deletions.push({ kind: 'secret', body: args.body });
      },
      deleteNamespacedPod: async (args: { body: unknown }) => {
        deleting = true;
        deletions.push({ kind: 'pod', body: args.body });
      },
      deleteNamespacedPersistentVolumeClaim: async () => {
        throw new Error('workspace must survive');
      },
    } as unknown as CoreV1Api;
    const base = stub(async () => ({}));
    const backend = new KubernetesSessionBackend(cfg, { ...base.client, core });
    let stopped = false;
    const stop = backend.stopSession('fenced', 1000).then((result) => {
      stopped = true;
      return result;
    });
    await terminating.promise;
    expect(stopped).toBe(false);
    expect(deletions).toEqual([
      { kind: 'secret', body: { preconditions: { uid: 'secret-original' } } },
      { kind: 'pod', body: { preconditions: { uid: 'pod-original' } } },
    ]);
    gone = true;
    expect(await stop).toBe(true);
  });

  test('a changed creation stamp prevents deletion of a replacement Pod', async () => {
    const base = stub(async () => ({}));
    base.client.core.readNamespacedPod = async () => ({
      metadata: {
        uid: 'replacement',
        annotations: { 'tale.dev/created-at': '2000' },
      },
    });
    const backend = new KubernetesSessionBackend(cfg, base.client);
    const result = await backend.stopSession('changed', 1000).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(result instanceof Error ? result.message : '').toContain(
      'changed before idle stop',
    );
    expect(base.calls.podDeleted).toBe(false);
    expect(base.calls.secretDeleted).toBe(0);
    expect(base.calls.pvcDeleted).toBe(false);
  });

  test('a replacement Secret observed after the Pod read is left untouched', async () => {
    const base = stub(async () => ({}));
    base.client.core.readNamespacedPod = async () => ({
      metadata: {
        uid: 'original',
        annotations: { 'tale.dev/created-at': '1000' },
      },
    });
    base.client.core.listNamespacedSecret = async () => ({
      items: [
        {
          metadata: {
            name: sessionSecretNameFor('secret-race'),
            uid: 'new-secret',
            annotations: { 'tale.dev/created-at': '2000' },
          },
        },
      ],
    });
    const backend = new KubernetesSessionBackend(cfg, base.client);
    const result = await backend.stopSession('secret-race', 1000).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(base.calls.secretDeleted).toBe(0);
    expect(base.calls.podDeleted).toBe(false);
    expect(base.calls.pvcDeleted).toBe(false);
  });

  test('a Secret from an older spawner (no creation stamp) is still deleted by its UID', async () => {
    // Only a DIFFERENT stamp marks a replacement: a stamp-less Secret can
    // only be the one an older spawner created for this incarnation.
    let podGone = false;
    const deletions: Array<{ kind: string; body: unknown }> = [];
    const base = stub(async () => ({}));
    base.client.core.readNamespacedPod = async () => {
      if (podGone) return notFound();
      return {
        metadata: {
          uid: 'pod-original',
          annotations: { 'tale.dev/created-at': '1000' },
        },
      };
    };
    base.client.core.listNamespacedSecret = async () => ({
      items: [
        {
          metadata: {
            name: sessionSecretNameFor('legacy-secret'),
            uid: 'legacy-secret-uid',
          },
        },
      ],
    });
    base.client.core.deleteNamespacedSecret = async (args: {
      body?: unknown;
    }) => {
      deletions.push({ kind: 'secret', body: args.body });
      return {};
    };
    base.client.core.deleteNamespacedPod = async (args: { body?: unknown }) => {
      podGone = true;
      deletions.push({ kind: 'pod', body: args.body });
      return {};
    };
    const backend = new KubernetesSessionBackend(cfg, base.client);
    expect(await backend.stopSession('legacy-secret', 1000)).toBe(true);
    expect(deletions).toEqual([
      { kind: 'secret', body: { preconditions: { uid: 'legacy-secret-uid' } } },
      { kind: 'pod', body: { preconditions: { uid: 'pod-original' } } },
    ]);
    expect(base.calls.pvcDeleted).toBe(false);
  });

  test('a Pod replaced while ours terminates is reported as changed, never as freed', async () => {
    let deleted = false;
    const base = stub(async () => ({}));
    base.client.core.readNamespacedPod = async () => ({
      metadata: deleted
        ? { uid: 'replacement', annotations: { 'tale.dev/created-at': '2000' } }
        : {
            uid: 'pod-original',
            annotations: { 'tale.dev/created-at': '1000' },
          },
    });
    base.client.core.listNamespacedSecret = async () => ({ items: [] });
    base.client.core.deleteNamespacedPod = async () => {
      deleted = true;
      return {};
    };
    const backend = new KubernetesSessionBackend(cfg, base.client);
    const startedAt = Date.now();
    const result = await backend.stopSession('replaced', 1000).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(SessionIncarnationChangedError);
    // Decided on the first poll, not after the termination deadline.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(base.calls.pvcDeleted).toBe(false);
  });
});
function conflict(): Promise<never> {
  return Promise.reject(Object.assign(new Error('conflict'), { code: 409 }));
}
/** A definitive non-409 failure (400 is non-retryable, so withRetry rethrows
 * at once — no backoff noise in the test). */
function badRequest(): Promise<never> {
  return Promise.reject(Object.assign(new Error('bad request'), { code: 400 }));
}

interface Calls {
  pvcCreated: boolean;
  pvcDeleted: boolean;
  podDeleted: boolean;
  secretDeleted: number;
}

/** Stub CoreV1Api for a FRESH create (no pre-existing PVC): the PVC reads 404,
 * its create succeeds, and the Secret/Pod creates are supplied by the test. */
function stub(
  createSecret: () => Promise<unknown>,
  createPod: () => Promise<unknown> = () => Promise.resolve({}),
): {
  client: K8sClient;
  calls: Calls;
} {
  const calls: Calls = {
    pvcCreated: false,
    pvcDeleted: false,
    podDeleted: false,
    secretDeleted: 0,
  };
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
    createNamespacedPod: createPod,
    readNamespacedPod: () => notFound(),
    deleteNamespacedPod: () => {
      calls.podDeleted = true;
      return Promise.resolve({});
    },
    deleteNamespacedSecret: () => {
      calls.secretDeleted += 1;
      return Promise.resolve({});
    },
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

/** The rejection of a promise, or null when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

describe('KubernetesSessionBackend.createSession — PVC cleanup on Secret failure (C4)', () => {
  test('a fresh-create Secret failure deletes the just-created workspace PVC', async () => {
    // A definitive non-conflict failure: the objects are ours to clean up.
    const { client, calls } = stub(badRequest);
    const backend = new KubernetesSessionBackend(cfg, client);

    expect(await rejection(backend.createSession(spec))).not.toBeNull();

    // The PVC was created, then the Secret failed AFTER it — the cleanup
    // envelope must destroy the orphan (fresh create ⇒ destroy, not stop).
    expect(calls.pvcCreated).toBe(true);
    expect(calls.pvcDeleted).toBe(true);
  });
});

// REGRESSION: a 409 on the deterministic Secret/Pod name means a PEER owns the
// session (a concurrent create on another replica, or a live Pod this replica
// has not adopted). The failed-create cleanup used to run anyway and delete
// the running peer Pod + Secret — and, on the fresh path, the PVC too. A lost
// name race must never destroy the winner (Docker-backend parity).
describe('KubernetesSessionBackend.createSession — a 409 name conflict is not ours to tear down', () => {
  test('Secret 409: rejects with the conflict and deletes NOTHING (no Pod, Secret, or PVC delete)', async () => {
    const { client, calls } = stub(conflict);
    const backend = new KubernetesSessionBackend(cfg, client);
    const err = await rejection(backend.createSession(spec));
    expect(err?.message).toMatch(/session sess_c4 already exists/);
    expect(calls.podDeleted).toBe(false);
    expect(calls.secretDeleted).toBe(0);
    expect(calls.pvcDeleted).toBe(false);
  });

  test('Pod 409: rejects with the conflict, removes only the Secret this call created', async () => {
    const { client, calls } = stub(() => Promise.resolve({}), conflict);
    const backend = new KubernetesSessionBackend(cfg, client);
    const err = await rejection(backend.createSession(spec));
    expect(err?.message).toMatch(/session sess_c4 already exists/);
    // The Pod (a peer's, or one still Terminating) and the PVC are untouched;
    // our own Secret is removed so it cannot 409 every future create.
    expect(calls.podDeleted).toBe(false);
    expect(calls.pvcDeleted).toBe(false);
    expect(calls.secretDeleted).toBe(1);
  });
});

// REGRESSION: destroySession swallowed a failed PVC delete, so the route
// answered destroyed:true while the user's data (and its storage) survived
// with no retry and no sweeper.
describe('KubernetesSessionBackend.destroySession — the workspace PVC delete is not laundered', () => {
  test('rejects when the PVC delete fails (after retrying a transient 500); Pod + Secret already gone', async () => {
    let pvcDeletes = 0;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const core = {
      deleteNamespacedPod: () => Promise.resolve({}),
      deleteNamespacedSecret: () => Promise.resolve({}),
      deleteNamespacedPersistentVolumeClaim: () => {
        pvcDeletes += 1;
        return Promise.reject(
          Object.assign(new Error('etcd leader changed'), { code: 500 }),
        );
      },
    } as unknown as CoreV1Api;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const networking = {} as unknown as NetworkingV1Api;
    const backend = new KubernetesSessionBackend(cfg, {
      core,
      networking,
      namespace: 'tale-sandbox',
    });
    const err = await rejection(backend.destroySession('sess_pvc'));
    expect(err?.message).toMatch(
      /failed to delete workspace PVC .* for sess_pvc/,
    );
    expect(pvcDeletes).toBe(3); // withRetry's attempts, then surfaced
  });

  test('an already-gone PVC (404) is success', async () => {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const core = {
      deleteNamespacedPod: () => Promise.resolve({}),
      deleteNamespacedSecret: () => Promise.resolve({}),
      deleteNamespacedPersistentVolumeClaim: () => notFound(),
    } as unknown as CoreV1Api;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const networking = {} as unknown as NetworkingV1Api;
    const backend = new KubernetesSessionBackend(cfg, {
      core,
      networking,
      namespace: 'tale-sandbox',
    });
    expect(await backend.destroySession('sess_pvc_gone')).toBe(true);
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
