// KubernetesSessionBackend — persistent sessions on the Helm/K8s path.
//
// Sibling of KubernetesBackend (one-shot). One long-lived Pod per session
// (buildSessionPod) running runnerd; the spawner reaches runnerd at the Pod IP
// on :8200 over plain HTTP — exec-free, no kubectl exec/attach. A per-session
// Secret carries the runnerd token + seed env. Deterministic Pod/Secret names
// let any spawner replica address/destroy any session statelessly.

import type { V1Pod, V1Secret } from '@kubernetes/client-node';

import { waitForRunnerd } from '../../session/runnerd-client.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import { deriveRunnerdToken } from '../../session/session-naming.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { BackendSession, SessionBackend, SessionSpec } from '../types.ts';
import {
  apiTimeout,
  httpStatusCode,
  makeK8sClient,
  withRetry,
  type K8sClient,
} from './k8s-client.ts';
import {
  buildSessionPod,
  sessionPodNameFor,
  sessionSecretNameFor,
  sessionWorkspacePvcNameFor,
} from './k8s-session-pod-spec.ts';

const SESSION_LABEL_SELECTOR = 'tale.sandbox-session=1';

export class KubernetesSessionBackend implements SessionBackend {
  readonly kind = 'kubernetes' as const;
  private readonly client: K8sClient;

  constructor(
    private readonly cfg: SpawnerConfig,
    client?: K8sClient,
  ) {
    this.client = client ?? makeK8sClient(cfg.k8s.namespace);
  }

  private tokenFor(sessionId: string): string {
    if (this.cfg.sandboxToken === null) return '';
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
  }

  async createSession(spec: SessionSpec): Promise<void> {
    // A pre-existing workspace PVC means this is a RESUME of a stopped session.
    // A failed create here must NOT delete that PVC (it holds the user's
    // preserved data) — stop instead. Fresh creates clean up fully.
    const preexisting = await this.workspacePvcExists(spec.sessionId);
    await this.ensureWorkspacePvc(spec.sessionId);

    const secret: V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: sessionSecretNameFor(spec.sessionId),
        namespace: this.cfg.k8s.namespace,
        labels: { 'tale.sandbox-session': '1' },
      },
      stringData: {
        TALE_RUNNERD_TOKEN: this.tokenFor(spec.sessionId),
        ...(Object.keys(spec.env).length > 0
          ? { TALE_SESSION_ENV: JSON.stringify(spec.env) }
          : {}),
      },
    };
    try {
      await withRetry('create-session-secret', () =>
        this.client.core.createNamespacedSecret(
          { namespace: this.cfg.k8s.namespace, body: secret },
          apiTimeout(),
        ),
      );
    } catch (err) {
      // Same cleanup envelope as the Pod/readiness failures below: the PVC was
      // already created above, so a Secret failure must not leak it (a fresh
      // create has no ownerReference for K8s GC to cascade from). Resume keeps
      // the PVC (stop), fresh destroys it.
      await this.cleanupFailedCreate(spec.sessionId, preexisting);
      throw err;
    }
    try {
      await withRetry('create-session-pod', () =>
        this.client.core.createNamespacedPod(
          {
            namespace: this.cfg.k8s.namespace,
            body: buildSessionPod(this.cfg, {
              sessionId: spec.sessionId,
              organizationId: spec.organizationId,
              profile: spec.profile,
              createdAtMs: spec.createdAtMs,
            }),
          },
          apiTimeout(),
        ),
      );
    } catch (err) {
      await this.cleanupFailedCreate(spec.sessionId, preexisting);
      throw err;
    }

    // Poll runnerd readiness via the Pod IP (which appears once scheduled).
    // waitForEndpoint and waitForRunnerd share ONE budget: the time spent
    // waiting for the Pod IP is deducted from what runnerd readiness gets, so
    // a slow scheduler can't double-spend createHealthTimeoutMs.
    const deadline = Date.now() + this.cfg.session.createHealthTimeoutMs;
    try {
      const endpoint = await this.waitForEndpoint(spec.sessionId, deadline);
      const remainingMs = Math.max(0, deadline - Date.now());
      await waitForRunnerd(
        { baseUrl: endpoint, token: this.tokenFor(spec.sessionId) },
        remainingMs,
      );
    } catch (err) {
      await this.cleanupFailedCreate(spec.sessionId, preexisting);
      throw err;
    }
  }

  /** On a failed create: stop (keep PVC) when resuming a session whose PVC
   * pre-existed, else destroy (delete the half-made PVC). */
  private async cleanupFailedCreate(
    sessionId: string,
    preexisting: boolean,
  ): Promise<void> {
    if (preexisting) {
      await this.stopSession(sessionId);
    } else {
      await this.destroySession(sessionId);
    }
  }

  /** Read the Pod until status.podIP is assigned, then return the runnerd URL. */
  private async waitForEndpoint(
    sessionId: string,
    deadlineMs: number,
  ): Promise<string> {
    for (;;) {
      const ip = (await this.readPod(sessionId))?.status?.podIP;
      if (ip) return `http://${ip}:${RUNNERD_PORT}`;
      if (Date.now() > deadlineMs) {
        throw new Error(`session ${sessionId} pod never got an IP`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async resolveEndpoint(sessionId: string): Promise<string> {
    const ip = (await this.readPod(sessionId))?.status?.podIP;
    if (!ip) throw new Error(`session ${sessionId} has no pod IP`);
    return `http://${ip}:${RUNNERD_PORT}`;
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    let pod;
    try {
      pod = await this.readPod(sessionId);
    } catch (err) {
      // Only a definitive 404 means "gone"; any other API failure is
      // "unknown" and must propagate per the interface contract.
      if (httpStatusCode(err) === 404) return false;
      throw err;
    }
    // A terminating or non-Running Pod (Succeeded/Failed after eviction, node
    // loss) is dead for session purposes — session Pods never restart.
    if (pod.metadata?.deletionTimestamp) return false;
    return pod.status?.phase === 'Running';
  }

  /** Delete the Pod + Secret, leaving the workspace PVC intact. Shared by
   * stopSession (keep PVC) and destroySession (which then deletes the PVC).
   * Returns whether the Pod existed. */
  private async removePodAndSecret(sessionId: string): Promise<boolean> {
    const podName = sessionPodNameFor(sessionId);
    let existed = false;
    try {
      await this.client.core.deleteNamespacedPod(
        {
          name: podName,
          namespace: this.cfg.k8s.namespace,
          gracePeriodSeconds: 5,
        },
        apiTimeout(),
      );
      existed = true;
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(`[sandbox.session] delete pod ${podName} failed:`, err);
      }
    }
    try {
      await this.client.core.deleteNamespacedSecret(
        {
          name: sessionSecretNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
        },
        apiTimeout(),
      );
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(`[sandbox.session] delete secret for ${sessionId}:`, err);
      }
    }
    return existed;
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const existed = await this.removePodAndSecret(sessionId);
    await this.deleteWorkspacePvc(sessionId);
    return existed;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    // Release compute but PRESERVE the workspace PVC — a later createSession
    // re-mounts it (resume).
    return this.removePodAndSecret(sessionId);
  }

  /** Does the session's workspace PVC already exist? (resume vs fresh create) */
  private async workspacePvcExists(sessionId: string): Promise<boolean> {
    try {
      await this.client.core.readNamespacedPersistentVolumeClaim(
        {
          name: sessionWorkspacePvcNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
        },
        apiTimeout(),
      );
      return true;
    } catch (err) {
      if (httpStatusCode(err) === 404) return false;
      // Unknown (API hiccup): assume it might exist so we don't risk a fresh
      // create racing a real PVC — ensureWorkspacePvc tolerates 409 anyway.
      console.warn(
        `[sandbox.session] read workspace PVC for ${sessionId} failed:`,
        err,
      );
      return true;
    }
  }

  /** Idempotently create the per-session workspace PVC (RWO). The PVC is the
   * durable home of /workspace across stop/resume; only destroySession removes
   * it. Tolerates "already exists" (resume) and concurrent-create 409s. */
  private async ensureWorkspacePvc(sessionId: string): Promise<void> {
    const name = sessionWorkspacePvcNameFor(sessionId);
    try {
      await this.client.core.readNamespacedPersistentVolumeClaim(
        { name, namespace: this.cfg.k8s.namespace },
        apiTimeout(),
      );
      return; // already exists (resume)
    } catch (err) {
      // 404 → create below. A non-404 read error (timeout / 503 during cluster
      // churn) is NOT fatal: fall through to a 409-tolerant create. If the PVC
      // already exists the create returns 409 (handled as success); if it
      // doesn't, the create makes it. Throwing here would fail the turn over a
      // transient read even though the create would have recovered.
      if (httpStatusCode(err) !== 404) {
        console.warn(
          `[sandbox.session] read workspace PVC ${name} failed (attempting create):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    // RWO: one Pod per session. Multi-node operators must supply a storage
    // class whose volumes can re-bind where a resume Pod schedules.
    const storageClassName = process.env.SANDBOX_K8S_CACHE_STORAGECLASS;
    try {
      await this.client.core.createNamespacedPersistentVolumeClaim(
        {
          namespace: this.cfg.k8s.namespace,
          body: {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: {
              name,
              labels: { 'tale.sandbox-session-ws': '1' },
              annotations: { 'tale.dev/session-id': sessionId },
            },
            spec: {
              accessModes: ['ReadWriteOnce'],
              ...(storageClassName ? { storageClassName } : {}),
              resources: {
                requests: { storage: this.cfg.k8s.workspaceSizeLimit },
              },
            },
          },
        },
        apiTimeout(),
      );
    } catch (err) {
      if (httpStatusCode(err) === 409) return; // concurrent ensure won
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `k8s session: failed to create workspace PVC ${name}: ${msg}`,
        {
          cause: err,
        },
      );
    }
  }

  /** Delete the session's workspace PVC (data deletion — destroy path only). */
  private async deleteWorkspacePvc(sessionId: string): Promise<void> {
    const name = sessionWorkspacePvcNameFor(sessionId);
    try {
      await this.client.core.deleteNamespacedPersistentVolumeClaim(
        { name, namespace: this.cfg.k8s.namespace },
        apiTimeout(),
      );
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(
          `[sandbox.session] delete workspace PVC for ${sessionId} failed:`,
          err,
        );
      }
    }
  }

  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    let resp;
    try {
      resp = await this.client.core.listNamespacedPod(
        {
          namespace: this.cfg.k8s.namespace,
          labelSelector: SESSION_LABEL_SELECTOR,
        },
        apiTimeout(),
      );
    } catch (err) {
      console.warn('[sandbox.session] listSessions failed:', err);
      return [];
    }
    const out: BackendSession[] = [];
    for (const pod of resp.items) {
      const ann = pod.metadata?.annotations ?? {};
      const sessionId = ann['tale.dev/session-id'];
      const org = ann['tale.dev/organization-id'] ?? '';
      if (!sessionId) continue;
      if (organizationId && org !== organizationId) continue;
      const running = pod.status?.phase === 'Running';
      out.push({
        sessionId,
        organizationId: org,
        profile: ann['tale.dev/profile'] === 'agent' ? 'agent' : 'default',
        createdAtMs: Number(ann['tale.dev/created-at']) || 0,
        ttlMs: this.cfg.session.maxLifetimeMs,
        idleTimeoutMs: this.cfg.session.maxIdleMs,
        state: running ? 'ready' : 'degraded',
      });
    }
    return out;
  }

  private readPod(sessionId: string): Promise<V1Pod> {
    return withRetry('read-session-pod', () =>
      this.client.core.readNamespacedPod(
        {
          name: sessionPodNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
        },
        apiTimeout(),
      ),
    );
  }
}
