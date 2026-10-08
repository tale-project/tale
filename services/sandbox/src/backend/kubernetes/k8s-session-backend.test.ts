// Kubernetes lifecycle ownership and workspace preservation are exercised
// through a stub CoreV1Api, without requiring a cluster.

import { describe, expect, test } from 'bun:test';

import type {
  CoreV1Api,
  NetworkingV1Api,
  V1PersistentVolumeClaim,
  V1Pod,
} from '@kubernetes/client-node';

import { operationSignal } from '../../operation-budget.ts';
import { SessionRoutes } from '../../session/session-routes.ts';
import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import {
  SessionExistsError,
  SessionIncarnationChangedError,
  type SessionSpec,
} from '../types.ts';
import type { K8sClient } from './k8s-client.ts';
import { KubernetesSessionBackend } from './k8s-session-backend.ts';
import {
  sessionPodNameFor,
  sessionSecretNameFor,
  sessionWorkspacePvcNameFor,
} from './k8s-session-pod-spec.ts';

const cfg: SpawnerConfig = {
  instance: '',
  hub: null,
  deviceConfigPath: null,
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

describe('cancelled Kubernetes create', () => {
  test.each([true, false])(
    'cleans only acknowledged podless Secrets and preserves the PVC (acknowledged: %s)',
    async (acknowledged) => {
      const controller = new AbortController();
      const deletions: unknown[] = [];
      let pods = 0;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded CoreV1 test seam
      const core = {
        readNamespacedPersistentVolumeClaim: notFound,
        createNamespacedPersistentVolumeClaim: async () => ({}),
        createNamespacedSecret: async () => {
          controller.abort(new Error('caller cancelled'));
          return acknowledged ? { metadata: { uid: 'secret-uid' } } : {};
        },
        createNamespacedPod: async () => {
          pods++;
          return {};
        },
        readNamespacedPod: notFound,
        listNamespacedSecret: async () => ({
          items: [
            {
              metadata: {
                name: sessionSecretNameFor(spec.sessionId),
                uid: 'secret-uid',
                annotations: {
                  'tale.dev/created-at': String(spec.createdAtMs),
                },
              },
            },
          ],
        }),
        deleteNamespacedSecret: async (args: unknown) => {
          expect(operationSignal()?.aborted).toBe(false);
          deletions.push(args);
          return {};
        },
        deleteNamespacedPersistentVolumeClaim: async () => {
          throw new Error('must preserve workspace');
        },
      } as unknown as CoreV1Api;
      const base = stub(async () => ({}));
      const backend = new KubernetesSessionBackend(cfg, {
        ...base.client,
        core,
      });
      const error = await rejection(
        backend.createSession({ ...spec, signal: controller.signal }),
      );
      expect(error?.message).toBe('caller cancelled');
      expect(pods).toBe(0);
      expect(deletions).toEqual(
        acknowledged
          ? [
              {
                name: sessionSecretNameFor(spec.sessionId),
                namespace: cfg.k8s.namespace,
                body: { preconditions: { uid: 'secret-uid' } },
              },
            ]
          : [],
      );
    },
  );

  test.each(['acknowledged', 'ambiguous', 'replaced'])(
    'fences cancelled Pod cleanup by acknowledged UID with an independent budget (%s)',
    async (outcome) => {
      const controller = new AbortController();
      const deletions: Array<{ kind: string; body: unknown }> = [];
      const observedUid = outcome === 'replaced' ? 'peer-pod' : 'created-pod';
      let podDeleted = false;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded CoreV1 test seam
      const core = {
        readNamespacedPersistentVolumeClaim: notFound,
        createNamespacedPersistentVolumeClaim: async () => ({}),
        createNamespacedSecret: async () => ({
          metadata: { uid: 'created-secret' },
        }),
        createNamespacedPod: async () => {
          controller.abort(new Error('caller cancelled'));
          return outcome === 'ambiguous'
            ? {}
            : { metadata: { uid: 'created-pod' } };
        },
        readNamespacedPod: async () =>
          podDeleted
            ? notFound()
            : {
                metadata: {
                  uid: observedUid,
                  resourceVersion: '17',
                  annotations: {
                    'tale.dev/created-at': String(spec.createdAtMs),
                  },
                },
                status: { phase: 'Pending' },
              },
        listNamespacedSecret: async () => ({
          items: [
            {
              metadata: {
                name: sessionSecretNameFor(spec.sessionId),
                uid: 'created-secret',
                annotations: {
                  'tale.dev/created-at': String(spec.createdAtMs),
                },
              },
            },
          ],
        }),
        deleteNamespacedPod: async (args: { body: unknown }) => {
          expect(operationSignal()?.aborted).toBe(false);
          deletions.push({ kind: 'pod', body: args.body });
          podDeleted = true;
          return {};
        },
        deleteNamespacedSecret: async (args: { body: unknown }) => {
          expect(operationSignal()?.aborted).toBe(false);
          deletions.push({ kind: 'secret', body: args.body });
          return {};
        },
        deleteNamespacedPersistentVolumeClaim: async () => {
          throw new Error('must preserve workspace');
        },
      } as unknown as CoreV1Api;
      const base = stub(async () => ({}));
      const backend = new KubernetesSessionBackend(cfg, {
        ...base.client,
        core,
      });
      const error = await rejection(
        backend.createSession({ ...spec, signal: controller.signal }),
      );
      expect(error?.message).toBe('caller cancelled');
      expect(deletions).toEqual(
        outcome === 'acknowledged'
          ? [
              {
                kind: 'pod',
                body: {
                  preconditions: { uid: 'created-pod', resourceVersion: '17' },
                },
              },
              {
                kind: 'secret',
                body: { preconditions: { uid: 'created-secret' } },
              },
            ]
          : [],
      );
    },
  );
});

describe('Kubernetes session observation incarnation', () => {
  function observed(pod: V1Pod) {
    const calls = { reads: 0, mutations: 0 };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- read-only CoreV1 test seam
    const core = {
      async readNamespacedPod() {
        calls.reads += 1;
        return pod;
      },
      async deleteNamespacedPod() {
        calls.mutations += 1;
        throw new Error('observation must not delete compute');
      },
    } as unknown as CoreV1Api;
    return {
      backend: new KubernetesSessionBackend(cfg, {
        ...stub(async () => ({})).client,
        core,
      }),
      calls,
    };
  }

  const running = (): V1Pod => ({
    metadata: { annotations: { 'tale.dev/created-at': '2000' } },
    status: { phase: 'Running', podIP: '10.0.0.2' },
  });

  test('a replacement is live by name but cannot satisfy the previous incarnation', async () => {
    const { backend, calls } = observed(running());
    expect(await backend.sessionExists('replaced', 1000)).toBe(false);
    expect(await backend.sessionExists('replaced', 2000)).toBe(true);
    expect(await backend.sessionExists('replaced')).toBe(true);
    expect(calls).toEqual({ reads: 3, mutations: 0 });
  });

  test('endpoint resolution cannot combine a listed creation stamp with a replacement IP', async () => {
    const { backend, calls } = observed(running());
    expect(
      await rejection(backend.resolveEndpoint('replaced', 1000)),
    ).toBeInstanceOf(SessionIncarnationChangedError);
    expect(await backend.resolveEndpoint('replaced', 2000)).toBe(
      'http://10.0.0.2:8200',
    );
    expect(calls).toEqual({ reads: 2, mutations: 0 });
  });

  test('missing incarnation metadata is unknown, not definitive absence', async () => {
    const pod = running();
    pod.metadata = {};
    const { backend } = observed(pod);
    expect(await rejection(backend.sessionExists('legacy', 0))).toBeInstanceOf(
      Error,
    );
    expect(await backend.sessionExists('legacy')).toBe(true);
  });

  test.each(['', ' ', 'unreadable'])(
    'stamp %j cannot be interpreted as a verified incarnation',
    async (stamp) => {
      const pod = running();
      pod.metadata = { annotations: { 'tale.dev/created-at': stamp } };
      const { backend } = observed(pod);
      expect(
        await rejection(backend.sessionExists('unknown', 0)),
      ).toBeInstanceOf(Error);
      expect(
        await rejection(backend.resolveEndpoint('unknown', 0)),
      ).toBeInstanceOf(Error);
      expect(await backend.sessionExists('unknown')).toBe(true);
    },
  );
});

describe('abandoned Kubernetes startup recovery', () => {
  const stamp = Date.now() - 600_000;
  const pending = (): V1Pod => ({
    metadata: {
      uid: 'pending-original',
      resourceVersion: '17',
      creationTimestamp: new Date(stamp),
      annotations: {
        'tale.dev/created-at': String(stamp),
        'tale.dev/startup-deadline': String(
          stamp + cfg.session.createHealthTimeoutMs,
        ),
      },
    },
    status: { phase: 'Pending' },
  });

  function fixture(pod: V1Pod, changed = false, terminates = true) {
    let gone = false;
    const deletions: Array<{ kind: string; body?: unknown }> = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded CoreV1 test seam
    const core = {
      readNamespacedPod: async () => (gone ? notFound() : pod),
      listNamespacedSecret: async () => ({
        items: [
          {
            metadata: {
              name: sessionSecretNameFor('pending'),
              uid: 'secret-original',
              annotations: { 'tale.dev/created-at': String(stamp) },
            },
          },
        ],
      }),
      deleteNamespacedPod: async (args: { body: unknown }) => {
        deletions.push({ kind: 'pod', body: args.body });
        if (changed)
          throw Object.assign(new Error('phase or incarnation changed'), {
            code: 409,
          });
        gone = terminates;
      },
      deleteNamespacedSecret: async (args: { body: unknown }) => {
        deletions.push({ kind: 'secret', body: args.body });
      },
      deleteNamespacedPersistentVolumeClaim: async () => {
        throw new Error('workspace must survive');
      },
    } as unknown as CoreV1Api;
    return {
      backend: new KubernetesSessionBackend(cfg, {
        ...stub(async () => ({})).client,
        core,
      }),
      deletions,
    };
  }

  test('stops only an old Pending incarnation, fences its observed state and preserves its PVC', async () => {
    const { backend, deletions } = fixture(pending());
    expect(await backend.reapStaleSession('pending', stamp)).toBe(true);
    expect(deletions).toEqual([
      {
        kind: 'pod',
        body: {
          preconditions: { uid: 'pending-original', resourceVersion: '17' },
        },
      },
      { kind: 'secret', body: { preconditions: { uid: 'secret-original' } } },
    ]);
  });

  test.each(['Running', 'Unknown', 'Succeeded', undefined])(
    'leaves phase %s untouched',
    async (phase) => {
      const pod = pending();
      pod.status = { phase };
      const { backend, deletions } = fixture(pod);
      expect(await backend.reapStaleSession('pending', stamp)).toBe(false);
      expect(deletions).toEqual([]);
    },
  );

  test('the server creation timestamp protects a recent peer carrying an old caller stamp', async () => {
    const pod = pending();
    pod.metadata!.creationTimestamp = new Date();
    const { backend, deletions } = fixture(pod);
    expect(await backend.reapStaleSession('pending', stamp)).toBe(false);
    expect(deletions).toEqual([]);
  });

  test('honors the original creator deadline across configuration changes', async () => {
    const pod = pending();
    pod.metadata!.annotations!['tale.dev/startup-deadline'] = String(
      Date.now() + 600_000,
    );
    const { backend, deletions } = fixture(pod);
    expect(await backend.reapStaleSession('pending', stamp)).toBe(false);
    expect(deletions).toEqual([]);
  });

  test('a legacy Pod without a recorded deadline receives a conservative grace', async () => {
    const pod = pending();
    delete pod.metadata!.annotations!['tale.dev/startup-deadline'];
    const { backend, deletions } = fixture(pod);
    expect(await backend.reapStaleSession('pending', stamp)).toBe(false);
    expect(deletions).toEqual([]);
  });

  test('a Pod that changed after observation keeps its Secret', async () => {
    const { backend, deletions } = fixture(pending(), true);
    expect(await backend.reapStaleSession('pending', stamp)).toBe(false);
    expect(deletions.map((item) => item.kind)).toEqual(['pod']);
  });

  test('a replacement incarnation is never stopped', async () => {
    const { backend, deletions } = fixture(pending());
    expect(await backend.reapStaleSession('pending', stamp - 1)).toBe(false);
    expect(deletions).toEqual([]);
  });

  test('a terminating Pod keeps its occupancy until disappearance is confirmed', async () => {
    const { backend } = fixture(pending(), false, false);
    expect(await backend.reapStaleSession('pending', stamp)).toBe(false);
  });
});

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
      'incarnation changed',
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
  pvcReads: number;
  pvcCreated: boolean;
  pvcDeleted: boolean;
  podDeleted: boolean;
  secretDeleted: number;
}

/** Stub CoreV1Api for a FRESH create (no pre-existing PVC): the PVC reads 404,
 * its create succeeds, and the Secret/Pod creates are supplied by the test. */

describe('Kubernetes destroy of a stopped session', () => {
  test("answers true for a stopped session's workspace claim alone", async () => {
    // No Pod any more (the reaper stopped it), only the workspace PVC: its
    // deletion is the destroy, not "nothing existed".
    const base = stub(async () => ({}));
    Object.assign(base.client.core, {
      deleteNamespacedPod: () => notFound(),
      deleteNamespacedSecret: () => notFound(),
    });
    const backend = new KubernetesSessionBackend(cfg, base.client);
    expect(await backend.destroySession('stopped-k8s')).toBe(true);
    expect(base.calls.pvcDeleted).toBe(true);
  });

  test('answers false when neither a Pod nor a claim is left', async () => {
    const base = stub(async () => ({}));
    Object.assign(base.client.core, {
      deleteNamespacedPod: () => notFound(),
      deleteNamespacedSecret: () => notFound(),
      deleteNamespacedPersistentVolumeClaim: () => notFound(),
    });
    const backend = new KubernetesSessionBackend(cfg, base.client);
    expect(await backend.destroySession('gone-k8s')).toBe(false);
  });

  test("states its own deletion contract: the volume handed to its provisioner, never Docker's done", async () => {
    // An answer without a deletion state reads as a spawner older than the
    // contract (unconfirmed), so this backend says what its destroy did.
    const base = stub(async () => ({}));
    Object.assign(base.client.core, {
      deleteNamespacedPod: () => notFound(),
      deleteNamespacedSecret: () => notFound(),
    });
    const backend = new KubernetesSessionBackend(cfg, base.client);
    const routes = new SessionRoutes(cfg, backend);
    const res = await routes.handleDestroy('stopped-k8s', {
      awaitDeletion: true,
    });
    expect(await res.json()).toEqual({
      destroyed: true,
      busy: false,
      deletion: 'handed_off',
    });
    expect(await backend.workspaceDeletion()).toBe('handed_off');
  });
});

function stub(
  createSecret: () => Promise<unknown>,
  createPod: () => Promise<unknown> = () => Promise.resolve({}),
  existing: {
    /** The Secret a `list` by name finds (none: an empty list). */
    secret?: { uid: string; createdAt: Date; createdAtMs?: number };
    /** What reading the Pod returns (none: 404). */
    pod?: object;
    /** The bodies Secret deletes were sent with. */
    secretDeletes?: unknown[];
  } = {},
): {
  client: K8sClient;
  calls: Calls;
} {
  const calls: Calls = {
    pvcReads: 0,
    pvcCreated: false,
    pvcDeleted: false,
    podDeleted: false,
    secretDeleted: 0,
  };
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const core = {
    readNamespacedPersistentVolumeClaim: () => {
      calls.pvcReads += 1;
      return notFound();
    },
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
    readNamespacedPod: () =>
      existing.pod === undefined ? notFound() : Promise.resolve(existing.pod),
    listNamespacedSecret: (request: { fieldSelector?: string }) =>
      Promise.resolve({
        items:
          existing.secret === undefined
            ? []
            : [
                {
                  metadata: {
                    name: request.fieldSelector?.replace('metadata.name=', ''),
                    uid: existing.secret.uid,
                    creationTimestamp: existing.secret.createdAt,
                    ...(existing.secret.createdAtMs === undefined
                      ? {}
                      : {
                          annotations: {
                            'tale.dev/created-at': String(
                              existing.secret.createdAtMs,
                            ),
                          },
                        }),
                  },
                },
              ],
      }),
    deleteNamespacedPod: () => {
      calls.podDeleted = true;
      return Promise.resolve({});
    },
    deleteNamespacedSecret: (request: { body?: unknown }) => {
      calls.secretDeleted += 1;
      existing.secretDeletes?.push(request.body);
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
        return Promise.resolve({
          metadata: { uid: 'terminal-original', resourceVersion: '8' },
          status: { phase: podPhase },
        });
      }
      log.push('readPod:gone');
      return notFound();
    },
    deleteNamespacedPod: () => {
      log.push('deletePod');
      return Promise.resolve({});
    },
    listNamespacedSecret: () => Promise.resolve({ items: [] }),
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

describe('KubernetesSessionBackend.createSession — PVC preservation on Secret failure', () => {
  test('a fresh-create Secret failure preserves the workspace PVC for retry', async () => {
    // Even a fresh deterministic PVC can already be in use by a peer.
    const { client, calls } = stub(badRequest);
    const backend = new KubernetesSessionBackend(cfg, client);

    expect(await rejection(backend.createSession(spec))).not.toBeNull();

    // Only an explicit destroy removes workspace data.
    expect(calls.pvcCreated).toBe(true);
    expect(calls.pvcDeleted).toBe(false);
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
    const { client, calls } = stub(
      () => Promise.resolve({ metadata: { uid: 'own-secret' } }),
      conflict,
    );
    const backend = new KubernetesSessionBackend(cfg, client);
    const err = await rejection(backend.createSession(spec));
    expect(err?.message).toMatch(/session sess_c4 already exists/);
    // The Pod (a peer's, or one still Terminating) and the PVC are untouched;
    // our own Secret is removed so it cannot 409 every future create.
    expect(calls.podDeleted).toBe(false);
    expect(calls.pvcDeleted).toBe(false);
    expect(calls.secretDeleted).toBe(1);
  });

  // A live Pod under the name is a session the route answers as a duplicate,
  // so the platform adopts it rather than cleaning up after a failed create.
  test.each(['Running', 'Pending'])(
    'Pod 409 against a live %s Pod: a live duplicate, nothing of it removed',
    async (phase) => {
      const { client, calls } = stub(
        () => Promise.resolve({ metadata: { uid: 'own-secret' } }),
        conflict,
        {
          pod: {
            metadata: { annotations: { 'tale.dev/created-at': '1' } },
            status: { phase },
          },
        },
      );
      const err = await rejection(
        new KubernetesSessionBackend(cfg, client).createSession(spec),
      );
      expect(err).toBeInstanceOf(SessionExistsError);
      expect(err?.message).toMatch(/session sess_c4 already exists/);
      expect(calls.podDeleted).toBe(false);
      expect(calls.pvcDeleted).toBe(false);
      expect(calls.secretDeleted).toBe(1);
    },
  );

  test('Secret 409 beside a live Pod: a live duplicate, nothing deleted', async () => {
    const { client, calls } = stub(conflict, undefined, {
      secret: { uid: 'peer-uid', createdAt: new Date(Date.now() - 600_000) },
      pod: { metadata: {}, status: { phase: 'Running' } },
    });
    const err = await rejection(
      new KubernetesSessionBackend(cfg, client).createSession(spec),
    );
    expect(err).toBeInstanceOf(SessionExistsError);
    expect(calls.secretDeleted).toBe(0);
    expect(calls.podDeleted).toBe(false);
  });

  test('Pod 409 against a terminating or ended Pod stays a failed create', async () => {
    for (const pod of [
      { metadata: { deletionTimestamp: new Date() }, status: {} },
      { metadata: {}, status: { phase: 'Succeeded' } },
      { metadata: {}, status: { phase: 'Failed' } },
    ]) {
      const { client } = stub(
        () => Promise.resolve({ metadata: { uid: 'own-secret' } }),
        conflict,
        { pod },
      );
      const err = await rejection(
        new KubernetesSessionBackend(cfg, client).createSession(spec),
      );
      expect(err).not.toBeInstanceOf(SessionExistsError);
      expect(err?.message).toMatch(/session sess_c4 already exists/);
    }
  });
});

describe('KubernetesSessionBackend.createSession — a render session has no volume', () => {
  test('a default-profile create provisions no PVC and reads none', async () => {
    const { client, calls } = stub(
      () => Promise.resolve({}),
      () => Promise.reject(Object.assign(new Error('halt'), { code: 400 })),
    );
    const err = await rejection(
      new KubernetesSessionBackend(cfg, client).createSession({
        ...spec,
        profile: 'default',
      }),
    );
    expect(err?.message).toBe('halt');
    expect(calls.pvcReads).toBe(0);
    expect(calls.pvcCreated).toBe(false);
  });
});

describe('KubernetesSessionBackend.createSession — an orphaned Secret or a Pod of its own', () => {
  const named = (secret: { uid: string; createdAt: Date }) => secret;

  test('a Secret no Pod holds, older than a create, is removed by its UID and the create goes on', async () => {
    let secretCreates = 0;
    const secretDeletes: unknown[] = [];
    const { client } = stub(
      () => {
        secretCreates += 1;
        return secretCreates === 1 ? conflict() : Promise.resolve({});
      },
      // Halt before the readiness wait (no runnerd in a unit test).
      () => Promise.reject(Object.assign(new Error('halt'), { code: 400 })),
      {
        secret: named({
          uid: 'orphan-uid',
          createdAt: new Date(Date.now() - 600_000),
        }),
        secretDeletes,
      },
    );
    const err = await rejection(
      new KubernetesSessionBackend(cfg, client).createSession(spec),
    );
    expect(err?.message).toBe('halt');
    expect(secretCreates).toBe(2);
    expect(secretDeletes[0]).toEqual({ preconditions: { uid: 'orphan-uid' } });
  });

  test("a young Pod-less Secret is a peer's create in flight: a conflict, nothing deleted", async () => {
    const { client, calls } = stub(conflict, undefined, {
      secret: named({ uid: 'peer-uid', createdAt: new Date() }),
    });
    const err = await rejection(
      new KubernetesSessionBackend(cfg, client).createSession(spec),
    );
    expect(err?.message).toMatch(/session sess_c4 already exists/);
    expect(calls.secretDeleted).toBe(0);
    expect(calls.podDeleted).toBe(false);
  });

  test("a Secret 409 on this create's own Secret, stored by a timed-out first attempt, goes on to the Pod", async () => {
    let podCreates = 0;
    const { client, calls } = stub(
      conflict,
      () => {
        podCreates += 1;
        // Halt before the readiness wait (no runnerd in a unit test).
        return Promise.reject(Object.assign(new Error('halt'), { code: 400 }));
      },
      {
        secret: {
          uid: 'own-uid',
          createdAt: new Date(),
          createdAtMs: spec.createdAtMs,
        },
      },
    );
    const err = await rejection(
      new KubernetesSessionBackend(cfg, client).createSession(spec),
    );
    expect(err?.message).toBe('halt');
    expect(podCreates).toBe(1);
    expect(err?.message).not.toMatch(/already exists/);
    // The first response was lost: a matching timestamp permits retry, but
    // without an acknowledged UID cleanup leaves the Secret to recovery.
    expect(calls.secretDeleted).toBe(0);
  });

  test("a Pod 409 on this create's own Pod keeps its Secret and waits for readiness", async () => {
    const { client } = stub(() => Promise.resolve({}), conflict, {
      pod: {
        metadata: {
          annotations: { 'tale.dev/created-at': String(spec.createdAtMs) },
        },
        status: { phase: 'Pending' },
      },
    });
    const quick = {
      ...cfg,
      session: { ...cfg.session, createHealthTimeoutMs: 200 },
    };
    const err = await rejection(
      new KubernetesSessionBackend(quick, client).createSession(spec),
    );
    // It went on to the readiness wait instead of reporting a conflict.
    expect(err).not.toBeNull();
    expect(err?.message).not.toMatch(/already exists/);
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
  test('a pin write fences the observed Pod and refuses a replaced incarnation', async () => {
    const patches: unknown[] = [];
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const core = {
      readNamespacedPod: async () => ({
        metadata: {
          uid: 'original',
          resourceVersion: '7',
          annotations: { 'tale.dev/created-at': '123' },
        },
      }),
      patchNamespacedPod: async (request: { body: unknown }) => {
        patches.push(request.body);
        return {};
      },
    } as unknown as CoreV1Api;
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
    const networking = {} as NetworkingV1Api;
    const backend = new KubernetesSessionBackend(cfg, {
      core,
      networking,
      namespace: 'tale-sandbox',
    });
    await backend.setPinned('fenced-pin', true, 123);
    expect(patches).toEqual([
      {
        metadata: {
          uid: 'original',
          resourceVersion: '7',
          annotations: { 'tale.dev/pinned': 'true' },
        },
      },
    ]);
    let rejected = false;
    try {
      await backend.setPinned('fenced-pin', false, 456);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(patches).toHaveLength(1);
  });

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
  test('reports the actual Docker capability while preserving unlabeled legacy objects', async () => {
    const backend = backendOver({
      listNamespacedPod: async () => ({
        items: ['true', 'false', undefined].map((value, index) => ({
          metadata: {
            annotations: {
              'tale.dev/session-id': `capability-${index}`,
              'tale.dev/profile': 'agent',
              ...(value === undefined ? {} : { 'tale.dev/docker': value }),
            },
          },
          status: { phase: 'Running' },
        })),
      }),
    });
    expect((await backend.listSessions()).map((s) => s.docker)).toEqual([
      true,
      false,
      undefined,
    ]);
  });

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

/** A backend over a CoreV1Api stub that answers only the calls it names. */
function backendOver(
  core: Partial<Record<keyof CoreV1Api, unknown>>,
): KubernetesSessionBackend {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const api = core as unknown as CoreV1Api;
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const networking = {} as unknown as NetworkingV1Api;
  return new KubernetesSessionBackend(cfg, {
    core: api,
    networking,
    namespace: 'tale-sandbox',
  });
}

function workspaceClaim(
  annotations: Record<string, string>,
  createdAt: string,
): V1PersistentVolumeClaim {
  return {
    metadata: {
      labels: { 'tale.sandbox-session-ws': '1' },
      annotations,
      creationTimestamp: new Date(createdAt),
    },
  };
}

function sessionPod(
  sessionId: string,
  phase: string,
  annotations: Record<string, string> = {},
): V1Pod {
  return {
    metadata: {
      annotations: {
        'tale.dev/session-id': sessionId,
        'tale.dev/profile': 'agent',
        'tale.dev/created-at': '1700000000000',
        ...annotations,
      },
    },
    status: { phase },
  };
}

// The Kubernetes half of the platform's workspace cleanup. The platform
// destroys only a workspace this list names and its records disown, so a PVC
// that cannot be read as a session's is left out, and `active` must never read
// false for a Pod that still runs or is still starting.
describe('KubernetesSessionBackend.listWorkspaces', () => {
  test('joins every workspace PVC with the session Pod beside it', async () => {
    const pvcQueries: unknown[] = [];
    const backend = backendOver({
      listNamespacedPersistentVolumeClaim: (param: unknown) => {
        pvcQueries.push(param);
        return Promise.resolve({
          items: [
            // Made before PVCs recorded their organization: the Pod names it.
            workspaceClaim(
              { 'tale.dev/session-id': 'ws-running' },
              '2026-09-01T08:00:00.000Z',
            ),
            workspaceClaim(
              {
                'tale.dev/session-id': 'ws-stopped',
                'tale.dev/organization-id': 'org_pvc',
              },
              '2026-09-02T08:00:00.000Z',
            ),
            // Its Pod records no organization: the PVC's annotation names it.
            workspaceClaim(
              {
                'tale.dev/session-id': 'ws-starting',
                'tale.dev/organization-id': 'org_pvc',
              },
              '2026-09-03T08:00:00.000Z',
            ),
            workspaceClaim(
              {
                'tale.dev/session-id': 'ws-failed',
                'tale.dev/organization-id': 'org_pvc',
              },
              '2026-09-04T08:00:00.000Z',
            ),
            workspaceClaim(
              {
                'tale.dev/session-id': 'ws-succeeded',
                'tale.dev/organization-id': 'org_pvc',
              },
              '2026-09-05T08:00:00.000Z',
            ),
            // Neither the PVC nor a Pod records an organization.
            workspaceClaim(
              { 'tale.dev/session-id': 'ws-orphan' },
              '2026-09-06T08:00:00.000Z',
            ),
            // Not workspaces this spawner made.
            workspaceClaim({}, '2026-09-07T08:00:00.000Z'),
            workspaceClaim(
              { 'tale.dev/session-id': 'not a session id' },
              '2026-09-08T08:00:00.000Z',
            ),
          ],
        });
      },
      listNamespacedPod: () =>
        Promise.resolve({
          items: [
            sessionPod('ws-running', 'Running', {
              'tale.dev/organization-id': 'org_pod',
              'tale.dev/pinned': 'true',
            }),
            sessionPod('ws-starting', 'Pending'),
            sessionPod('ws-failed', 'Failed', {
              'tale.dev/organization-id': 'org_pvc',
            }),
            sessionPod('ws-succeeded', 'Succeeded', {
              'tale.dev/organization-id': 'org_pvc',
            }),
            // A Pod without a workspace PVC is not a workspace.
            sessionPod('no-claim', 'Running', {
              'tale.dev/organization-id': 'org_pod',
            }),
          ],
        }),
    });

    expect(await backend.listWorkspaces()).toStrictEqual([
      {
        sessionId: 'ws-running',
        touchedAtMs: Date.parse('2026-09-01T08:00:00.000Z'),
        active: true,
        pinned: true,
        organizationId: 'org_pod',
      },
      {
        sessionId: 'ws-stopped',
        touchedAtMs: Date.parse('2026-09-02T08:00:00.000Z'),
        active: false,
        pinned: false,
        organizationId: 'org_pvc',
      },
      {
        sessionId: 'ws-starting',
        touchedAtMs: Date.parse('2026-09-03T08:00:00.000Z'),
        active: true,
        pinned: false,
        organizationId: 'org_pvc',
      },
      {
        sessionId: 'ws-failed',
        touchedAtMs: Date.parse('2026-09-04T08:00:00.000Z'),
        active: false,
        pinned: false,
        organizationId: 'org_pvc',
      },
      {
        sessionId: 'ws-succeeded',
        touchedAtMs: Date.parse('2026-09-05T08:00:00.000Z'),
        active: false,
        pinned: false,
        organizationId: 'org_pvc',
      },
      {
        sessionId: 'ws-orphan',
        touchedAtMs: Date.parse('2026-09-06T08:00:00.000Z'),
        active: false,
        pinned: false,
      },
    ]);
    expect(pvcQueries).toEqual([
      { namespace: 'tale-sandbox', labelSelector: 'tale.sandbox-session-ws=1' },
    ]);
  });

  test('THROWS when the workspace PVCs cannot be listed, once the client retries are spent', async () => {
    let attempts = 0;
    let podLists = 0;
    const backend = backendOver({
      // Retryable: withRetry makes all three attempts before giving up.
      listNamespacedPersistentVolumeClaim: () => {
        attempts += 1;
        return Promise.reject(
          Object.assign(new Error('apiserver unavailable'), { code: 503 }),
        );
      },
      listNamespacedPod: () => {
        podLists += 1;
        return Promise.resolve({ items: [] });
      },
    });
    expect((await rejection(backend.listWorkspaces()))?.message).toBe(
      'apiserver unavailable',
    );
    expect(attempts).toBe(3);
    expect(podLists).toBe(0);
  });

  test('THROWS when the session Pods cannot be listed, instead of reading every workspace as inactive', async () => {
    const backend = backendOver({
      listNamespacedPersistentVolumeClaim: () =>
        Promise.resolve({
          items: [
            workspaceClaim(
              {
                'tale.dev/session-id': 'ws-live',
                'tale.dev/organization-id': 'org_live',
              },
              '2026-09-01T08:00:00.000Z',
            ),
          ],
        }),
      // 403 is non-retryable, so the failure surfaces at once.
      listNamespacedPod: () =>
        Promise.reject(Object.assign(new Error('forbidden'), { code: 403 })),
    });
    expect((await rejection(backend.listWorkspaces()))?.message).toBe(
      'forbidden',
    );
  });
});

describe('KubernetesSessionBackend.createSession — the workspace PVC names its owner', () => {
  test('a fresh PVC records its session and organization, which the inventory reads back while no Pod runs', async () => {
    const created: V1PersistentVolumeClaim[] = [];
    // A definitive Secret failure halts the create right after the PVC.
    const base = stub(badRequest);
    base.client.core.createNamespacedPersistentVolumeClaim = async (param: {
      body: V1PersistentVolumeClaim;
    }) => {
      created.push(param.body);
      return param.body;
    };
    const backend = new KubernetesSessionBackend(cfg, base.client);
    expect(await rejection(backend.createSession(spec))).not.toBeNull();

    expect(created.map((claim) => claim.metadata)).toEqual([
      {
        name: sessionWorkspacePvcNameFor(spec.sessionId),
        labels: { 'tale.sandbox-session-ws': '1' },
        annotations: {
          'tale.dev/session-id': spec.sessionId,
          'tale.dev/organization-id': spec.organizationId,
        },
      },
    ]);

    // The apiserver stamps what it stores with its creation time.
    const createdAt = new Date('2026-09-30T12:00:00.000Z');
    for (const claim of created) {
      if (claim.metadata) claim.metadata.creationTimestamp = createdAt;
    }
    base.client.core.listNamespacedPersistentVolumeClaim = async () => ({
      items: created,
    });
    base.client.core.listNamespacedPod = async () => ({ items: [] });
    expect(await backend.listWorkspaces()).toStrictEqual([
      {
        sessionId: spec.sessionId,
        touchedAtMs: createdAt.getTime(),
        active: false,
        pinned: false,
        organizationId: spec.organizationId,
      },
    ]);
  });
});

describe('Kubernetes failed-create identity fencing', () => {
  test.each([
    'own',
    'peer-before-read',
    'peer-after-read',
    'unknown-create',
  ] as const)(
    'readiness cleanup preserves workspace and respects %s ownership',
    async (scenario) => {
      const deletions: Array<{ kind: string; body?: unknown }> = [];
      const pod: V1Pod = { metadata: { uid: 'own-pod', resourceVersion: '7' } };
      let currentUid = scenario === 'peer-before-read' ? 'peer-pod' : 'own-pod';
      let reads = 0;
      const base = stub(async () => ({ metadata: { uid: 'own-secret' } }));
      base.client.core.createNamespacedPod = async () => {
        if (scenario === 'unknown-create')
          throw Object.assign(new Error('reply lost'), { code: 400 });
        return pod;
      };
      base.client.core.readNamespacedPod = async () => {
        reads += 1;
        if (reads === 1 && scenario !== 'unknown-create')
          throw Object.assign(new Error('readiness unavailable'), {
            code: 400,
          });
        const observed = {
          metadata: { uid: currentUid, resourceVersion: '7' },
        };
        if (scenario === 'peer-after-read') currentUid = 'peer-pod';
        return observed;
      };
      base.client.core.deleteNamespacedPod = async (args) => {
        deletions.push({ kind: 'pod', body: args.body });
        if (args.body?.preconditions?.uid !== currentUid)
          throw Object.assign(new Error('replacement'), { code: 409 });
        return {};
      };
      base.client.core.deleteNamespacedSecret = async (args) => {
        deletions.push({ kind: 'secret', body: args.body });
        return {};
      };
      expect(
        await rejection(
          new KubernetesSessionBackend(cfg, base.client).createSession(spec),
        ),
      ).not.toBeNull();
      expect(base.calls.pvcDeleted).toBe(false);
      if (scenario === 'own') {
        expect(deletions).toEqual([
          {
            kind: 'pod',
            body: { preconditions: { uid: 'own-pod', resourceVersion: '7' } },
          },
          { kind: 'secret', body: { preconditions: { uid: 'own-secret' } } },
        ]);
      } else if (scenario === 'peer-after-read') {
        expect(deletions).toEqual([
          {
            kind: 'pod',
            body: { preconditions: { uid: 'own-pod', resourceVersion: '7' } },
          },
        ]);
      } else expect(deletions).toEqual([]);
    },
  );

  test('a Pod conflict cannot delete a replacement Secret under the same name', async () => {
    const { client, calls } = stub(
      async () => ({ metadata: { uid: 'own-secret' } }),
      conflict,
    );
    const fences: unknown[] = [];
    let peerSecretAlive = true;
    client.core.deleteNamespacedSecret = async (args) => {
      fences.push(args.body);
      if (args.body?.preconditions?.uid !== 'peer-secret')
        throw Object.assign(new Error('replacement'), { code: 409 });
      peerSecretAlive = false;
      return {};
    };
    const error = await rejection(
      new KubernetesSessionBackend(cfg, client).createSession(spec),
    );
    expect(error?.message).toContain('already exists');
    expect(fences).toEqual([{ preconditions: { uid: 'own-secret' } }]);
    expect(peerSecretAlive).toBe(true);
    expect(calls.pvcDeleted).toBe(false);
  });
});

describe('Kubernetes terminal recovery identity fencing', () => {
  test('a peer replacing an observed terminal Pod survives the cleanup verdict', async () => {
    const { client } = resumeStub('Failed');
    const deletions: Array<{ kind: string; body?: unknown }> = [];
    let reads = 0;
    let peerAlive = true;
    client.core.readNamespacedPod = async () => {
      if (++reads > 1) return notFound();
      return {
        metadata: { uid: 'terminal-original', resourceVersion: '8' },
        status: { phase: 'Failed' },
      };
    };
    client.core.listNamespacedSecret = async () => ({
      items: [
        {
          metadata: {
            name: sessionSecretNameFor(spec.sessionId),
            uid: 'terminal-secret',
          },
        },
      ],
    });
    client.core.deleteNamespacedPod = async (args) => {
      deletions.push({ kind: 'pod', body: args.body });
      if (args.body?.preconditions?.uid !== undefined)
        throw Object.assign(new Error('replacement'), { code: 409 });
      peerAlive = false;
      return {};
    };
    client.core.deleteNamespacedSecret = async (args) => {
      deletions.push({ kind: 'secret', body: args.body });
      return {};
    };
    expect(
      await rejection(
        new KubernetesSessionBackend(cfg, client).createSession(spec),
      ),
    ).not.toBeNull();
    expect(peerAlive).toBe(true);
    expect(deletions).toEqual([
      {
        kind: 'pod',
        body: {
          preconditions: { uid: 'terminal-original', resourceVersion: '8' },
        },
      },
    ]);
  });

  test('a replacement Secret observed beside a terminal Pod keeps both objects', async () => {
    const { client } = resumeStub('Failed');
    let deletes = 0;
    let reads = 0;
    client.core.readNamespacedPod = async () => {
      if (++reads > 1) return notFound();
      return {
        metadata: {
          uid: 'terminal-original',
          resourceVersion: '8',
          annotations: { 'tale.dev/created-at': '1000' },
        },
        status: { phase: 'Failed' },
      };
    };
    client.core.listNamespacedSecret = async () => ({
      items: [
        {
          metadata: {
            name: sessionSecretNameFor(spec.sessionId),
            uid: 'peer-secret',
            annotations: { 'tale.dev/created-at': '2000' },
          },
        },
      ],
    });
    client.core.deleteNamespacedPod = async () => {
      deletes += 1;
      return {};
    };
    client.core.deleteNamespacedSecret = async () => {
      deletes += 1;
      return {};
    };
    expect(
      await rejection(
        new KubernetesSessionBackend(cfg, client).createSession(spec),
      ),
    ).not.toBeNull();
    expect(deletes).toBe(0);
  });
});
