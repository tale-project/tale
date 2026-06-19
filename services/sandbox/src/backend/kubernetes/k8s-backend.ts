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
//      then reads the harvest container's logs and parses the
//      `__TALE_RESULT__` line for exitCode / stderr / outputs / steps.
//   4. assembles the ExecuteResponse and deletes the Pod + Secret it created.
//
// Horizontal scale: the result rides the harvest container's logs, which the
// OWNING spawner replica reads itself — no result callback to a Service VIP, no
// cross-replica affinity. A LOCAL cancel is abort-only (execute() does its
// final log reads, then its finally deletes the Pod — no race); `cancel()` is
// the REMOTE path: delete-by-deterministic-name from any replica.

import type { V1Pod, V1Secret } from '@kubernetes/client-node';

import {
  capText,
  createStreamScanner,
  makeError,
  stripControlChars,
  stripPhaseMarkers,
  synthesizeStepResults,
} from '../../exec-common.ts';
import {
  buildCancelled,
  buildCompleted,
  buildHarvestMissing,
  buildRunnerKilled,
  buildRuntimeFailure,
  buildTimeoutBackstop,
  classifyHarvestError,
  type ResponseParts,
} from '../../exec-response.ts';
import type {
  ExecuteRequest,
  ExecuteResponse,
  SpawnerConfig,
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
  apiTimeout,
  httpStatusCode,
  makeK8sClient,
  readPodLog,
  withRetry,
  type K8sClient,
} from './k8s-client.ts';
import { buildSandboxPod, podNameFor } from './k8s-pod-spec.ts';
import {
  parseResultLine,
  parseStartedLine,
  type HarvestStarted,
  type K8sHarvestResult,
} from './k8s-protocol.ts';

// Max time to wait for the runner container to start (covers stage staging +
// scheduling + a cold image pull, since warmImage is a no-op on K8s).
export const STARTUP_BUDGET_MS = 180_000;
const POLL_INTERVAL_MS = 500;
// Backstop beyond the user timeout for the harvest container to print + exit
// (harvest enforces the timeout itself; this only guards a wedged harvest).
export const HARVEST_BACKSTOP_MS = 120_000;
// A runner container that terminated NON-ZERO means the sh wrapper itself died
// (a surviving wrapper always exits 0 — its last command is the echo into the
// exit-code file), so harvest is stuck waiting on a file that will never
// exist. Grace covers kubelet status/log propagation before we act on it.
const RUNNER_DEAD_GRACE_MS = 10_000;
// After the harvest container terminates, keep re-reading its logs for the
// result line this long — kubelet→apiserver log flush can lag termination.
const RESULT_READ_WINDOW_MS = 5_000;
// A just-terminated pod still belongs to its owner for the harvest-log reads;
// only reap terminal pods whose containers finished at least this long ago.
export const TERMINAL_REAP_GRACE_MS = 60_000;
// Margin on top of the worst-case execution lifetime for the stale sweep.
export const SWEEP_SLACK_MS = 60_000;

const IMAGE_ERR_RE =
  /ImagePullBackOff|ErrImagePull|InvalidImageName|CreateContainerError|CrashLoopBackOff/;

/** Duplicate dispatch detected: another replica owns a LIVE pod for this id. */
class DuplicateExecutionError extends Error {}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

type StartupResult =
  | { kind: 'started' }
  | { kind: 'preStageFailed'; message: string }
  | { kind: 'failed'; message: string }
  | { kind: 'aborted' };

/** Why the main wait loop ended — drives the response classification. */
type LoopOutcome =
  | 'harvestDone'
  | 'podGone'
  | 'runnerDead'
  | 'aborted'
  | 'backstop';

/**
 * Earliest start time (epoch ms) a pod/Secret may have and still plausibly
 * belong to a live execution anywhere: startup budget + the max user timeout +
 * the harvest backstop, plus slack. Anything started before this is abandoned
 * regardless of which replica owned it.
 */
export function staleLifetimeCutoffMs(
  cfg: SpawnerConfig,
  nowMs: number,
): number {
  return (
    nowMs -
    (STARTUP_BUDGET_MS +
      cfg.maxTimeoutMs +
      HARVEST_BACKSTOP_MS +
      SWEEP_SLACK_MS)
  );
}

/**
 * Sweep decision for one pod. Pure for unit testing.
 *
 * Terminal pods are NOT reaped on sight: the pod goes Succeeded the moment the
 * harvest container exits, but the OWNING execute() still needs ~1-3 s to read
 * the harvest logs — reaping in that window flips a completed run into
 * HARVEST_READ_FAILED. So terminal reaps require !isLive AND a finishedAt
 * grace (started-at is useless here: it's already minutes old at termination).
 * The grace only delays crash-recovery — execute()'s own finally deletes the
 * pod on every owned path.
 */
export function shouldReapPod(
  pod: V1Pod,
  opts: SweepOptions,
  cfg: SpawnerConfig,
  nowMs: number,
): boolean {
  const execId = pod.metadata?.annotations?.['tale.dev/execution-id'] ?? '';
  if (opts.isLive(execId)) return false;
  const phase = pod.status?.phase;
  if (phase === 'Succeeded' || phase === 'Failed') {
    let latestFinishedAt = 0;
    for (const cs of [
      ...(pod.status?.initContainerStatuses ?? []),
      ...(pod.status?.containerStatuses ?? []),
    ]) {
      const finished = cs.state?.terminated?.finishedAt;
      if (finished !== undefined) {
        const t = new Date(finished).getTime();
        if (Number.isFinite(t) && t > latestFinishedAt) latestFinishedAt = t;
      }
    }
    if (latestFinishedAt > 0) {
      return nowMs - latestFinishedAt > TERMINAL_REAP_GRACE_MS;
    }
    // No finishedAt visible — fall through to the conservative stale rule.
  }
  const startedAt = Number(
    pod.metadata?.annotations?.['tale.dev/started-at'] ?? '0',
  );
  const cutoff = Math.min(
    opts.staleBeforeMs,
    staleLifetimeCutoffMs(cfg, nowMs),
  );
  return Number.isFinite(startedAt) && startedAt > 0 && startedAt < cutoff;
}

/**
 * Sweep decision for one per-exec Secret: only podless orphans reach this (a
 * Secret deleted alongside its pod never gets here), so age past the lifetime
 * cutoff + not live is sufficient. Secrets without a started-at annotation
 * (pre-GC versions) are left alone — fail-safe.
 */
export function shouldReapSecret(
  secret: V1Secret,
  opts: SweepOptions,
  cfg: SpawnerConfig,
  nowMs: number,
): boolean {
  const execId = secret.metadata?.annotations?.['tale.dev/execution-id'] ?? '';
  if (opts.isLive(execId)) return false;
  const startedAt = Number(
    secret.metadata?.annotations?.['tale.dev/started-at'] ?? '0',
  );
  const cutoff = Math.min(
    opts.staleBeforeMs,
    staleLifetimeCutoffMs(cfg, nowMs),
  );
  return Number.isFinite(startedAt) && startedAt > 0 && startedAt < cutoff;
}

export class KubernetesBackend implements ExecutionBackend {
  readonly kind = 'kubernetes' as const;

  private readonly client: K8sClient;

  constructor(
    private readonly cfg: SpawnerConfig,
    client?: K8sClient,
  ) {
    this.client = client ?? makeK8sClient(cfg.k8s.namespace);
  }

  async init(): Promise<void> {
    // Connectivity + RBAC self-check: listing pods proves the token works and
    // the Role grants list. Throwing here is fatal (server exits).
    try {
      await this.client.core.listNamespacedPod(
        { namespace: this.client.namespace, limit: 1 },
        apiTimeout(),
      );
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
    // cluster isn't silently wide-open to SSRF/IMDS. Selects BOTH pod roles:
    // one-shot pods are tale.sandbox/role=runtime, sessions are role=session.
    console.warn(
      '[sandbox.k8s] egress isolation requires an operator-applied default-deny ' +
        'NetworkPolicy on tale.sandbox/role in (runtime, session) pods + the egress ' +
        'proxy; verify before running untrusted workloads.',
    );
    // Docker-in-container on K8s is not silently shipped: it requires a node-
    // level runtime (sysbox-deploy-k8s / kata-deploy) registering the
    // RuntimeClass `${runtimeClassName}`, and the in-pod egress fence
    // (entrypoint, needs NET_ADMIN — sysbox/kata provide it) — a pod
    // NetworkPolicy alone does NOT contain a nested dockerd's bridge. This path
    // is unvalidated on a cluster until the operator confirms those prereqs.
    if (this.cfg.dockerInContainer) {
      console.warn(
        `[sandbox.k8s] DOCKER-IN-CONTAINER enabled (tier=${this.cfg.runtimeTier}): ` +
          `requires RuntimeClass '${this.cfg.k8s.runtimeClassName}' installed on the nodes ` +
          `(sysbox-deploy-k8s / kata-deploy) + the in-pod egress fence; UNVALIDATED until ` +
          `the operator confirms node prereqs. Pod NetworkPolicy does not contain inner DinD egress.`,
      );
    }
  }

  async shutdown(): Promise<void> {
    // No host-session lock to release on K8s.
  }

  async health(): Promise<HealthResult> {
    try {
      await this.client.core.listNamespacedPod(
        { namespace: this.client.namespace, limit: 1 },
        apiTimeout(),
      );
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
        ? `/user/.runtime/tale/${
            req.language === 'python' || req.language === 'polyglot'
              ? 'runner.py'
              : 'runner.js'
          }`
        : // oxlint-disable-next-line typescript/no-non-null-assertion -- validator enforces entryPath xor steps
          req.entryPath!;

    // A scanner drives live PHASE + stdout deltas. The runner's logs are
    // stdout-only (stderr → file), so there's no onStderrChunk here.
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

    // Ownership flags gate the finally cleanup: deterministic names mean a
    // duplicate dispatch (same executionId on another replica) would otherwise
    // delete the LIVE owner's pod + Secret on its way out.
    let podCreated = false;
    let secretOwned = false;

    try {
      const cache = await this.ensureCache(req.organizationId);
      secretOwned = await this.createSecretChecked(
        buildExecSecret(cfg, req, timeoutMs, startedAtMs),
        podName,
      );
      try {
        await this.client.core.createNamespacedPod(
          {
            namespace: this.client.namespace,
            body: buildSandboxPod(cfg, {
              executionId: req.executionId,
              organizationId: req.organizationId,
              language: req.language,
              entryPath,
              startedAtMs,
              ...(cache !== undefined && { cache }),
              ...(req.env !== undefined && { userEnv: req.env }),
            }),
          },
          apiTimeout(),
        );
      } catch (err) {
        if (httpStatusCode(err) === 409) {
          // A live pod for this id appeared concurrently (another replica won
          // the race). The Secret content we replaced is equivalent (same
          // request payload); the owner's finally will delete it.
          secretOwned = false;
          return makeError(
            'SPAWNER_UNAVAILABLE',
            `executionId ${req.executionId} already has a live pod on another replica`,
            Date.now() - startedAtMs,
          );
        }
        throw err;
      }
      podCreated = true;

      // Wait for the runner to start (stage initContainer complete) — or a
      // startup failure (image pull error, stage-init non-zero exit).
      const startup = await this.waitForRunnerStart(podName, opts.signal);
      if (startup.kind === 'aborted') {
        return this.assemble(req, cfg, opts, {
          aborted: true,
          stdout: '',
          stdoutStreamTruncated: false,
          startedAtMs,
          harvest: null,
          started: null,
        });
      }
      if (startup.kind === 'preStageFailed') {
        // Same classification as the docker path's staging throw
        // (SPAWNER_UNAVAILABLE) — PRE_STAGE_FAILED stays action-side-only per
        // the wire.ts contract. The real fetch error lives in the stage
        // container's logs; read it before the finally deletes the pod.
        const stageLog = await this.readStageLogTail(podName);
        return makeError(
          'SPAWNER_UNAVAILABLE',
          `spawner staging failed: ${startup.message}` +
            (stageLog !== undefined ? `: ${stageLog}` : ''),
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

      // POLL (not stream) the runner's stdout for live PHASE + deltas while
      // waiting for the harvest container to terminate (its completion signal —
      // harvest owns the user timeout + prints the result line). Every read is a
      // discrete HTTP GET, so there is NO long-lived stream to abort under Bun.
      let lastLogLen = 0;
      let logShrunk = false;
      let loggedPollError = false;
      const pollRunnerStdout = async (): Promise<void> => {
        let logs: string;
        try {
          logs = await readPodLog(this.client, podName, 'runner', {
            limitBytes: cfg.stdoutMaxBytes,
          });
        } catch (err) {
          // Transient; the next poll catches up. Log the first occurrence so a
          // total live-tail loss is diagnosable without spamming every 500ms.
          if (!loggedPollError) {
            loggedPollError = true;
            console.warn(
              '[sandbox.k8s] runner log poll failed (will keep polling):',
              err instanceof Error ? err.message : err,
            );
          }
          return;
        }
        if (logs.length > lastLogLen) {
          scanner.onStdoutChunk?.(Buffer.from(logs.slice(lastLogLen), 'utf8'));
          lastLogLen = logs.length;
        } else if (logs.length < lastLogLen) {
          // The kubelet rotated the container log out from under us — the
          // canonical head is gone, so the final read is a partial window.
          logShrunk = true;
        }
      };

      let loopOutcome: LoopOutcome = 'backstop';
      let runnerKilled: { exitCode: number; reason?: string } | undefined;
      let runnerDeadSince: number | undefined;
      let harvestProgressing = false;

      const harvestDeadline = Date.now() + timeoutMs + HARVEST_BACKSTOP_MS;
      while (Date.now() < harvestDeadline) {
        if (opts.signal.aborted) {
          loopOutcome = 'aborted';
          break;
        }
        await pollRunnerStdout();
        let pod: V1Pod;
        try {
          pod = await this.readPod(podName);
        } catch (err) {
          if (httpStatusCode(err) === 404) {
            loopOutcome = 'podGone';
            break;
          }
          // Transient API failure (apiserver rolling upgrade, network blip)
          // must not kill a healthy run — keep polling; the harvest deadline
          // still bounds the loop.
          console.warn(
            '[sandbox.k8s] pod read failed mid-run (will keep polling):',
            err instanceof Error ? err.message : err,
          );
          await sleep(POLL_INTERVAL_MS, opts.signal);
          continue;
        }
        const harvestStatus = pod.status?.containerStatuses?.find(
          (c) => c.name === 'harvest',
        );
        if (
          harvestStatus?.state?.terminated ||
          pod.status?.phase === 'Succeeded' ||
          pod.status?.phase === 'Failed'
        ) {
          loopOutcome = 'harvestDone';
          break;
        }
        // Runner container terminated non-zero ⇒ the wrapper died with it
        // (group OOM kill, eviction) ⇒ the exit-code file will never appear
        // and harvest would idle until the FULL user timeout. After a short
        // grace, check the harvest log for the started marker: present means
        // harvest is legitimately past the wait (uploading) and owns its own
        // deadlines; absent means it is stuck — stop waiting and classify
        // from the runner's terminated state. Partial-output harvest is
        // deliberately forfeited in this rare abnormal-kill case.
        if (!harvestProgressing) {
          const runnerTerm = pod.status?.containerStatuses?.find(
            (c) => c.name === 'runner',
          )?.state?.terminated;
          if (runnerTerm && (runnerTerm.exitCode ?? 0) !== 0) {
            runnerDeadSince ??= Date.now();
            if (Date.now() - runnerDeadSince > RUNNER_DEAD_GRACE_MS) {
              let started: HarvestStarted | null = null;
              try {
                started = parseStartedLine(
                  await readPodLog(this.client, podName, 'harvest'),
                );
              } catch (err) {
                console.warn(
                  '[sandbox.k8s] harvest progress check failed:',
                  err instanceof Error ? err.message : err,
                );
              }
              if (started !== null) {
                harvestProgressing = true;
              } else {
                runnerKilled = {
                  exitCode: runnerTerm.exitCode ?? 137,
                  ...(runnerTerm.reason !== undefined && {
                    reason: runnerTerm.reason,
                  }),
                };
                loopOutcome = 'runnerDead';
                break;
              }
            }
          }
        }
        await sleep(POLL_INTERVAL_MS, opts.signal);
      }

      // Final stdout read (the runner may have emitted more between the last
      // poll and exit) → feed the residual to the scanner, then drain it. The
      // canonical buffer is the full (capped) runner log.
      await pollRunnerStdout();
      scanner.finalize();
      let stdout = '';
      try {
        stdout = await readPodLog(this.client, podName, 'runner', {
          limitBytes: cfg.stdoutMaxBytes,
        });
      } catch (err) {
        console.warn('[sandbox.k8s] final runner log read failed:', err);
      }
      const stdoutStreamTruncated =
        Buffer.byteLength(stdout, 'utf8') >= cfg.stdoutMaxBytes || logShrunk;

      if (loopOutcome === 'aborted' || opts.signal.aborted) {
        return this.assemble(req, cfg, opts, {
          aborted: true,
          stdout,
          stdoutStreamTruncated,
          startedAtMs,
          harvest: null,
          started: null,
        });
      }

      if (loopOutcome === 'runnerDead' && runnerKilled !== undefined) {
        return this.assemble(req, cfg, opts, {
          aborted: false,
          stdout,
          stdoutStreamTruncated,
          startedAtMs,
          harvest: null,
          started: null,
          runnerKilled,
        });
      }

      // Read the harvest container's logs and extract its result line. The
      // container can read as terminated a beat before the kubelet→API log
      // propagation completes, so keep re-reading until a short deadline —
      // not a fixed attempt count — distinguishing "pod gone" (stop: no log
      // will ever appear) from "no line yet" (keep trying).
      let harvest: K8sHarvestResult | null = null;
      let started: HarvestStarted | null = null;
      const readWindowMs =
        loopOutcome === 'harvestDone' ? RESULT_READ_WINDOW_MS : 0;
      const readDeadline = Date.now() + readWindowMs;
      for (;;) {
        try {
          const logs = await readPodLog(this.client, podName, 'harvest');
          harvest = parseResultLine(logs);
          if (started === null) started = parseStartedLine(logs);
        } catch (err) {
          if (httpStatusCode(err) === 404) break;
          console.warn('[sandbox.k8s] failed to read harvest logs:', err);
        }
        if (harvest !== null || Date.now() >= readDeadline) break;
        await sleep(400);
      }
      if (harvest === null) {
        console.warn(
          `[sandbox.k8s] no result line in harvest logs for ${req.executionId} (loop outcome: ${loopOutcome})`,
        );
      }

      return this.assemble(req, cfg, opts, {
        aborted: false,
        stdout,
        stdoutStreamTruncated,
        startedAtMs,
        harvest,
        started,
        backstop: loopOutcome === 'backstop',
      });
    } catch (err) {
      if (err instanceof DuplicateExecutionError) {
        // The live owner's finally deletes the shared-name resources.
        return makeError(
          'SPAWNER_UNAVAILABLE',
          err.message,
          Date.now() - startedAtMs,
        );
      }
      if (opts.signal.aborted) {
        // A cancel can surface as a thrown API error (e.g. the pod read raced
        // the deletion) — report it as the cancellation it is.
        return this.assemble(req, cfg, opts, {
          aborted: true,
          stdout: '',
          stdoutStreamTruncated: false,
          startedAtMs,
          harvest: null,
          started: null,
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      return makeError(
        'SPAWNER_UNAVAILABLE',
        `spawner internal error: ${message}`,
        Date.now() - startedAtMs,
      );
    } finally {
      if (podCreated) await this.deletePod(podName);
      if (podCreated || secretOwned) await this.deleteSecret(secretName);
    }
  }

  /**
   * REMOTE/cross-replica cancel: delete by deterministic name. The locally-
   * owned path is abort-only (spawn.ts aborts the signal; execute() does its
   * final log reads and then its finally deletes pod + Secret), so a local
   * cancel never races the result harvest.
   *
   * @returns true when a pod was actually found and deleted.
   */
  async cancel(executionId: string): Promise<boolean> {
    const found = await this.deletePod(podNameFor(executionId));
    await this.deleteSecret(secretNameFor(executionId));
    return found;
  }

  async sweepOrphans(opts: SweepOptions): Promise<number> {
    const nowMs = Date.now();
    let removed = 0;
    let pods;
    try {
      pods = await this.client.core.listNamespacedPod(
        { namespace: this.client.namespace, labelSelector: 'tale.sandbox=1' },
        apiTimeout(),
      );
    } catch (err) {
      console.warn('[sandbox.k8s] sweep pod list failed:', err);
      return 0;
    }
    for (const pod of pods.items) {
      const name = pod.metadata?.name;
      if (!name) continue;
      if (!shouldReapPod(pod, opts, this.cfg, nowMs)) continue;
      await this.deletePod(name);
      const execId = pod.metadata?.annotations?.['tale.dev/execution-id'];
      if (execId) await this.deleteSecret(secretNameFor(execId));
      removed += 1;
    }
    // Podless Secrets (a crash between createSecret and createPod) carry the
    // SANDBOX_TOKEN + presigned URLs — they must not leak forever.
    let secrets;
    try {
      secrets = await this.client.core.listNamespacedSecret(
        { namespace: this.client.namespace, labelSelector: 'tale.sandbox=1' },
        apiTimeout(),
      );
    } catch (err) {
      console.warn('[sandbox.k8s] sweep secret list failed:', err);
      return removed;
    }
    for (const secret of secrets.items) {
      const name = secret.metadata?.name;
      if (!name) continue;
      if (!shouldReapSecret(secret, opts, this.cfg, nowMs)) continue;
      await this.deleteSecret(name);
      removed += 1;
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

  /**
   * Create the per-exec Secret, disambiguating a name conflict (409) via the
   * pod: no pod (or an abandoned one) means a crashed prior attempt — replace
   * and proceed; a live young pod means a genuine duplicate dispatch — throw
   * DuplicateExecutionError so execute() fails WITHOUT cleaning up resources
   * the live owner depends on.
   *
   * @returns true when this call owns the Secret (created or replaced).
   */
  private async createSecretChecked(
    secret: V1Secret,
    podName: string,
  ): Promise<boolean> {
    try {
      await this.client.core.createNamespacedSecret(
        { namespace: this.client.namespace, body: secret },
        apiTimeout(),
      );
      return true;
    } catch (err) {
      if (httpStatusCode(err) !== 409 || !secret.metadata?.name) throw err;
    }
    let pod: V1Pod | undefined;
    try {
      pod = await this.readPod(podName);
    } catch (err) {
      if (httpStatusCode(err) !== 404) throw err;
    }
    if (pod !== undefined) {
      const phase = pod.status?.phase;
      const terminal = phase === 'Succeeded' || phase === 'Failed';
      const startedAt = Number(
        pod.metadata?.annotations?.['tale.dev/started-at'] ?? '0',
      );
      const abandoned =
        Number.isFinite(startedAt) &&
        startedAt > 0 &&
        startedAt < staleLifetimeCutoffMs(this.cfg, Date.now());
      if (!terminal && !abandoned) {
        throw new DuplicateExecutionError(
          `executionId already has a live pod (${podName}) — duplicate dispatch`,
        );
      }
      // Leftover from a crashed prior attempt — clear it so the new pod's
      // name is free.
      await this.deletePod(podName);
    }
    await this.client.core.replaceNamespacedSecret(
      {
        name: secret.metadata.name,
        namespace: this.client.namespace,
        body: secret,
      },
      apiTimeout(),
    );
    return true;
  }

  private async deleteSecret(name: string): Promise<void> {
    try {
      await this.client.core.deleteNamespacedSecret(
        { name, namespace: this.client.namespace },
        apiTimeout(),
      );
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(`[sandbox.k8s] delete secret ${name} failed:`, err);
      }
    }
  }

  /** @returns true when the pod existed and the delete was accepted. */
  private async deletePod(name: string): Promise<boolean> {
    try {
      await this.client.core.deleteNamespacedPod(
        { name, namespace: this.client.namespace, gracePeriodSeconds: 0 },
        apiTimeout(),
      );
      return true;
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(`[sandbox.k8s] delete pod ${name} failed:`, err);
      }
      return false;
    }
  }

  private readPod(podName: string): Promise<V1Pod> {
    // Bun's fetch occasionally throws a transient AbortError; retry so a single
    // hiccup doesn't fail the whole execution.
    return withRetry('read-pod', () =>
      this.client.core.readNamespacedPod(
        { name: podName, namespace: this.client.namespace },
        apiTimeout(),
      ),
    );
  }

  /** Last lines of the stage container's logs — the real staging error. */
  private async readStageLogTail(podName: string): Promise<string | undefined> {
    try {
      const logs = await readPodLog(this.client, podName, 'stage', {
        tailLines: 5,
        limitBytes: 4_096,
      });
      const tail = logs.trim();
      return tail.length > 0 ? tail : undefined;
    } catch (err) {
      console.warn(
        '[sandbox.k8s] stage log read failed:',
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
  }

  private async waitForRunnerStart(
    podName: string,
    signal: AbortSignal,
  ): Promise<StartupResult> {
    const deadline = Date.now() + STARTUP_BUDGET_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) return { kind: 'aborted' };
      let pod: V1Pod;
      try {
        pod = await this.readPod(podName);
      } catch (err) {
        if (httpStatusCode(err) === 404) {
          // Pod deleted out from under us — by a cancel (report it as such)
          // or externally.
          if (signal.aborted) return { kind: 'aborted' };
          return { kind: 'failed', message: 'pod deleted during startup' };
        }
        // Transient API failure — keep polling until the startup deadline.
        console.warn(
          '[sandbox.k8s] pod read failed during startup (will keep polling):',
          err instanceof Error ? err.message : err,
        );
        await sleep(POLL_INTERVAL_MS, signal);
        continue;
      }

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

  /**
   * Assemble the ExecuteResponse from the runner stdout buffer + the harvest
   * result line, routing every terminal shape through the shared constructors
   * in exec-response.ts (the cross-backend contract).
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
      started: HarvestStarted | null;
      runnerKilled?: { exitCode: number; reason?: string };
      backstop?: boolean;
    },
  ): ExecuteResponse {
    const durationMs = Date.now() - src.startedAtMs;
    let h = src.harvest;
    // A fatal fallback line carries a placeholder exitCode — recover the real
    // one from the started line, else treat the harvest result as missing.
    if (h?.fatal) {
      h =
        src.started !== null ? { ...h, exitCode: src.started.exitCode } : null;
    }

    const { text: stdoutCapped, truncated: stdoutCapTrunc } = capText(
      stripControlChars(stripPhaseMarkers(src.stdout)),
      cfg.stdoutMaxBytes,
    );
    const { text: stderrCapped, truncated: stderrCapTrunc } = capText(
      stripControlChars(h?.stderr ?? ''),
      cfg.stderrMaxBytes,
    );

    const steps =
      h?.steps ??
      (req.steps !== undefined ? synthesizeStepResults(req.steps) : undefined);

    const parts: ResponseParts = {
      stdoutCapped,
      stderrCapped,
      stdoutTruncated: src.stdoutStreamTruncated || stdoutCapTrunc,
      stderrTruncated: (h?.stderrTruncated ?? false) || stderrCapTrunc,
      durationMs,
      truncatedFiles: h?.truncatedFiles ?? 0,
      outputFiles: h?.outputFiles ?? [],
      ...(steps !== undefined && { steps }),
      uploadStats: h?.uploadStats ?? {
        attempted: 0,
        succeeded: 0,
        failures: [],
      },
      timing: {
        stageMs: h?.stageMs ?? 0,
        // Approximates the docker path's pre-harvest semantics; the residual
        // (pod scheduling/startup) is documented on ExecutionBackend.execute.
        executeMs: Math.max(
          0,
          durationMs - (h?.harvestMs ?? 0) - (h?.uploadMs ?? 0),
        ),
        harvestMs: h?.harvestMs ?? 0,
        uploadMs: h?.uploadMs ?? 0,
      },
      ...(h?.priorStage !== undefined && { priorStage: h.priorStage }),
    };

    if (src.aborted || opts.signal.aborted) {
      return buildCancelled(parts);
    }

    if (src.runnerKilled !== undefined) {
      return buildRunnerKilled(
        parts,
        src.runnerKilled.exitCode,
        src.runnerKilled.reason,
      );
    }

    if (h === null) {
      if (src.backstop === true) {
        return buildTimeoutBackstop(parts, 'harvest container never reported');
      }
      // No result line, but the started line may carry the runner's real exit
      // code (it prints before the harvest work begins) — don't mask a real
      // crash behind a harvest-read failure.
      const recovered = src.started?.exitCode ?? null;
      if (recovered !== null && recovered !== 0) {
        return buildRuntimeFailure(parts, recovered, stderrCapped);
      }
      return buildHarvestMissing(parts, recovered);
    }

    if (h.exitCode === 0) {
      return buildCompleted(parts, classifyHarvestError(h));
    }
    return buildRuntimeFailure(parts, h.exitCode, stderrCapped);
  }
}
