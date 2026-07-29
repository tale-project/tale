// KubernetesBackend — the Helm host lifecycle. Every sandbox run is a session
// now (KubernetesSessionBackend), so this backend no longer executes Pods: it
// owns only the spawner's host-level lifecycle — API/RBAC connectivity (init),
// the /health probe, and the periodic orphan sweep that reaps leaked one-shot
// pods/Secrets (`tale.sandbox=1`), of which none are created anymore. Session
// pods (`tale.sandbox/role=session`) are swept by the session TTL/idle reaper.

import type { V1Pod, V1Secret } from '@kubernetes/client-node';

import type { SpawnerConfig } from '../../types.ts';
import type { ExecutionBackend, HealthResult, SweepOptions } from '../types.ts';
import { secretNameFor } from './exec-spec.ts';
import {
  apiTimeout,
  httpStatusCode,
  makeK8sClient,
  type K8sClient,
} from './k8s-client.ts';
import { ensureSessionEgressPolicy } from './k8s-network-policy.ts';

// Max time a one-shot runner had to start (covers stage staging + scheduling +
// a cold image pull) — retained as a term in the stale-lifetime cutoff below.
export const STARTUP_BUDGET_MS = 180_000;
// Backstop beyond the user timeout for a one-shot harvest container to exit.
export const HARVEST_BACKSTOP_MS = 120_000;
// A just-terminated pod still belongs to its owner for the harvest-log reads;
// only reap terminal pods whose containers finished at least this long ago.
export const TERMINAL_REAP_GRACE_MS = 60_000;
// Margin on top of the worst-case execution lifetime for the stale sweep.
export const SWEEP_SLACK_MS = 60_000;

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
    // Egress fence: apply the default-deny NetworkPolicy on
    // tale.sandbox/role=session pods ourselves rather than leave it to an
    // operator to remember (the gap that left k8s SSRF/IMDS-reachable). Warn —
    // don't hard-fail — on failure: the SA may lack networkpolicy RBAC while the
    // operator applies an equivalent policy externally, and a fatal here would
    // wedge the spawner on upgrade for clusters that worked before. Enforcement
    // still needs a NetworkPolicy-capable CNI (Calico/Cilium/…), which the
    // apiserver accepting the object cannot confirm.
    try {
      await ensureSessionEgressPolicy(this.client);
    } catch (err) {
      console.error(
        '[sandbox.k8s] could NOT apply the session egress NetworkPolicy — the ' +
          'cluster is wide-open to SSRF/IMDS unless an equivalent policy is ' +
          'applied externally. Grant the ServiceAccount create/patch on ' +
          'networking.k8s.io/networkpolicies, or apply the policy yourself:',
        err instanceof Error ? err.message : err,
      );
    }
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
}
