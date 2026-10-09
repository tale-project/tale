// KubernetesSessionBackend — persistent sessions on the Helm/K8s path.
//
// Sibling of KubernetesBackend (one-shot). One long-lived Pod per session
// (buildSessionPod) running runnerd; the spawner reaches runnerd at the Pod IP
// on :8200 over plain HTTP — exec-free, no kubectl exec/attach. A per-session
// Secret carries the runnerd token + seed env. Deterministic Pod/Secret names
// let any spawner replica address/destroy any session statelessly.

import {
  PatchStrategy,
  setHeaderOptions,
  type V1Pod,
  type V1Secret,
} from '@kubernetes/client-node';

import {
  operationSignal,
  outsideOperationBudget,
  withOperationBudget,
} from '../../operation-budget.ts';
import { waitForRunnerd } from '../../session/runnerd-client.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import { deriveRunnerdToken } from '../../session/session-naming.ts';
import { isAgentSessionProfile } from '../../session/session-profile.ts';
import type { SpawnerConfig } from '../../types.ts';
import { ID_ALPHABET_RE } from '../../wire.ts';
import {
  SessionExistsError,
  SessionIncarnationChangedError,
  type BackendSession,
  type BackendWorkspace,
  type CreateSessionResult,
  type OrganizationTeardownResult,
  type SessionBackend,
  type SessionSpec,
  type WorkspaceDeletion,
} from '../types.ts';
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
/** Label selecting every session's workspace PVC. */
const WORKSPACE_LABEL = 'tale.sandbox-session-ws';
const SESSION_ID_ANNOTATION = 'tale.dev/session-id';
const ORGANIZATION_ID_ANNOTATION = 'tale.dev/organization-id';
/** Pod annotation carrying the durable "always-on" pin (see setPinned). */
const PINNED_ANNOTATION = 'tale.dev/pinned';

/** A create that lost the deterministic-name race. A live Pod under the name
 * is a session the route answers as a duplicate, so the platform adopts it.
 * Anything else (a Pod terminating or ended, a peer's Secret whose Pod is not
 * there yet, a Pod that cannot be read) answers 502 and the platform retries;
 * by then adoption or the orphan reaps have settled the name. */
function conflictError(
  sessionId: string,
  cause: unknown,
  livePod: boolean,
): Error {
  if (livePod) {
    return new SessionExistsError(sessionId, 'a live Pod holds its name', {
      cause,
    });
  }
  return new Error(
    `session ${sessionId} already exists (concurrent create or unadopted live Pod)`,
    { cause },
  );
}

/** Margin past a create's budget before a Pod-less Secret counts as an
 * orphan rather than a peer replica's create in flight. */
const ORPHAN_SECRET_SLACK_MS = 60_000;

interface CreateOwnership {
  podUid?: string;
  secretUid?: string;
  podConflict?: boolean;
}

/** How often a create's start-failure watch reads the Pod. */
const START_FAILURE_POLL_MS = 1_000;
/** How often a create asks runnerd whether it is ready, as on Docker. */
const RUNNERD_READY_POLL_MS = 100;

/** Waiting reasons a session container does not recover from within a create:
 * the kubelet backs off a crashing container or an image it cannot pull, and
 * an invalid image or configuration never starts. */
const UNSTARTABLE_REASONS: ReadonlySet<string> = new Set([
  'CrashLoopBackOff',
  'ErrImagePull',
  'ImagePullBackOff',
  'ErrImageNeverPull',
  'InvalidImageName',
  'CreateContainerConfigError',
  'CreateContainerError',
]);

/** Why a session Pod's containers (the egress sidecar included) cannot
 * start, or undefined while they still may: the waiting reason, its message
 * and, for a crash, the last exit and the tail of its termination message. */
export function unstartableReason(pod: V1Pod): string | undefined {
  const statuses = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];
  for (const status of statuses) {
    const waiting = status.state?.waiting;
    if (
      waiting?.reason === undefined ||
      !UNSTARTABLE_REASONS.has(waiting.reason)
    )
      continue;
    const last = status.lastState?.terminated;
    const details = [
      waiting.message?.trim(),
      last === undefined
        ? undefined
        : `last exit ${last.exitCode}${last.reason ? ` (${last.reason})` : ''}${
            last.message?.trim() ? `: ${last.message.trim().slice(-500)}` : ''
          }`,
    ].filter((detail): detail is string => Boolean(detail));
    return `container ${status.name} ${waiting.reason}${details.length > 0 ? `: ${details.join('; ')}` : ''}`;
  }
  return undefined;
}

export class KubernetesSessionBackend implements SessionBackend {
  readonly kind = 'kubernetes' as const;
  private readonly client: K8sClient;

  constructor(
    private readonly cfg: SpawnerConfig,
    client?: K8sClient,
  ) {
    this.client = client ?? makeK8sClient(cfg.k8s.namespace);
  }

  /** runnerd token: derived from SANDBOX_TOKEN (always set — loadConfig fails
   * closed without it). Matches SessionRoutes.tokenFor. */
  private tokenFor(sessionId: string): string {
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
  }

  async createSession(spec: SessionSpec): Promise<CreateSessionResult> {
    const ownership: CreateOwnership = {};
    return withOperationBudget(
      this.cfg.session.createHealthTimeoutMs,
      async (signal) => {
        try {
          const created = await this.createSessionWithinBudget(spec, ownership);
          signal.throwIfAborted();
          return created;
        } catch (error) {
          // A cancelled create cannot spend its expired operation budget on
          // cleanup. Retain only acknowledged API identities across this
          // boundary; matching timestamps never establish attempt ownership.
          await outsideOperationBudget(() =>
            withOperationBudget(30_000, () =>
              this.cleanupFailedCreate(
                spec.sessionId,
                ownership.podUid,
                ownership.secretUid,
                ownership.podConflict,
              ),
            ),
          ).catch((cleanupError: unknown) => {
            console.warn(
              '[sandbox.session] failed pod create cleanup deferred:',
              cleanupError,
            );
          });
          throw error;
        }
      },
      spec.signal,
    );
  }

  private async createSessionWithinBudget(
    spec: SessionSpec,
    ownership: CreateOwnership,
  ): Promise<CreateSessionResult> {
    const deadline = Date.now() + this.cfg.session.createHealthTimeoutMs;
    // A pre-existing workspace PVC means this is a RESUME of a stopped session.
    // A failed create here must NOT delete that PVC (it holds the user's
    // preserved data). Failed creates always retain deterministic PVCs: a
    // peer may have mounted even a newly created claim.
    // Only agent sessions keep a workspace volume; a crawler render's
    // workspace lives and dies with its Pod (k8s-session-pod-spec.ts).
    const durable = isAgentSessionProfile(spec.profile);
    const preexisting =
      durable && (await this.workspacePvcExists(spec.sessionId));
    // On a resume (preexisting PVC) a Pod that died out-of-band can still hold
    // the deterministic Pod/Secret name and would 409 the create below — one
    // wasted, user-visible failed turn before the failed-create cleanup reaps
    // it. Reap a terminal orphan UP-FRONT so the resume is first-attempt clean
    // (parity with the Docker backend's reconcile-on-conflict). The
    // failed-create cleanup envelope remains the backstop for anything this
    // misses.
    if (preexisting) await this.reapTerminalPod(spec.sessionId);
    if (durable) {
      await this.ensureWorkspacePvc(spec.sessionId, spec.organizationId);
    }

    const secret: V1Secret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: sessionSecretNameFor(spec.sessionId),
        namespace: this.cfg.k8s.namespace,
        labels: { 'tale.sandbox-session': '1' },
        annotations: { 'tale.dev/created-at': String(spec.createdAtMs) },
      },
      stringData: {
        TALE_RUNNERD_TOKEN: this.tokenFor(spec.sessionId),
        ...(Object.keys(spec.env).length > 0
          ? { TALE_SESSION_ENV: JSON.stringify(spec.env) }
          : {}),
      },
    };
    const createSecret = () =>
      withRetry('create-session-secret', () =>
        this.client.core.createNamespacedSecret(
          { namespace: this.cfg.k8s.namespace, body: secret },
          apiTimeout(),
        ),
      );
    try {
      try {
        ownership.secretUid = (await createSecret()).metadata?.uid;
      } catch (err) {
        if (httpStatusCode(err) !== 409) throw err;
        // A first attempt that timed out client-side can still have been
        // stored: the Secret under the name is then this create's own, and
        // the create goes on to its Pod.
        if (!(await this.isOwnSecret(spec.sessionId, spec.createdAtMs))) {
          // A Secret whose Pod is long gone (deleted under the spawner by a
          // node drain or PodGC) would 409 every create of this session for
          // good: remove that orphan and try once more.
          if (!(await this.removeOrphanSecret(spec.sessionId))) throw err;
          ownership.secretUid = (await createSecret()).metadata?.uid;
        }
      }
    } catch (err) {
      // A 409 means the deterministic Secret name is TAKEN — a peer replica's
      // concurrent create (the route's `creating` set is per replica) or a
      // live Pod this replica has not adopted yet. That object is NOT ours to
      // tear down: the failed-create cleanup below would delete the RUNNING
      // peer Pod + Secret (and on the fresh path the PVC a concurrent ensure
      // may own). Surface the conflict without any cleanup — parity with the
      // Docker backend's name-conflict rule; adoptExisting / the route's
      // registry-miss re-resolve pick the live session up on a later turn.
      if (httpStatusCode(err) === 409) {
        throw conflictError(
          spec.sessionId,
          err,
          await this.livePodHolds(spec.sessionId),
        );
      }
      // An ambiguous response does not establish ownership. Preserve every
      // object without an acknowledged UID, and every workspace PVC.
      throw err;
    }
    // The Pod carries this creator's deadline, so a replacement spawner with
    // a shorter configured timeout never reaps a healthy peer's startup.
    try {
      const createdPod = await withRetry('create-session-pod', () =>
        this.client.core.createNamespacedPod(
          {
            namespace: this.cfg.k8s.namespace,
            body: buildSessionPod(this.cfg, {
              sessionId: spec.sessionId,
              organizationId: spec.organizationId,
              profile: spec.profile,
              ...(spec.docker === undefined ? {} : { docker: spec.docker }),
              createdAtMs: spec.createdAtMs,
              startupDeadlineMs: deadline,
            }),
          },
          apiTimeout(),
        ),
      );
      ownership.podUid = createdPod.metadata?.uid;
    } catch (err) {
      if (httpStatusCode(err) === 409) {
        // A first attempt that timed out client-side can still have been
        // stored: a 409 on the retry is then this create's own Pod, which
        // needs the Secret it references. Carry on to the readiness wait.
        if (!(await this.isThisIncarnation(spec.sessionId, spec.createdAtMs))) {
          // The Pod name is taken (a peer's Pod, or one still Terminating
          // from a stop/destroy in flight). Leave the Pod and the PVC alone —
          // only the Secret THIS call created is ours, and leaving it behind
          // would 409 every future create of this session forever.
          ownership.podConflict = true;
          throw conflictError(
            spec.sessionId,
            err,
            await this.livePodHolds(spec.sessionId),
          );
        }
      } else {
        throw err;
      }
    }

    // Poll runnerd readiness via the Pod IP (which appears once scheduled).
    // waitForEndpoint and waitForRunnerd share ONE budget: the time spent
    // waiting for the Pod IP is deducted from what runnerd readiness gets, so
    // a slow scheduler can't double-spend createHealthTimeoutMs. A container
    // that cannot start (a crash loop, an image the node cannot pull, a bad
    // configuration) ends both waits with its reason instead of letting them
    // run out the budget; a crash-looping container still gets a Pod IP, so
    // the watch runs beside the runnerd poll too.
    const startFailure = this.watchStartFailure(spec.sessionId, deadline);
    try {
      const endpoint = await Promise.race([
        this.waitForEndpoint(spec.sessionId, deadline, startFailure.signal),
        startFailure.failed,
      ]);
      const remainingMs = Math.max(0, deadline - Date.now());
      await Promise.race([
        waitForRunnerd(
          { baseUrl: endpoint, token: this.tokenFor(spec.sessionId) },
          remainingMs,
          RUNNERD_READY_POLL_MS,
          startFailure.signal,
        ),
        startFailure.failed,
      ]);
    } finally {
      startFailure.stop();
    }
    return { resumed: preexisting };
  }

  /** Is the Pod under the session's name the incarnation this create made
   * (its creation stamp, not being deleted)? A read that fails is "no". */
  private async isThisIncarnation(
    sessionId: string,
    createdAtMs: number,
  ): Promise<boolean> {
    try {
      const pod = await this.readPod(sessionId);
      return (
        pod.metadata?.deletionTimestamp == null &&
        pod.metadata?.annotations?.['tale.dev/created-at'] ===
          String(createdAtMs)
      );
    } catch (error) {
      console.warn(
        `[sandbox.session] cannot tell whose pod holds ${sessionId}'s name:`,
        error,
      );
      return false;
    }
  }

  /** Does a live Pod hold the session's name — one neither being deleted nor
   * ended (Succeeded/Failed)? A Pending Pod counts: a peer replica is still
   * starting it. A read that fails is "no". */
  private async livePodHolds(sessionId: string): Promise<boolean> {
    try {
      const pod = await this.readPod(sessionId);
      const phase = pod.status?.phase;
      return (
        pod.metadata?.deletionTimestamp == null &&
        phase !== 'Succeeded' &&
        phase !== 'Failed'
      );
    } catch (error) {
      if (httpStatusCode(error) !== 404) {
        console.warn(
          `[sandbox.session] cannot tell whether a live pod holds ${sessionId}'s name:`,
          error,
        );
      }
      return false;
    }
  }

  /** The session's Secret, read through `list`, which the Role grants (not
   * `get`): undefined when there is none, null when it cannot be read. */
  private async readSessionSecret(
    sessionId: string,
  ): Promise<V1Secret | undefined | null> {
    const secretName = sessionSecretNameFor(sessionId);
    try {
      const secrets = await this.client.core.listNamespacedSecret(
        {
          namespace: this.cfg.k8s.namespace,
          fieldSelector: `metadata.name=${secretName}`,
        },
        apiTimeout(),
      );
      return secrets.items.find((item) => item.metadata?.name === secretName);
    } catch (error) {
      console.warn(
        `[sandbox.session] cannot read ${sessionId}'s secret:`,
        error,
      );
      return null;
    }
  }

  /** Is the Secret under the session's name the one this create stored (its
   * creation stamp, not being deleted)? A read that fails is "no". */
  private async isOwnSecret(
    sessionId: string,
    createdAtMs: number,
  ): Promise<boolean> {
    const secret = await this.readSessionSecret(sessionId);
    return (
      secret != null &&
      secret.metadata?.deletionTimestamp == null &&
      secret.metadata?.annotations?.['tale.dev/created-at'] ===
        String(createdAtMs)
    );
  }

  /** Remove the session's Secret when it is an orphan: no Pod holds the name,
   * and it is older than a whole create's budget, so no create — a peer
   * replica's included — can still be making it. Fenced by its UID. Read
   * through `list`, which the Role grants (not `get`). Returns whether the
   * name is free now. */
  private async removeOrphanSecret(sessionId: string): Promise<boolean> {
    try {
      await this.readPod(sessionId);
      return false;
    } catch (error) {
      if (httpStatusCode(error) !== 404) {
        console.warn(
          `[sandbox.session] cannot tell whether ${sessionId}'s secret is an orphan:`,
          error,
        );
        return false;
      }
    }
    const secretName = sessionSecretNameFor(sessionId);
    const secret = await this.readSessionSecret(sessionId);
    if (secret === null) return false;
    if (secret === undefined) return true;
    const uid = secret.metadata?.uid;
    const created = secret.metadata?.creationTimestamp;
    const ageMs =
      created === undefined
        ? Number.NaN
        : Date.now() - new Date(created).getTime();
    if (
      !uid ||
      !Number.isFinite(ageMs) ||
      ageMs < this.cfg.session.createHealthTimeoutMs + ORPHAN_SECRET_SLACK_MS
    ) {
      return false;
    }
    try {
      await this.client.core.deleteNamespacedSecret(
        {
          name: secretName,
          namespace: this.cfg.k8s.namespace,
          body: { preconditions: { uid } },
        },
        apiTimeout(),
      );
    } catch (error) {
      if (httpStatusCode(error) !== 404) throw error;
    }
    console.warn(
      `[sandbox.session] removed ${sessionId}'s orphaned secret (its pod was deleted outside the spawner)`,
    );
    return true;
  }

  /** Remove ONLY the per-session Secret this create made (a Pod-name 409
   * means the Pod belongs to someone else). 404 = already gone = fine; any
   * other failure is logged, not thrown — the conflict is the error the
   * caller must see. */
  private async deleteOwnSecret(
    sessionId: string,
    uid: string | undefined,
  ): Promise<void> {
    if (uid === undefined) return;
    try {
      await this.client.core.deleteNamespacedSecret(
        {
          name: sessionSecretNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
          body: { preconditions: { uid } },
        },
        apiTimeout(),
      );
    } catch (err) {
      if (httpStatusCode(err) !== 404) {
        console.warn(
          `[sandbox.session] delete own secret for ${sessionId} after pod conflict failed:`,
          err,
        );
      }
    }
  }

  /** A failed create owns only UIDs acknowledged by the API. Workspace PVCs
   * survive every failure for retry or explicit destroy; they may already be
   * mounted by a concurrent creator. Unknown objects belong to recovery. */
  private async cleanupFailedCreate(
    sessionId: string,
    podUid: string | undefined,
    secretUid: string | undefined,
    podConflict = false,
  ): Promise<void> {
    if (podUid === undefined && secretUid === undefined) return;
    try {
      if (podConflict) {
        await this.deleteOwnSecret(sessionId, secretUid);
        return;
      }
      let pod: V1Pod | undefined;
      try {
        pod = await this.readPod(sessionId);
      } catch (error) {
        if (httpStatusCode(error) !== 404) throw error;
      }
      if (pod !== undefined) {
        // No acknowledged UID, or the name moved: never remove this Pod or
        // the Secret it may already use, even after a failed create reply.
        if (podUid === undefined || pod.metadata?.uid !== podUid) return;
        try {
          await this.deleteObservedPod(sessionId, pod);
        } catch (error) {
          if (httpStatusCode(error) === 409) return;
          throw error;
        }
      }
      await this.deleteOwnSecret(sessionId, secretUid);
    } catch (error) {
      console.warn(
        `[sandbox.session] failed-create cleanup skipped for ${sessionId}:`,
        error,
      );
    }
  }

  /** Observation-based cleanup must never transfer a deletion verdict to a
   * replacement UID or to a Pod whose phase changed after the observation. */
  private async deleteObservedPod(
    sessionId: string,
    pod: V1Pod,
  ): Promise<void> {
    const uid = pod.metadata?.uid;
    const resourceVersion = pod.metadata?.resourceVersion;
    if (!uid || !resourceVersion) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'pod identity is incomplete',
      );
    }
    try {
      await this.client.core.deleteNamespacedPod(
        {
          name: sessionPodNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
          gracePeriodSeconds: 5,
          body: { preconditions: { uid, resourceVersion } },
        },
        apiTimeout(),
      );
    } catch (error) {
      if (httpStatusCode(error) !== 404) throw error;
    }
  }

  /** Read the Pod until status.podIP is assigned, then return the runnerd URL. */
  /** Watch the session's Pod while a create waits on it: `failed` rejects
   * with the reason once a container cannot start, and `signal` aborts then
   * or at stop(), so the waits beside it end too. A read that fails says
   * nothing about the containers; the next one, a second later, asks again. */
  private watchStartFailure(
    sessionId: string,
    deadlineMs: number,
  ): { failed: Promise<never>; signal: AbortSignal; stop: () => void } {
    const ended = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = new Promise<never>((_, reject) => {
      const look = async () => {
        if (ended.signal.aborted || Date.now() > deadlineMs) return;
        try {
          const reason = unstartableReason(await this.readPod(sessionId));
          if (reason !== undefined) {
            const error = new Error(
              `session ${sessionId} cannot start: ${reason}`,
            );
            ended.abort(error);
            reject(error);
            return;
          }
        } catch (err) {
          console.warn(
            `[sandbox.k8s] reading session ${sessionId}'s Pod while it starts failed (asked again in ${START_FAILURE_POLL_MS} ms):`,
            err,
          );
        }
        if (!ended.signal.aborted) {
          timer = setTimeout(() => void look(), START_FAILURE_POLL_MS);
        }
      };
      timer = setTimeout(() => void look(), START_FAILURE_POLL_MS);
    });
    // Raced by the create; a rejection after the race settled is not lost.
    failed.catch(() => undefined);
    return {
      failed,
      signal: ended.signal,
      stop: () => {
        if (timer !== undefined) clearTimeout(timer);
        if (!ended.signal.aborted) ended.abort();
      },
    };
  }

  private async waitForEndpoint(
    sessionId: string,
    deadlineMs: number,
    giveUp?: AbortSignal,
  ): Promise<string> {
    for (;;) {
      operationSignal()?.throwIfAborted();
      giveUp?.throwIfAborted();
      const ip = (await this.readPod(sessionId))?.status?.podIP;
      if (ip) return `http://${ip}:${RUNNERD_PORT}`;
      if (Date.now() > deadlineMs) {
        throw new Error(`session ${sessionId} pod never got an IP`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async resolveEndpoint(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<string> {
    const pod = await this.readPod(sessionId);
    if (
      expectedCreatedAtMs !== undefined &&
      this.observedCreationStamp(sessionId, pod) !== expectedCreatedAtMs
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'pod changed before endpoint resolution',
      );
    }
    const ip = pod.status?.podIP;
    if (!ip) throw new Error(`session ${sessionId} has no pod IP`);
    return `http://${ip}:${RUNNERD_PORT}`;
  }

  async sessionExists(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    let pod;
    try {
      pod = await this.readPod(sessionId);
    } catch (err) {
      // Only a definitive 404 means "gone"; any other API failure is
      // "unknown" and must propagate per the interface contract.
      if (httpStatusCode(err) === 404) return false;
      throw err;
    }
    // Only a non-terminating Running Pod is present for session purposes.
    // A runner-container crash can restart in place within that same Pod.
    if (pod.metadata?.deletionTimestamp) return false;
    if (pod.status?.phase !== 'Running') return false;
    return (
      expectedCreatedAtMs === undefined ||
      this.observedCreationStamp(sessionId, pod) === expectedCreatedAtMs
    );
  }

  private observedCreationStamp(sessionId: string, pod: V1Pod): number {
    const raw = pod.metadata?.annotations?.['tale.dev/created-at'];
    const stamp = Number(raw);
    if (raw === undefined || raw.trim() === '' || !Number.isFinite(stamp))
      throw new Error(`session ${sessionId} pod creation stamp is unreadable`);
    return stamp;
  }

  /**
   * Resume helper: a session Pod that became terminal out-of-band (for example,
   * Failed after eviction) still occupies the deterministic
   * Pod/Secret name and would 409 the create on the next resume. Delete such a
   * PROVABLY-DEAD orphan (+ its Secret) and wait until the Pod object is gone,
   * so the recreate is first-attempt clean.
   *
   * Terminal/terminating Pods are stopped before resuming. Running and Unknown
   * Pods may still serve a peer replica, so leave them alone. Pending Pods
   * recover only after their original durable startup deadline, through the
   * age, incarnation and resource-version fences in reapStaleSession below.
   */
  private async reapTerminalPod(sessionId: string): Promise<void> {
    let pod: V1Pod;
    try {
      pod = await this.readPod(sessionId);
    } catch (err) {
      if (httpStatusCode(err) === 404) return; // already gone — nothing to reap
      throw err; // transient API error: fail the create; the platform retries
    }
    const phase = pod.status?.phase;
    const terminal =
      phase === 'Failed' ||
      phase === 'Succeeded' ||
      pod.metadata?.deletionTimestamp != null;
    if (!terminal) {
      // A crash while starting leaves no process to perform create cleanup.
      // The same age/state/incarnation fences as maintenance recover it.
      const stamp = Number(pod.metadata?.annotations?.['tale.dev/created-at']);
      if (Number.isSafeInteger(stamp) && stamp > 0)
        await this.reapStaleSession(sessionId, stamp);
      return;
    }
    const secret = await this.readSessionSecret(sessionId);
    const stamp = pod.metadata?.annotations?.['tale.dev/created-at'];
    const secretStamp = secret?.metadata?.annotations?.['tale.dev/created-at'];
    if (
      secret === null ||
      (secret !== undefined &&
        (!secret.metadata?.uid ||
          (secretStamp !== undefined && secretStamp !== stamp)))
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'terminal pod secret ownership is unknown',
      );
    }
    await this.deleteObservedPod(sessionId, pod);
    await this.deleteOwnSecret(sessionId, secret?.metadata?.uid);
    // Deletion is asynchronous (graceful termination), so poll until the Pod
    // object is gone — recreating against a still-Terminating Pod would 409.
    const deadline = Date.now() + this.cfg.session.createHealthTimeoutMs;
    for (;;) {
      try {
        const current = await this.readPod(sessionId);
        if (current.metadata?.uid !== pod.metadata?.uid) {
          throw new SessionIncarnationChangedError(
            sessionId,
            'replaced while terminating',
          );
        }
      } catch (err) {
        if (httpStatusCode(err) === 404) return; // gone
        throw err;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `session ${sessionId} pod stuck terminating past create timeout`,
        );
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** Delete the Pod + Secret, leaving the workspace PVC intact. Shared by
   * stopSession (keep PVC) and destroySession (which then deletes the PVC).
   * Returns whether the Pod existed. */
  private async removePodAndSecret(sessionId: string): Promise<boolean> {
    const podName = sessionPodNameFor(sessionId);
    let existed = false;
    // Attempt BOTH deletes even if the first hits a transient error, but
    // remember a non-404 failure and re-throw it after. stopSession/
    // destroySession document a throw-on-transient-hiccup contract (types.ts)
    // so the reaper retries on the next sweep — a swallowed error would
    // silently leak the Pod/Secret. 404 = already gone = success.
    let transient: unknown = null;
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
        transient ??= err;
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
        transient ??= err;
      }
    }
    if (transient) throw transient;
    return existed;
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const existed = await this.removePodAndSecret(sessionId);
    // A stopped session has no Pod, only its workspace: deleting that is the
    // destroy too.
    const hadWorkspace = await this.deleteWorkspacePvc(sessionId);
    return existed || hadWorkspace;
  }

  /** The PVC delete is this backend's deletion: once the API accepted it,
   * Kubernetes removes the claim when nothing mounts it, and the volume is
   * its storage provisioner's to delete under the storage class's reclaim
   * policy — bytes the spawner cannot observe. So the answer says exactly
   * that, never `done`, and the platform records which contract it settled
   * on. */
  async workspaceDeletion(): Promise<WorkspaceDeletion> {
    return 'handed_off';
  }

  async stopSession(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    // Release compute but PRESERVE the workspace PVC — a later createSession
    // re-mounts it (resume).
    if (expectedCreatedAtMs === undefined)
      return this.removePodAndSecret(sessionId);
    const podName = sessionPodNameFor(sessionId);
    let pod;
    try {
      pod = await this.readPod(sessionId);
    } catch (error) {
      if (httpStatusCode(error) === 404) return false;
      throw error;
    }
    const uid = pod.metadata?.uid;
    if (!uid) {
      throw new SessionIncarnationChangedError(sessionId, 'pod has no uid');
    }
    if (
      Number(pod.metadata?.annotations?.['tale.dev/created-at']) !==
      expectedCreatedAtMs
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'pod creation stamp moved',
      );
    }
    // Delete this incarnation's Secret first, fenced by its immutable UID: a
    // delayed/retried pressure stop must never remove a replacement's keys.
    // Read through `list` — the documented Role grants list/create/delete on
    // Secrets, not `get` (docs/kubernetes.md). A Secret from an older spawner
    // carries no creation stamp while a replacement always does, so only a
    // DIFFERENT stamp marks a replacement.
    const secretName = sessionSecretNameFor(sessionId);
    const secrets = await this.client.core.listNamespacedSecret(
      {
        namespace: this.cfg.k8s.namespace,
        fieldSelector: `metadata.name=${secretName}`,
      },
      apiTimeout(),
    );
    const secret = secrets.items.find(
      (item) => item.metadata?.name === secretName,
    );
    if (secret !== undefined) {
      const secretUid = secret.metadata?.uid;
      const stamp = secret.metadata?.annotations?.['tale.dev/created-at'];
      if (
        !secretUid ||
        (stamp !== undefined && Number(stamp) !== expectedCreatedAtMs)
      ) {
        throw new SessionIncarnationChangedError(
          sessionId,
          'secret belongs to another incarnation',
        );
      }
      try {
        await this.client.core.deleteNamespacedSecret(
          {
            name: secretName,
            namespace: this.cfg.k8s.namespace,
            body: { preconditions: { uid: secretUid } },
          },
          apiTimeout(),
        );
      } catch (error) {
        if (httpStatusCode(error) !== 404) throw error;
      }
    }
    try {
      await this.client.core.deleteNamespacedPod(
        {
          name: podName,
          namespace: this.cfg.k8s.namespace,
          gracePeriodSeconds: 5,
          body: { preconditions: { uid } },
        },
        apiTimeout(),
      );
    } catch (error) {
      if (httpStatusCode(error) !== 404) throw error;
    }
    // A DELETE acknowledgement still consumes compute during the grace period.
    // `sessionExists` deliberately treats terminating Pods as unavailable for
    // work; capacity needs the stronger, actual-disappearance proof here.
    const deadline = Date.now() + 10_000;
    for (;;) {
      let current;
      try {
        current = await this.readPod(sessionId);
      } catch (error) {
        if (httpStatusCode(error) === 404) return true;
        throw error;
      }
      if (current.metadata?.uid !== uid) {
        // Our Pod is gone (the delete was UID-fenced) and a peer replica has
        // already recreated the session under the name: not ours to count.
        throw new SessionIncarnationChangedError(
          sessionId,
          'replaced while terminating',
        );
      }
      if (Date.now() >= deadline)
        throw new Error(`session ${sessionId} is still terminating`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Pending after a whole startup budget and its grace is an abandoned
   * create, not a warm session. The apiserver's creation clock protects a
   * newly created peer even if its caller supplied an older creation stamp.
   * Unknown phases/node partitions remain occupied and are never stopped. */
  async reapStaleSession(
    sessionId: string,
    expectedCreatedAtMs: number,
  ): Promise<boolean> {
    let pod: V1Pod;
    try {
      pod = await this.readPod(sessionId);
    } catch (error) {
      if (httpStatusCode(error) === 404) return true;
      throw error;
    }
    const metadata = pod.metadata;
    const uid = metadata?.uid;
    const resourceVersion = metadata?.resourceVersion;
    const stamp = Number(metadata?.annotations?.['tale.dev/created-at']);
    const createdAt =
      metadata?.creationTimestamp === undefined
        ? Number.NaN
        : new Date(metadata.creationTimestamp).getTime();
    const declaredDeadline = Number(
      metadata?.annotations?.['tale.dev/startup-deadline'],
    );
    // Legacy Pods did not publish their creator's timeout. A full day is a
    // conservative compatibility grace; modern peers use their exact lease.
    const deadline =
      Number.isSafeInteger(declaredDeadline) &&
      declaredDeadline >= Math.max(createdAt, stamp)
        ? declaredDeadline
        : Math.max(createdAt, stamp) +
          Math.max(this.cfg.session.createHealthTimeoutMs, 86_400_000);
    if (
      pod.status?.phase !== 'Pending' ||
      metadata?.deletionTimestamp != null ||
      !uid ||
      !resourceVersion ||
      !Number.isSafeInteger(stamp) ||
      stamp <= 0 ||
      stamp !== expectedCreatedAtMs ||
      !Number.isFinite(createdAt) ||
      Date.now() <= deadline + ORPHAN_SECRET_SLACK_MS
    )
      return false;

    const secret = await this.readSessionSecret(sessionId);
    if (secret === null) return false;
    if (
      secret !== undefined &&
      (!secret.metadata?.uid ||
        Number(secret.metadata.annotations?.['tale.dev/created-at']) !== stamp)
    )
      return false;
    // UID prevents same-name replacement; resourceVersion prevents deleting a
    // Pod that became Running or changed while its Secret was being read.
    try {
      await this.client.core.deleteNamespacedPod(
        {
          name: sessionPodNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
          gracePeriodSeconds: 5,
          body: { preconditions: { uid, resourceVersion } },
        },
        apiTimeout(),
      );
    } catch (error) {
      if (httpStatusCode(error) === 409) return false;
      if (httpStatusCode(error) !== 404) throw error;
    }
    if (secret?.metadata?.uid !== undefined) {
      try {
        await this.client.core.deleteNamespacedSecret(
          {
            name: sessionSecretNameFor(sessionId),
            namespace: this.cfg.k8s.namespace,
            body: { preconditions: { uid: secret.metadata.uid } },
          },
          apiTimeout(),
        );
      } catch (error) {
        if (httpStatusCode(error) !== 404 && httpStatusCode(error) !== 409)
          throw error;
      }
    }
    // Retain occupancy while termination is still happening. The next pass
    // observes disappearance; never claim the acknowledgement freed compute.
    try {
      await this.readPod(sessionId);
      return false;
    } catch (error) {
      if (httpStatusCode(error) === 404) return true;
      throw error;
    }
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
   * durable home of /agent across stop/resume; only destroySession removes
   * it. Tolerates "already exists" (resume) and concurrent-create 409s. It
   * records its session and organization, so the workspace inventory can
   * name both while no Pod runs. */
  private async ensureWorkspacePvc(
    sessionId: string,
    organizationId: string,
  ): Promise<void> {
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
              labels: { [WORKSPACE_LABEL]: '1' },
              annotations: {
                [SESSION_ID_ANNOTATION]: sessionId,
                [ORGANIZATION_ID_ANNOTATION]: organizationId,
              },
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

  /** Delete the session's workspace PVC (data deletion — destroy path only);
   * false when there was none (404).
   * THROWS on any failure other than 404 (retried first for transient blips):
   * destroySession is the one data-deleting verb, and a swallowed PVC failure
   * would let the route answer destroyed:true while the user's data — and its
   * storage — survive with nothing left to reclaim it. A throw makes the route
   * answer 502 destroyed:false so the platform retries. */
  private async deleteWorkspacePvc(sessionId: string): Promise<boolean> {
    const name = sessionWorkspacePvcNameFor(sessionId);
    try {
      await withRetry('delete-session-workspace-pvc', () =>
        this.client.core.deleteNamespacedPersistentVolumeClaim(
          { name, namespace: this.cfg.k8s.namespace },
          apiTimeout(),
        ),
      );
      return true;
    } catch (err) {
      if (httpStatusCode(err) === 404) return false; // already gone = success
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `k8s session: failed to delete workspace PVC ${name} for ${sessionId}: ${msg}`,
        { cause: err },
      );
    }
  }

  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    // Retried for transient blips, then THROWN — never `[]`: the callers (boot
    // + periodic adoption, the route layer's re-resolve) read an empty list as
    // "no sessions", so an apiserver hiccup laundered into [] would leave every
    // running session Pod unregistered — unroutable and never reaped — until
    // the next successful list. The caller logs and retries next tick.
    const resp = await withRetry('list-session-pods', () =>
      this.client.core.listNamespacedPod(
        {
          namespace: this.cfg.k8s.namespace,
          labelSelector: SESSION_LABEL_SELECTOR,
        },
        apiTimeout(),
      ),
    );
    const out: BackendSession[] = [];
    for (const pod of resp.items) {
      const ann = pod.metadata?.annotations ?? {};
      const sessionId = ann['tale.dev/session-id'];
      const org = ann['tale.dev/organization-id'] ?? '';
      if (!sessionId) continue;
      if (organizationId && org !== organizationId) continue;
      const phase = pod.status?.phase;
      out.push({
        sessionId,
        organizationId: org,
        profile: isAgentSessionProfile(ann['tale.dev/profile'])
          ? ann['tale.dev/profile']
          : 'default',
        ...(ann['tale.dev/docker'] === undefined
          ? {}
          : { docker: ann['tale.dev/docker'] === 'true' }),
        createdAtMs: Number(ann['tale.dev/created-at']) || 0,
        ttlMs: this.cfg.session.maxLifetimeMs,
        idleTimeoutMs: this.cfg.session.maxIdleMs,
        state: phase === 'Running' ? 'ready' : 'degraded',
        pinned: ann[PINNED_ANNOTATION] === 'true',
        ended: phase === 'Succeeded' || phase === 'Failed',
      });
    }
    return out;
  }

  /** Every session's workspace PVC, joined with the session Pods beside
   * them. A PVC is touched at its creation (it has no mtime); one without a
   * valid session annotation is not a workspace this spawner made. Both
   * lists THROW after their retries, never answer `[]` for "couldn't tell". */
  async listWorkspaces(): Promise<BackendWorkspace[]> {
    const claims = await withRetry('list-session-workspace-pvcs', () =>
      this.client.core.listNamespacedPersistentVolumeClaim(
        {
          namespace: this.cfg.k8s.namespace,
          labelSelector: `${WORKSPACE_LABEL}=1`,
        },
        apiTimeout(),
      ),
    );
    const pods = new Map(
      (await this.listSessions()).map((session) => [
        session.sessionId,
        session,
      ]),
    );
    const workspaces: BackendWorkspace[] = [];
    for (const claim of claims.items) {
      const annotations = claim.metadata?.annotations ?? {};
      const sessionId = annotations[SESSION_ID_ANNOTATION];
      if (sessionId === undefined || !ID_ALPHABET_RE.test(sessionId)) continue;
      const created = claim.metadata?.creationTimestamp;
      const pod = pods.get(sessionId);
      const organizationId =
        pod?.organizationId || annotations[ORGANIZATION_ID_ANNOTATION] || '';
      workspaces.push({
        sessionId,
        touchedAtMs: created === undefined ? 0 : new Date(created).getTime(),
        active: pod !== undefined && pod.ended !== true,
        pinned: pod?.pinned === true,
        ...(organizationId !== '' ? { organizationId } : {}),
      });
    }
    return workspaces;
  }

  // Kubernetes sessions keep nothing per organization beyond their own
  // workspace PVCs: DinD builds inside the Pod, and there are no shared
  // package caches.
  async listOrganizationResources(): Promise<string[]> {
    return [];
  }

  async teardownOrganization(): Promise<OrganizationTeardownResult> {
    return { containers: 0, volumes: 0, networks: 0 };
  }

  /**
   * The durable pin lives on the session Pod as an annotation, so every
   * spawner replica (the Deployment is multi-replica, stateless) re-adopts it
   * from the same object. A new Pod (fresh create or resume) carries none —
   * a new session starts unpinned and the platform re-pushes its pin; stop /
   * destroy delete the Pod and the annotation with it. Needs `patch` on pods
   * in the spawner Role (docs/kubernetes.md).
   */
  async setPinned(
    sessionId: string,
    pinned: boolean,
    expectedCreatedAtMs?: number,
  ): Promise<void> {
    let fence: { uid: string; resourceVersion: string } | undefined;
    if (expectedCreatedAtMs !== undefined) {
      const pod = await this.readPod(sessionId);
      const uid = pod.metadata?.uid;
      const resourceVersion = pod.metadata?.resourceVersion;
      if (
        !uid ||
        !resourceVersion ||
        Number(pod.metadata?.annotations?.['tale.dev/created-at']) !==
          expectedCreatedAtMs
      ) {
        throw new SessionIncarnationChangedError(
          sessionId,
          'pod changed before pin persistence',
        );
      }
      fence = { uid, resourceVersion };
    }
    await withRetry('pin-session-pod', () =>
      this.client.core.patchNamespacedPod(
        {
          name: sessionPodNameFor(sessionId),
          namespace: this.cfg.k8s.namespace,
          body: {
            metadata: {
              ...fence,
              annotations: { [PINNED_ANNOTATION]: pinned ? 'true' : 'false' },
            },
          },
        },
        setHeaderOptions(
          'Content-Type',
          PatchStrategy.MergePatch,
          apiTimeout(),
        ),
      ),
    );
  }

  // No shared cross-session build cache on K8s (DinD is single-container,
  // in-pod — there is no sibling buildkitd to reconcile). See SessionBackend.
  async reconcileBuildCache(): Promise<void> {}

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
