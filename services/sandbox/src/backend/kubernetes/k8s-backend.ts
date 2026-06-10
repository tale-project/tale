// KubernetesBackend — runs each execution as a Pod (Helm deployment target),
// using an EXEC-FREE transport: every spawner↔Pod interaction is plain HTTP
// (createNamespacedPod / readNamespacedPodLog / deleteNamespacedPod + a per-exec
// Secret). There is no exec websocket anywhere — the Phase-2 spike found it
// unreliable under Bun.
//
// Per execution the backend:
//   1. creates a Secret (presigned URLs + token + caps) + a Pod with a `stage`
//      initContainer (downloads inputs), a `runner` (user code), and a
//      `harvest` sidecar (uploads outputs + prints a result line). The Secret
//      is mounted ONLY into stage/harvest — the runner never sees a credential.
//   2. follows the runner container's logs (HTTP) to drive live PHASE + stdout
//      progress and accumulate the canonical stdout buffer.
//   3. waits for the harvest container to terminate (it owns the user timeout),
//      then reads the harvest container's logs once and parses the
//      `__TALE_RESULT__` line for exitCode / stderr / outputs / steps.
//   4. assembles the ExecuteResponse and deletes the Pod + Secret.
//
// Horizontal scale: the result rides the harvest container's logs, which the
// OWNING spawner replica reads itself — no result callback to a Service VIP, no
// cross-replica affinity. Cancel = delete-by-deterministic-name from any
// replica.

import type { V1Pod, V1Secret } from '@kubernetes/client-node';

import {
  capText,
  classifyFailure,
  createStreamScanner,
  makeError,
  stripControlChars,
  stripPhaseMarkers,
} from '../../exec-common.ts';
import type {
  ErrorCode,
  ExecuteRequest,
  ExecuteResponse,
  OutputFile,
  SpawnerConfig,
  UploadStats,
} from '../../types.ts';
import type {
  CacheStores,
  ExecuteOptions,
  ExecutionBackend,
  HealthResult,
  SweepOptions,
} from '../types.ts';
import { buildExecSecret, secretNameFor } from './exec-spec.ts';
import { ensureCachePvcs } from './k8s-cache.ts';
import {
  followLogs,
  makeK8sClient,
  readPodLog,
  withRetry,
  type K8sClient,
} from './k8s-client.ts';
import { buildSandboxPod, podNameFor } from './k8s-pod-spec.ts';
import { parseResultLine, type K8sHarvestResult } from './k8s-protocol.ts';

// Max time to wait for the runner container to start (covers stage staging +
// scheduling + a cold image pull, since warmImage is a no-op on K8s).
const STARTUP_BUDGET_MS = 180_000;
const POLL_INTERVAL_MS = 500;
// Backstop beyond the user timeout for the harvest container to print + exit
// (harvest enforces the timeout itself; this only guards a wedged harvest).
const HARVEST_BACKSTOP_MS = 120_000;

const IMAGE_ERR_RE =
  /ImagePullBackOff|ErrImagePull|InvalidImageName|CreateContainerError|CrashLoopBackOff/;

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

type StartupResult =
  | { kind: 'started' }
  | { kind: 'preStageFailed'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'aborted' };

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

  async execute(
    cfg: SpawnerConfig,
    req: ExecuteRequest,
    opts: ExecuteOptions,
  ): Promise<ExecuteResponse> {
    // The dispatcher validates language; re-narrow for the entry-path resolve.
    if (
      req.language !== 'python' &&
      req.language !== 'node' &&
      req.language !== 'polyglot'
    ) {
      return makeError('SPAWNER_UNAVAILABLE', 'invalid language', 0);
    }

    const timeoutMs = Math.min(
      Math.max(req.timeoutMs ?? cfg.defaultTimeoutMs, 1_000),
      cfg.maxTimeoutMs,
    );
    const startedAtMs = opts.startedAtMs;
    const podName = podNameFor(req.executionId);
    const secretName = secretNameFor(req.executionId);

    // Resolve the path the runtime entrypoint will exec — same rule as docker.
    const entryPath =
      req.steps !== undefined
        ? `/workspace/.tale/${
            req.language === 'python' || req.language === 'polyglot'
              ? 'runner.py'
              : 'runner.js'
          }`
        : // oxlint-disable-next-line typescript/no-non-null-assertion -- validator enforces entryPath xor steps
          req.entryPath!;

    // Accumulate the runner's stdout (capped) while a scanner drives live
    // PHASE + stdout deltas. The runner's logs are stdout-only (stderr → file),
    // so there's no onStderrChunk here.
    const scanner = createStreamScanner(
      {
        ...(opts.onPhase && { onPhase: opts.onPhase }),
        ...(opts.onStdoutDelta && { onStdoutDelta: opts.onStdoutDelta }),
      },
      {
        stdoutMaxBytes: cfg.stdoutMaxBytes,
        stderrMaxBytes: cfg.stderrMaxBytes,
      },
    );
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutStreamTruncated = false;
    const onRunnerLog = (b: Buffer) => {
      scanner.onStdoutChunk?.(b); // always forward (phase detect past the cap)
      if (stdoutBytes >= cfg.stdoutMaxBytes) {
        stdoutStreamTruncated = true;
        return;
      }
      const room = cfg.stdoutMaxBytes - stdoutBytes;
      if (b.length <= room) {
        stdoutChunks.push(b);
        stdoutBytes += b.length;
      } else {
        stdoutChunks.push(b.subarray(0, room));
        stdoutBytes = cfg.stdoutMaxBytes;
        stdoutStreamTruncated = true;
      }
    };

    let logController: AbortController | undefined;
    try {
      const cache = await this.ensureCache(req.organizationId);
      await this.createSecret(buildExecSecret(cfg, req, timeoutMs));
      await this.client.core.createNamespacedPod({
        namespace: this.client.namespace,
        body: buildSandboxPod(cfg, {
          executionId: req.executionId,
          organizationId: req.organizationId,
          language: req.language,
          entryPath,
          startedAtMs,
          ...(cache !== undefined && { cache }),
        }),
      });

      // Wait for the runner to start (stage initContainer complete) — or a
      // startup failure (image pull, stage-init non-zero → PRE_STAGE_FAILED).
      const startup = await this.waitForRunnerStart(podName, opts.signal);
      if (startup.kind === 'aborted') {
        return this.assemble(req, cfg, opts, {
          aborted: true,
          stdout: '',
          stdoutStreamTruncated: false,
          startedAtMs,
          harvest: null,
        });
      }
      if (startup.kind === 'preStageFailed') {
        return makeError(
          'PRE_STAGE_FAILED',
          startup.message,
          Date.now() - startedAtMs,
        );
      }
      if (startup.kind === 'failed') {
        return makeError(
          'SPAWNER_UNAVAILABLE',
          startup.message,
          Date.now() - startedAtMs,
        );
      }

      // Follow the runner's logs (stdout) for live progress + the buffer. The
      // stream ends naturally when the runner exits; we also abort it once
      // harvest is done (covers the timeout case where the runner outlives us).
      logController = await withRetry('log-follow', () =>
        followLogs(this.client, podName, 'runner', onRunnerLog),
      );

      // The harvest container terminating is the completion signal (it owns the
      // user timeout + prints the result line). On cancel, the abort signal
      // ends the wait; cancel()/the finally then delete the Pod.
      await this.waitForHarvestDone(podName, opts.signal, timeoutMs);

      logController.abort();
      logController = undefined;
      scanner.finalize();

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');

      if (opts.signal.aborted) {
        return this.assemble(req, cfg, opts, {
          aborted: true,
          stdout,
          stdoutStreamTruncated,
          startedAtMs,
          harvest: null,
        });
      }

      // Read the harvest container's logs and extract its result line. The
      // harvest flushes the line then exits; the container can read as
      // terminated a beat before the kubelet→API log propagation completes, so
      // retry a couple times on a missing line before giving up.
      let harvest: K8sHarvestResult | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const logs = await readPodLog(this.client, podName, 'harvest');
          harvest = parseResultLine(logs);
        } catch (err) {
          console.warn('[sandbox.k8s] failed to read harvest logs:', err);
        }
        if (harvest !== null) break;
        if (attempt < 2) await sleep(400);
      }
      if (harvest === null) {
        console.warn(
          `[sandbox.k8s] no result line in harvest logs for ${req.executionId}`,
        );
      }

      return this.assemble(req, cfg, opts, {
        aborted: false,
        stdout,
        stdoutStreamTruncated,
        startedAtMs,
        harvest,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return makeError(
        'SPAWNER_UNAVAILABLE',
        `spawner internal error: ${message}`,
        Date.now() - startedAtMs,
      );
    } finally {
      if (logController) logController.abort();
      await this.deletePod(podName);
      await this.deleteSecret(secretName);
    }
  }

  async cancel(executionId: string): Promise<void> {
    // Addressed by deterministic name — works cross-replica and before the pod
    // exists. Best-effort (delete tolerates 404). Also drop the Secret.
    await this.deletePod(podNameFor(executionId));
    await this.deleteSecret(secretNameFor(executionId));
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
      // and stale running pods no longer tracked in-flight. Drop the matching
      // per-exec Secret too (best-effort; tolerates 404).
      if (terminal || (stale && !opts.isLive(execId))) {
        await this.deletePod(name);
        if (execId) await this.deleteSecret(secretNameFor(execId));
        removed += 1;
      }
    }
    return removed;
  }

  // ---- internals -----------------------------------------------------------

  private async ensureCache(
    organizationId: string,
  ): Promise<CacheStores | undefined> {
    if (this.cfg.k8s.cacheMode !== 'pvc') return undefined;
    return ensureCachePvcs(this.client, this.cfg, organizationId);
  }

  private async createSecret(secret: V1Secret): Promise<void> {
    try {
      await this.client.core.createNamespacedSecret({
        namespace: this.client.namespace,
        body: secret,
      });
    } catch (err) {
      // 409 = a prior attempt left it; replace so the Pod mounts fresh data.
      if (httpStatusCode(err) === 409 && secret.metadata?.name) {
        await this.client.core.replaceNamespacedSecret({
          name: secret.metadata.name,
          namespace: this.client.namespace,
          body: secret,
        });
        return;
      }
      throw err;
    }
  }

  private async deleteSecret(name: string): Promise<void> {
    try {
      await this.client.core.deleteNamespacedSecret({
        name,
        namespace: this.client.namespace,
      });
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(`[sandbox.k8s] delete secret ${name} failed:`, err);
      }
    }
  }

  private async deletePod(name: string): Promise<void> {
    try {
      await this.client.core.deleteNamespacedPod({
        name,
        namespace: this.client.namespace,
        gracePeriodSeconds: 0,
      });
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(`[sandbox.k8s] delete pod ${name} failed:`, err);
      }
    }
  }

  private readPod(podName: string): Promise<V1Pod> {
    // Bun's fetch occasionally throws a transient AbortError; retry so a single
    // hiccup doesn't fail the whole execution.
    return withRetry('read-pod', () =>
      this.client.core.readNamespacedPod({
        name: podName,
        namespace: this.client.namespace,
      }),
    );
  }

  private async waitForRunnerStart(
    podName: string,
    signal: AbortSignal,
  ): Promise<StartupResult> {
    const deadline = Date.now() + STARTUP_BUDGET_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) return { kind: 'aborted' };
      const pod = await this.readPod(podName);

      // Stage initContainer outcome.
      const stageStatus = pod.status?.initContainerStatuses?.find(
        (c) => c.name === 'stage',
      );
      const stageTerm = stageStatus?.state?.terminated;
      if (stageTerm && stageTerm.exitCode !== 0) {
        return {
          kind: 'preStageFailed',
          message:
            `pre-stage failed (exit ${stageTerm.exitCode})` +
            (stageTerm.reason ? `: ${stageTerm.reason}` : ''),
        };
      }
      const stageWaiting = stageStatus?.state?.waiting?.reason;
      if (stageWaiting && IMAGE_ERR_RE.test(stageWaiting)) {
        return {
          kind: 'failed',
          message: `stage cannot start: ${stageWaiting}`,
        };
      }

      // Runner started (running or already terminated for a very fast exec) →
      // staging is done and we can follow its logs.
      const runnerStatus = pod.status?.containerStatuses?.find(
        (c) => c.name === 'runner',
      );
      if (runnerStatus?.state?.running || runnerStatus?.state?.terminated) {
        return { kind: 'started' };
      }
      const runnerWaiting = runnerStatus?.state?.waiting?.reason;
      if (runnerWaiting && IMAGE_ERR_RE.test(runnerWaiting)) {
        return {
          kind: 'failed',
          message: `runner cannot start: ${runnerWaiting}`,
        };
      }

      if (pod.status?.phase === 'Failed') {
        return {
          kind: 'failed',
          message:
            `pod failed before runner start: ${pod.status?.reason ?? 'unknown'} ${pod.status?.message ?? ''}`.trim(),
        };
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }
    return {
      kind: 'failed',
      message: `pod did not start the runner within ${STARTUP_BUDGET_MS}ms`,
    };
  }

  private async waitForHarvestDone(
    podName: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs + HARVEST_BACKSTOP_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) return;
      let pod: V1Pod;
      try {
        pod = await this.readPod(podName);
      } catch (err) {
        // Pod gone (deleted out from under us) → nothing more to wait for.
        if (httpStatusCode(err) === 404) return;
        throw err;
      }
      const harvestStatus = pod.status?.containerStatuses?.find(
        (c) => c.name === 'harvest',
      );
      if (harvestStatus?.state?.terminated) return;
      if (pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed') {
        return;
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }
  }

  /**
   * Assemble the ExecuteResponse from the runner stdout buffer + the harvest
   * result line. Mirrors the docker path's classification (abort → cancelled;
   * exit 0 + harvest error → failed; exit 0 → completed; else classifyFailure)
   * using the same shared pure helpers.
   */
  private assemble(
    req: ExecuteRequest,
    cfg: SpawnerConfig,
    opts: ExecuteOptions,
    src: {
      aborted: boolean;
      stdout: string;
      stdoutStreamTruncated: boolean;
      startedAtMs: number;
      harvest: K8sHarvestResult | null;
    },
  ): ExecuteResponse {
    const durationMs = Date.now() - src.startedAtMs;
    const h = src.harvest;

    const { text: stdoutCapped, truncated: stdoutCapTrunc } = capText(
      stripControlChars(stripPhaseMarkers(src.stdout)),
      cfg.stdoutMaxBytes,
    );
    const { text: stderrCapped, truncated: stderrCapTrunc } = capText(
      stripControlChars(h?.stderr ?? ''),
      cfg.stderrMaxBytes,
    );
    const stdoutTrunc = src.stdoutStreamTruncated || stdoutCapTrunc;
    const stderrTrunc = (h?.stderrTruncated ?? false) || stderrCapTrunc;

    const outputFiles: OutputFile[] = h?.outputFiles ?? [];
    const uploadStats: UploadStats = h?.uploadStats ?? {
      attempted: 0,
      succeeded: 0,
      failures: [],
    };
    const truncatedFiles = h?.truncatedFiles ?? 0;

    const timing = {
      stageMs: h?.stageMs ?? 0,
      executeMs: Math.max(0, durationMs),
      harvestMs: h?.harvestMs ?? 0,
      uploadMs: h?.uploadMs ?? 0,
    };

    const base = {
      stdoutBase64: Buffer.from(stdoutCapped).toString('base64'),
      stderrBase64: Buffer.from(stderrCapped).toString('base64'),
      durationMs,
      truncated: {
        stdout: stdoutTrunc,
        stderr: stderrTrunc,
        files: truncatedFiles,
      },
      outputFiles,
      ...(h?.steps !== undefined && { steps: h.steps }),
      uploadStats,
      timing,
      ...(h?.priorStage !== undefined && { priorStage: h.priorStage }),
    };

    if (src.aborted || opts.signal.aborted) {
      return {
        status: 'cancelled',
        exitCode: null,
        errorCode: 'CANCELLED',
        errorMessage: 'Execution cancelled by client',
        ...base,
      };
    }

    // No harvest result (Pod deleted before harvest printed, or harvest
    // crashed). We can't trust an exit code — surface a harvest-read failure
    // while still returning whatever stdout we captured.
    if (h === null) {
      return {
        status: 'failed',
        exitCode: null,
        errorCode: 'HARVEST_READ_FAILED',
        errorMessage: 'No harvest result was produced for this execution',
        ...base,
      };
    }

    // Harvest-side failure classification (quota > upload > report > read),
    // applied only when user code itself exited 0 (don't mask a real crash).
    let harvestErrorCode: ErrorCode | undefined;
    let harvestErrorMessage: string | undefined;
    if (h.quotaExhausted) {
      harvestErrorCode = 'UPLOAD_QUOTA_EXCEEDED';
      harvestErrorMessage =
        'Per-run output-file quota exceeded; some files were not uploaded';
    } else if (h.uploadFailed) {
      harvestErrorCode = 'UPLOAD_FAILED';
      harvestErrorMessage = 'One or more output uploads failed';
    } else if (h.reportFailed) {
      harvestErrorCode = 'UPLOAD_REPORT_FAILED';
      harvestErrorMessage =
        'Upload succeeded but report-back to platform failed';
    } else if (h.readFailed) {
      harvestErrorCode = 'HARVEST_READ_FAILED';
      harvestErrorMessage = "Couldn't read /workspace/output";
    }

    if (h.exitCode === 0) {
      return {
        status: harvestErrorCode !== undefined ? 'failed' : 'completed',
        exitCode: 0,
        ...(harvestErrorCode !== undefined && {
          errorCode: harvestErrorCode,
          ...(harvestErrorMessage !== undefined && {
            errorMessage: harvestErrorMessage,
          }),
        }),
        ...base,
      };
    }

    const { code: ec, message } = classifyFailure(h.exitCode, stderrCapped);
    return {
      status: ec === 'CANCELLED' ? 'cancelled' : 'failed',
      exitCode: h.exitCode,
      errorCode: ec,
      errorMessage: message,
      ...base,
    };
  }
}
