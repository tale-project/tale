// KubernetesBackend — runs each execution as a Pod (Helm deployment target).
//
// The spawner stays the trusted broker: it stages inputs into a local dir,
// tars them INTO the runtime Pod's /workspace via a holder sidecar, follows
// the runner's logs, reaps the exit code from Pod status, tars /workspace/output
// back OUT into the local dir, and only THEN does spawn.ts run its existing
// (unchanged) harvest/upload/attestation logic. SANDBOX_TOKEN, output byte
// caps, and input attestation never enter the Pod. All streaming primitives
// were validated live against kind under Bun (see k8s-client.ts).

import { join } from 'node:path';

import type { V1Pod } from '@kubernetes/client-node';

import type { SpawnerConfig } from '../../types.ts';
import type {
  CacheStores,
  ExecutionBackend,
  HealthResult,
  LaunchSpec,
  RunningExecution,
  RunOptions,
  RunResult,
  SweepOptions,
  Workspace,
} from '../types.ts';
import { cacheStoreNames, ensureCachePvcs } from './k8s-cache.ts';
import {
  execReadFile,
  execTarIn,
  execTarOut,
  followLogs,
  makeK8sClient,
  runExec,
  withExecRetry,
  type K8sClient,
} from './k8s-client.ts';
import { buildSandboxPod, podNameFor } from './k8s-pod-spec.ts';
import { K8sWorkspace } from './k8s-workspace.ts';

// Max time to wait for a runtime Pod to reach Running before giving up (covers
// scheduling + a cold image pull, since warmImage is a no-op on K8s).
const STARTUP_BUDGET_MS = 180_000;
const POLL_INTERVAL_MS = 700;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function httpStatusCode(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = err.code;
    return typeof c === 'number' ? c : undefined;
  }
  return undefined;
}

async function deletePod(client: K8sClient, name: string): Promise<void> {
  try {
    await client.core.deleteNamespacedPod({
      name,
      namespace: client.namespace,
      gracePeriodSeconds: 0,
    });
  } catch (err) {
    // 404 = already gone (idempotent); anything else is logged, not thrown.
    if (httpStatusCode(err) !== 404) {
      console.warn(`[sandbox.k8s] delete pod ${name} failed:`, err);
    }
  }
}

class K8sRunningExecution implements RunningExecution {
  constructor(
    private readonly client: K8sClient,
    private readonly podName: string,
    private readonly workspace: Workspace,
    private readonly userTimeoutMs: number,
  ) {}

  async wait(opts: RunOptions): Promise<RunResult> {
    const { client, podName, workspace } = this;

    // 1. Wait until the runner container is Running (or a startup failure).
    await this.waitForRunning(opts.signal);

    // 2. Stage inputs into the Pod, then release the sentinel-gated runner.
    await execTarIn(client, podName, 'holder', workspace.localRoot);
    await withExecRetry('sentinel', () =>
      runExec(client, podName, 'holder', [
        '/bin/sh',
        '-c',
        'mkdir -p /workspace/.tale && touch /workspace/.tale/.staged',
      ]),
    );

    // 3. Follow runner stdout → the phase-marker parser + a capped buffer.
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;
    const onLog = (b: Buffer) => {
      opts.onStdoutChunk?.(b); // always forward (phase detection past the cap)
      if (stdoutBytes >= opts.stdoutMaxBytes) {
        stdoutTruncated = true;
        return;
      }
      const room = opts.stdoutMaxBytes - stdoutBytes;
      if (b.length <= room) {
        stdoutChunks.push(b);
        stdoutBytes += b.length;
      } else {
        stdoutChunks.push(b.subarray(0, room));
        stdoutBytes = opts.stdoutMaxBytes;
        stdoutTruncated = true;
      }
    };
    const logController = await withExecRetry('log-follow', () =>
      followLogs(client, podName, 'runner', onLog),
    );

    // 4. Race runner-exit against the inner timeout and client abort. The
    //    timers DON'T delete the Pod — remove() (executeRequest's finally)
    //    does — so the harvest below still runs on timeout/cancel, mirroring
    //    docker's "partial output survives a kill".
    const pollAbort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutP = new Promise<number>((resolve) => {
      // 124 → classifyFailure maps to TIMEOUT (matches docker's exit 124).
      timer = setTimeout(() => resolve(124), this.userTimeoutMs);
    });
    const abortP = new Promise<number>((resolve) => {
      if (opts.signal.aborted) resolve(137);
      else
        opts.signal.addEventListener('abort', () => resolve(137), {
          once: true,
        });
    });
    let exitCode: number;
    try {
      exitCode = await Promise.race([
        this.pollRunnerExit(pollAbort.signal),
        timeoutP,
        abortP,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      pollAbort.abort();
      logController.abort();
    }

    // 5. Harvest outputs + the separated stderr back into the local workspace
    //    (best-effort; the Pod still exists). spawn.ts then runs its normal
    //    harvest/upload over workspace.localRoot/output.
    await execTarOut(
      client,
      podName,
      'holder',
      '/workspace/output',
      join(workspace.localRoot, 'output'),
    ).catch((err) =>
      console.warn('[sandbox.k8s] harvest tar-out failed:', err),
    );
    const { text: stderr, truncated: stderrTruncated } = await execReadFile(
      client,
      podName,
      'holder',
      '/workspace/.tale/stderr.log',
      opts.stderrMaxBytes,
    );

    return {
      exitCode,
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr,
      stdoutTruncated,
      stderrTruncated,
    };
  }

  async remove(): Promise<void> {
    await deletePod(this.client, this.podName);
  }

  // The exec websocket AND the REST reads under Bun occasionally throw a
  // transient AbortError; retry so a single hiccup doesn't fail the whole
  // execution (mirrors withExecRetry on the exec ops).
  private readPod(): Promise<V1Pod> {
    return withExecRetry('read-pod', () =>
      this.client.core.readNamespacedPod({
        name: this.podName,
        namespace: this.client.namespace,
      }),
    );
  }

  private async waitForRunning(signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + STARTUP_BUDGET_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('cancelled before pod started');
      const pod = await this.readPod();
      const phase = pod.status?.phase;
      if (phase === 'Running') return;
      if (phase === 'Failed') {
        throw new Error(
          `runtime pod failed to start: ${pod.status?.reason ?? 'unknown'} ${pod.status?.message ?? ''}`.trim(),
        );
      }
      const waiting = pod.status?.containerStatuses?.find(
        (c) => c.name === 'runner',
      )?.state?.waiting?.reason;
      if (
        waiting &&
        /ImagePullBackOff|ErrImagePull|InvalidImageName|CreateContainerError|CrashLoopBackOff/.test(
          waiting,
        )
      ) {
        throw new Error(`runtime pod runner cannot start: ${waiting}`);
      }
      await sleep(500, signal);
    }
    throw new Error(
      `runtime pod did not reach Running within ${STARTUP_BUDGET_MS}ms`,
    );
  }

  private async pollRunnerExit(signal: AbortSignal): Promise<number> {
    while (!signal.aborted) {
      const pod = await this.readPod();
      const term = pod.status?.containerStatuses?.find(
        (c) => c.name === 'runner',
      )?.state?.terminated;
      if (term) return term.exitCode ?? 1;
      await sleep(POLL_INTERVAL_MS, signal);
    }
    return 1; // aborted; the race already resolved with another value
  }
}

export class KubernetesBackend implements ExecutionBackend {
  readonly kind = 'kubernetes' as const;

  private readonly client: K8sClient;

  constructor(private readonly cfg: SpawnerConfig) {
    this.client = makeK8sClient(cfg.k8s.namespace);
  }

  async init(): Promise<void> {
    // Connectivity + RBAC self-check: listing pods proves the token works and
    // the Role grants list. Throwing here is fatal (server exits).
    try {
      await this.client.core.listNamespacedPod({
        namespace: this.client.namespace,
        limit: 1,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `k8s backend init: cannot list pods in namespace ${this.client.namespace} ` +
          `(check ServiceAccount RBAC + NODE_EXTRA_CA_CERTS for CA trust under Bun): ${msg}`,
        { cause: err },
      );
    }
    // Egress isolation is operator-applied (NetworkPolicy + egress proxy), not
    // enforced by this code — surface a one-line reminder so an unconfigured
    // cluster isn't silently wide-open to SSRF/IMDS.
    console.warn(
      '[sandbox.k8s] egress isolation requires an operator-applied default-deny ' +
        'NetworkPolicy on tale.sandbox/role=runtime pods + the egress proxy; ' +
        'verify before running untrusted workloads.',
    );
  }

  async shutdown(): Promise<void> {
    // No host-session lock to release on K8s.
  }

  async health(): Promise<HealthResult> {
    try {
      await this.client.core.listNamespacedPod({
        namespace: this.client.namespace,
        limit: 1,
      });
      return { ok: true, detail: `k8s namespace=${this.client.namespace}` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async warmImage(): Promise<void> {
    // No-op: the kubelet pulls the runtime image per-Pod.
  }

  async createWorkspace(executionId: string): Promise<Workspace> {
    return new K8sWorkspace(this.cfg.hostSessionRoot, executionId);
  }

  async ensureCacheStore(organizationId: string): Promise<CacheStores> {
    if (this.cfg.k8s.cacheMode === 'pvc') {
      return ensureCachePvcs(this.client, this.cfg, organizationId);
    }
    // 'none' mode: names are unused (no cache mount), but the interface wants them.
    return cacheStoreNames(this.cfg, organizationId);
  }

  async launch(
    spec: LaunchSpec,
    cache: CacheStores,
  ): Promise<RunningExecution> {
    const pod = buildSandboxPod(this.cfg, {
      executionId: spec.executionId,
      organizationId: spec.organizationId,
      language: spec.language,
      entryPath: spec.entryPath,
      startedAtMs: spec.startedAtMs,
      ...(this.cfg.k8s.cacheMode === 'pvc' && { cache }),
    });
    await this.client.core.createNamespacedPod({
      namespace: this.client.namespace,
      body: pod,
    });
    return new K8sRunningExecution(
      this.client,
      podNameFor(spec.executionId),
      spec.workspace,
      spec.timeoutMs,
    );
  }

  async cancel(executionId: string): Promise<void> {
    // Addressed by deterministic name — works cross-replica and before the
    // pod exists. Best-effort (delete tolerates 404).
    await deletePod(this.client, podNameFor(executionId));
  }

  async sweepOrphans(opts: SweepOptions): Promise<number> {
    let list;
    try {
      list = await this.client.core.listNamespacedPod({
        namespace: this.client.namespace,
        labelSelector: 'tale.sandbox=1',
      });
    } catch (err) {
      console.warn('[sandbox.k8s] sweep list failed:', err);
      return 0;
    }
    let removed = 0;
    for (const pod of list.items) {
      const name = pod.metadata?.name;
      if (!name) continue;
      const phase = pod.status?.phase;
      const execId = pod.metadata?.annotations?.['tale.dev/execution-id'] ?? '';
      const startedAt = Number(
        pod.metadata?.annotations?.['tale.dev/started-at'] ?? '0',
      );
      const terminal = phase === 'Succeeded' || phase === 'Failed';
      const stale =
        Number.isFinite(startedAt) &&
        startedAt > 0 &&
        startedAt < opts.staleBeforeMs;
      // Reap terminal pods promptly (restartPolicy:Never leaves them around)
      // and stale running pods no longer tracked in-flight.
      if (terminal || (stale && !opts.isLive(execId))) {
        await deletePod(this.client, name);
        removed += 1;
      }
    }
    return removed;
  }
}
