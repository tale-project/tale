// Unit tests for the KubernetesBackend's pure sweep decisions and the
// duplicate-executionId (409) safety flow — the latter driven through a stub
// CoreV1Api so the ownership-flag guarantees ("a duplicate dispatch must not
// delete the live owner's pod/Secret") are pinned without a cluster.

import { describe, expect, test } from 'bun:test';

import type { CoreV1Api, V1Pod, V1Secret } from '@kubernetes/client-node';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { ExecuteRequest, SpawnerConfig } from '../../types.ts';
import type { ExecuteOptions, SweepOptions } from '../types.ts';
import { secretNameFor } from './exec-spec.ts';
import {
  HARVEST_BACKSTOP_MS,
  KubernetesBackend,
  STARTUP_BUDGET_MS,
  SWEEP_SLACK_MS,
  TERMINAL_REAP_GRACE_MS,
  shouldReapPod,
  shouldReapSecret,
  staleLifetimeCutoffMs,
} from './k8s-backend.ts';
import { podNameFor } from './k8s-pod-spec.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtimeTier: 'runc',
  dockerInContainer: false,
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

const NOW = 1_700_000_000_000;
const LIFETIME_MS =
  STARTUP_BUDGET_MS + cfg.maxTimeoutMs + HARVEST_BACKSTOP_MS + SWEEP_SLACK_MS;

function sweepOpts(live: string[] = []): SweepOptions {
  return {
    // cleanup.ts uses now - 2×maxTimeoutMs.
    staleBeforeMs: NOW - 2 * cfg.maxTimeoutMs,
    isLive: (id) => live.includes(id),
  };
}

function pod(over: {
  execId?: string;
  phase?: string;
  startedAt?: number;
  finishedAt?: number;
}): V1Pod {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- partial V1Pod fixture
  return {
    metadata: {
      name: 'tale-sbx-test',
      annotations: {
        'tale.dev/execution-id': over.execId ?? 'exec-1',
        ...(over.startedAt !== undefined && {
          'tale.dev/started-at': String(over.startedAt),
        }),
      },
    },
    status: {
      ...(over.phase !== undefined && { phase: over.phase }),
      ...(over.finishedAt !== undefined && {
        containerStatuses: [
          {
            name: 'harvest',
            state: { terminated: { finishedAt: new Date(over.finishedAt) } },
          },
        ],
      }),
    },
  } as V1Pod;
}

describe('shouldReapPod', () => {
  test('never reaps a locally-live execution, even terminal and old', () => {
    const p = pod({
      execId: 'live-1',
      phase: 'Succeeded',
      finishedAt: NOW - 10 * 60_000,
      startedAt: NOW - 60 * 60_000,
    });
    expect(shouldReapPod(p, sweepOpts(['live-1']), cfg, NOW)).toBe(false);
  });

  test('terminal + freshly finished is protected by the grace window', () => {
    // The owner is still reading the harvest logs in this window — reaping
    // here flips a completed run into HARVEST_READ_FAILED (the critical
    // review finding).
    const p = pod({
      phase: 'Succeeded',
      finishedAt: NOW - 5_000,
      startedAt: NOW - 6 * 60_000,
    });
    expect(shouldReapPod(p, sweepOpts(), cfg, NOW)).toBe(false);
  });

  test('terminal + finished past the grace is reaped', () => {
    const p = pod({
      phase: 'Succeeded',
      finishedAt: NOW - TERMINAL_REAP_GRACE_MS - 5_000,
      startedAt: NOW - 6 * 60_000,
    });
    expect(shouldReapPod(p, sweepOpts(), cfg, NOW)).toBe(true);
  });

  test('terminal without finishedAt falls back to the conservative stale rule', () => {
    const young = pod({ phase: 'Failed', startedAt: NOW - 60_000 });
    expect(shouldReapPod(young, sweepOpts(), cfg, NOW)).toBe(false);
    const old = pod({ phase: 'Failed', startedAt: NOW - LIFETIME_MS - 60_000 });
    expect(shouldReapPod(old, sweepOpts(), cfg, NOW)).toBe(true);
  });

  test('running pods are reaped only past the worst-case lifetime clamp', () => {
    // staleBeforeMs alone (2×maxTimeout = 600s) has ZERO slack over the
    // worst case (startup 180s + timeout 300s + backstop 120s = 600s) — the
    // clamp must win so a slow-but-live cross-replica run isn't reaped.
    const inWorstCase = pod({
      phase: 'Running',
      startedAt: NOW - 2 * cfg.maxTimeoutMs - 30_000, // past staleBeforeMs…
    });
    expect(shouldReapPod(inWorstCase, sweepOpts(), cfg, NOW)).toBe(false);
    const abandoned = pod({
      phase: 'Running',
      startedAt: NOW - LIFETIME_MS - 60_000,
    });
    expect(shouldReapPod(abandoned, sweepOpts(), cfg, NOW)).toBe(true);
  });

  test('running pod without a started-at annotation is never reaped (fail-safe)', () => {
    const p = pod({ phase: 'Running' });
    expect(shouldReapPod(p, sweepOpts(), cfg, NOW)).toBe(false);
  });

  test('staleLifetimeCutoffMs matches the documented worst case + slack', () => {
    expect(staleLifetimeCutoffMs(cfg, NOW)).toBe(NOW - LIFETIME_MS);
  });
});

describe('shouldReapSecret', () => {
  function secret(over: { execId?: string; startedAt?: number }): V1Secret {
    return {
      metadata: {
        name: 'tale-sbx-test-spec',
        annotations: {
          'tale.dev/execution-id': over.execId ?? 'exec-1',
          ...(over.startedAt !== undefined && {
            'tale.dev/started-at': String(over.startedAt),
          }),
        },
      },
    } as V1Secret;
  }

  test('live executions keep their Secret', () => {
    const s = secret({ execId: 'live-1', startedAt: NOW - LIFETIME_MS - 1 });
    expect(shouldReapSecret(s, sweepOpts(['live-1']), cfg, NOW)).toBe(false);
  });

  test('podless orphan past the lifetime clamp is reaped', () => {
    const s = secret({ startedAt: NOW - LIFETIME_MS - 60_000 });
    expect(shouldReapSecret(s, sweepOpts(), cfg, NOW)).toBe(true);
  });

  test('a young Secret and a legacy Secret (no started-at) are kept', () => {
    expect(
      shouldReapSecret(
        secret({ startedAt: NOW - 60_000 }),
        sweepOpts(),
        cfg,
        NOW,
      ),
    ).toBe(false);
    expect(shouldReapSecret(secret({}), sweepOpts(), cfg, NOW)).toBe(false);
  });
});

// ---- duplicate-executionId (409) safety -----------------------------------

const req: ExecuteRequest = {
  executionId: 'k74m9zr5b8jcgvx2pqfwsdyhntq3l1a0',
  organizationId: 'org_456',
  language: 'python',
  files: [],
  entryPath: 'main.py',
  outputUploadSlots: [],
  outputUrlEndpoint: 'http://platform/ep1',
  reportUploadedEndpoint: 'http://platform/ep2',
};

function execOpts(): ExecuteOptions {
  return { signal: new AbortController().signal, startedAtMs: Date.now() };
}

interface StubCalls {
  deletes: string[];
  replaces: number;
}

/** Minimal CoreV1Api stand-in; each field overrides one generated method. */
function stubClient(behavior: {
  createSecret?: () => Promise<unknown>;
  createPod?: () => Promise<unknown>;
  readPod?: () => Promise<V1Pod>;
  readLog?: () => Promise<string>;
}): { core: CoreV1Api; namespace: string; calls: StubCalls } {
  const calls: StubCalls = { deletes: [], replaces: 0 };
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- test stub
  const core = {
    createNamespacedSecret:
      behavior.createSecret ?? (() => Promise.resolve({})),
    createNamespacedPod: behavior.createPod ?? (() => Promise.resolve({})),
    readNamespacedPod:
      behavior.readPod ??
      (() => Promise.reject(Object.assign(new Error('404'), { code: 404 }))),
    readNamespacedPodLog: behavior.readLog ?? (() => Promise.resolve('')),
    replaceNamespacedSecret: () => {
      calls.replaces += 1;
      return Promise.resolve({});
    },
    deleteNamespacedPod: (p: { name: string }) => {
      calls.deletes.push(`pod:${p.name}`);
      return Promise.resolve({});
    },
    deleteNamespacedSecret: (p: { name: string }) => {
      calls.deletes.push(`secret:${p.name}`);
      return Promise.resolve({});
    },
    listNamespacedPod: () => Promise.resolve({ items: [] }),
    listNamespacedSecret: () => Promise.resolve({ items: [] }),
  } as unknown as CoreV1Api;
  return { core, namespace: 'tale-sandbox', calls };
}

function http409(): Promise<never> {
  return Promise.reject(Object.assign(new Error('conflict'), { code: 409 }));
}

describe('duplicate-executionId safety', () => {
  test("secret 409 + live young pod ⇒ fail WITHOUT touching the owner's resources", async () => {
    const stub = stubClient({
      createSecret: http409,
      readPod: () =>
        Promise.resolve(
          pod({ phase: 'Running', startedAt: Date.now() - 5_000 }),
        ),
    });
    const backend = new KubernetesBackend(cfg, stub);
    const res = await backend.execute(cfg, req, execOpts());
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('SPAWNER_UNAVAILABLE');
    expect(res.errorMessage).toContain('duplicate');
    expect(stub.calls.deletes).toEqual([]);
    expect(stub.calls.replaces).toBe(0);
  });

  test("pod-create 409 ⇒ fail WITHOUT cleanup (owner's finally will delete)", async () => {
    const stub = stubClient({ createPod: http409 });
    const backend = new KubernetesBackend(cfg, stub);
    const res = await backend.execute(cfg, req, execOpts());
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('SPAWNER_UNAVAILABLE');
    expect(res.errorMessage).toContain('another replica');
    expect(stub.calls.deletes).toEqual([]);
  });

  test('secret 409 + no pod (crashed prior attempt) ⇒ replace and proceed', async () => {
    // After the replace, the run proceeds: waitForRunnerStart sees the stage
    // initContainer failed ⇒ staging failure ⇒ SPAWNER_UNAVAILABLE carrying
    // the stage log tail, and the finally cleans up what THIS call created.
    let readCount = 0;
    const stub = stubClient({
      createSecret: http409,
      readPod: () => {
        readCount += 1;
        if (readCount === 1) {
          // createSecretChecked's probe: no pod.
          return Promise.reject(Object.assign(new Error('404'), { code: 404 }));
        }
        // waitForRunnerStart: stage initContainer failed.
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- partial V1Pod fixture
        return Promise.resolve({
          metadata: {},
          status: {
            initContainerStatuses: [
              {
                name: 'stage',
                state: { terminated: { exitCode: 1, reason: 'Error' } },
              },
            ],
          },
        } as V1Pod);
      },
      readLog: () =>
        Promise.resolve('workspace file fetch failed for main.py: HTTP 403'),
    });
    const backend = new KubernetesBackend(cfg, stub);
    const res = await backend.execute(cfg, req, execOpts());
    expect(stub.calls.replaces).toBe(1);
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('SPAWNER_UNAVAILABLE');
    expect(res.errorMessage).toContain('staging failed');
    // The real fetch error from the stage container's logs reaches the wire.
    expect(res.errorMessage).toContain('HTTP 403');
    // This call created the pod, so its finally cleans up both resources.
    expect(stub.calls.deletes).toContain(`pod:${podNameFor(req.executionId)}`);
    expect(stub.calls.deletes).toContain(
      `secret:${secretNameFor(req.executionId)}`,
    );
  });
});
