// HTTP route handlers for the /v1/sessions API. Mounted by server.ts behind
// the same HMAC authorize() gate as the deploy routes. The handlers own session
// quota + registry bookkeeping; the SessionBackend owns container/Pod
// lifecycle and runnerd addressing; runnerd owns the actual exec.

import {
  SessionExistsError,
  SessionIncarnationChangedError,
  type BackendSession,
  type CreateSessionResult,
  type SessionBackend,
  type WorkspaceDeletion,
} from '../backend/types.ts';
import { reportSandboxError } from '../error-reporting.ts';
import {
  belowDiskCritical,
  belowDiskFloor,
  diskCriticalBytes,
  type HostDisk,
  type HostDiskSource,
  type SessionDiskState,
} from '../host-disk.ts';
import {
  memoryReserveBytes,
  sessionWorkingSetBytes,
  type HostMemory,
} from '../host-memory.ts';
import { jsonResponse } from '../http-util.ts';
import {
  operationSignal,
  outsideOperationBudget,
  waitWithinOperation,
  withOperationBudget,
} from '../operation-budget.ts';
import { sseResponse } from '../sse.ts';
import type { SpawnerConfig } from '../types.ts';
import type {
  SandboxErrorCode,
  SandboxSessionProfile,
  SessionExecResponse,
  SessionInfo,
} from '../wire.ts';
import {
  RunnerdActivityError,
  RunnerdAttachBusyError,
  RunnerdOutputGapError,
  RunnerdProtocolError,
  RunnerdStageBusyError,
  answeringIncarnation,
  runnerdActivity,
  runnerdAttach,
  runnerdCancelExec,
  runnerdDeleteFiles,
  runnerdEnvPatch,
  runnerdExec,
  runnerdExecStatus,
  runnerdExecCheckpoint,
  runnerdHealth,
  runnerdListDir,
  runnerdReadFile,
  runnerdStageFiles,
  runnerdWriteStdin,
} from './runnerd-client.ts';
import {
  parseRunnerdSequence,
  type RunnerdExecEvent,
  type RunnerdHealth,
} from './runnerd-protocol.ts';
import { deriveRunnerdToken } from './session-naming.ts';
import { SessionRegistry, type RegistrySession } from './session-registry.ts';
import {
  validateCreateSession,
  validateExecSession,
} from './validate-session.ts';
import type { LargestWorkspaces } from './workspace-usage.ts';

function b64decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function unavailableSessionResponse(): Response {
  return jsonResponse({ error: 'session_unavailable' }, 503, {
    'retry-after': '1',
  });
}

/** Namespace compute occupancy is independent of runnerd routability. */
interface BackendOccupancy {
  sessionIds: ReadonlySet<string>;
  degradedSessionIds: ReadonlySet<string>;
  startedAtMs: number;
  creatingWhenListed: ReadonlySet<string>;
}

/** How long a session whose runnerd failed a reclaim probe stays off the
 * candidate list — the periodic sweep re-probes everything anyway. */
const RECLAIM_PROBE_BACKOFF_MS = 30_000;

/** How long a session whose daemon answered that it cannot be reclaimed —
 * held by a turn, working, pinned, or too old for the claim — stays off the
 * candidate list. Nearly every running turn is a candidate by this replica's
 * own count (the platform ends each exec stream at its drain window and
 * follows the turn by attach), so creates refused at capacity used to probe
 * every busy session again, one after another. A release through this
 * spawner puts the session back on the list at once. */
const RECLAIM_BUSY_FOR_MS = 15_000;

/** Daemons one reclaim walk probes at most — the sessions last seen
 * released first, then idle-longest first: the next walk goes on past the
 * ones this one found busy. */
const RECLAIM_PROBES_PER_WALK = 8;

/** How long a walk that found nothing to reclaim answers the creates refused
 * after it: they are refused at once rather than each walking the same busy
 * sessions again. A release through this spawner ends the wait. */
const RECLAIM_NOTHING_FOR_MS = 3_000;

/** Does runnerd's answer allow a reclaim claim: a daemon that speaks the
 * claim protocol, released (or a claim already under way), unpinned, with
 * nothing in flight? */
function reclaimable(health: RunnerdHealth): boolean {
  const activity = health.activity;
  return (
    activity !== undefined &&
    !activity.pinned &&
    health.liveExecs === 0 &&
    activity.activeOperations === 0 &&
    (activity.released || activity.reclaiming)
  );
}

/** Longest an acquire waits for an in-flight create of the same id. Under
 * the platform's own acquire timeout, so a create that is still pulling its
 * image answers not-found (the caller retries) rather than a client timeout. */
const ACQUIRE_WAITS_FOR_CREATE_MS = 10_000;

/** Sessions one sweep probes at once: a pass is bounded by the slowest few
 * daemons, not by the sum of every probe (5 s each when a daemon hangs). */
const SWEEP_CONCURRENCY = 8;

/** Consecutive sweeps (one a minute) a running session's runnerd may fail to
 * answer before it is taken for wedged: its compute is stopped, the workspace
 * kept, so a slot and its limits are not held for the rest of a day-long TTL
 * by a container nothing can use. */
const WEDGED_PROBE_FAILURES = 5;

/** How long a liveness read waits for runnerd to name its incarnation before
 * asking the backend instead. A live daemon answers in milliseconds; one that
 * vanished can hold a connect for seconds (a cached address of a removed
 * container), and the platform's pre-turn probe must not wait that out. */
const LIVENESS_PROBE_TIMEOUT_MS = 1_500;

/** How long removing an ended container/Pod that failed waits to be tried
 * again. */
const ENDED_REAP_BACKOFF_MS = 10 * 60_000;

/** How long a stop lets a session with a live exec end its work before its
 * compute is killed. runnerd passes the stop on to every exec and exits
 * within 2 s (a harness writes its transcript, a wrapper restores what it
 * staged); a Docker-in-sandbox session's supervisor also shuts its inner
 * engine down, and dockerd waits up to 15 s for its own containers. An idle
 * session's stop kills at once: it has nothing to end. */
const BUSY_STOP_GRACE_MS = 5_000;
const BUSY_DOCKER_STOP_GRACE_MS = 20_000;

/** Busy sessions the linger reap stops at once: each graceful stop holds a
 * docker CLI slot for up to its grace, and the rest stay for the others. */
const LINGER_STOP_CONCURRENCY = 4;

/** How long the linger reap waits for a session's runnerd to say whether it
 * is busy, under the ordinary 5 s probe: a hung daemon holds one of its four
 * lanes no longer than this, and is stopped at once after it. */
const LINGER_HEALTH_PROBE_MS = 3_000;

/** While the session disk is critical, its largest workspaces are logged at
 * most this often (each measurement is a bounded `du` of every workspace). */
const WORKSPACE_USAGE_LOG_MS = 10 * 60_000;
const WORKSPACES_LOGGED = 3;
const GIB = 1024 ** 3;

/** How long a session that just started keeps part of its planned working
 * set reserved at admission: its turn is still growing toward it while
 * MemAvailable shows only the idle footprint. The reservation shrinks
 * linearly to nothing over this window. */
const YOUNG_SESSION_RESERVE_MS = 90_000;

/** The first-come line for host room. A create refused for want of room
 * waits its turn: the room that frees next goes to the oldest waiter still
 * asking, not to whichever create happens to arrive first — a waiter that
 * asks rarely (a task run woken every two minutes) would otherwise lose to
 * every one that asks often. Each refusal tells the waiter when its place
 * comes up: the front asks again in QUEUE_FRONT_HINT_MS, each place behind
 * it QUEUE_STEP_HINT_MS later, up to QUEUE_MAX_HINT_MS. */
const QUEUE_FRONT_HINT_MS = 5_000;
const QUEUE_STEP_HINT_MS = 5_000;
const QUEUE_MAX_HINT_MS = 60_000;
/** A waiter holds its place while it asks again within twice its hint and
 * this much more; one that stopped asking (its run was cancelled, its
 * worker died) gives its place up after that. */
const QUEUE_LIVE_SLACK_MS = 15_000;
/** The most waiters the line keeps; past it the one that asked longest ago
 * goes. */
const QUEUE_CAP = 10_000;

/** A create refused for want of room, waiting its turn. */
interface RoomWaiter {
  /** When it last asked. */
  lastAtMs: number;
  /** The hint the last refusal gave it. */
  hintMs: number;
  /** The working set it is planned with, held for it while it is ahead. */
  workingSetBytes: number;
  /** A warm activation already holds a runtime slot; only creates need one. */
  needsSlot: boolean;
}

/** A sweep's idle decision, checked again atomically by runnerd before it
 * freezes the incarnation. New work must win over this health snapshot. */
interface IdleReclaim {
  health: RunnerdHealth;
  beforeMs: number;
}

/** Run `work` over `items`, at most `limit` at a time. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, lane),
  );
}

/** Longest a create waits for the removal of the same id's ended compute
 * (a container that exited with the host's reboot, say) under way: well
 * under the platform's create timeout, and past it the create answers busy
 * and the caller retries. */
const CREATE_WAITS_FOR_ENDED_REAP_MS = 30_000;

/** Longest a create waits for a destroy of the same id under way. A destroy
 * settles once the compute is gone and the workspace moved aside (Docker
 * deletes it in the background), so the wait is normally short; past this
 * the destroy is taken for wedged (a hung daemon or filesystem) and the
 * create answers busy. */
const CREATE_WAITS_FOR_DESTROY_MS = 120_000;

/** How long a destroy asked to await its deletion (`?await_deletion=1`)
 * waits for the workspace's bytes before answering how far they came: well
 * inside the 30 s the platform gives a destroy, and enough for most. */
const DESTROY_AWAITS_DELETION_MS = 10_000;

/** Where admission reads the host's memory from. */
export interface HostMemorySource {
  latest(): HostMemory | null;
  read(fresh?: boolean): Promise<HostMemory | null>;
}

const NO_HOST_MEMORY: HostMemorySource = {
  latest: () => null,
  read: () => Promise.resolve(null),
};

const NO_HOST_DISK: HostDiskSource = {
  latest: () => null,
  read: () => Promise.resolve(null),
};

/** Whether `promise` settles, either way, within `ms`. */
export async function settlesWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class SessionRoutes {
  private readonly registry = new SessionRegistry();
  /** Existing nonterminal backend objects without a routable daemon still
   * occupy capacity (notably Pending Pods after a spawner restart). */
  private unregistered = new Map<string, BackendSession>();
  private readonly activityOperations = new Map<string, Promise<void>>();
  private readonly activating = new Map<string, RegistrySession>();
  private readonly pinOperations = new Map<string, Promise<void>>();
  /** A failed durable pin is unpublished, but keeps its incarnation safe until retry. */
  private readonly pinProtection = new Map<string, RegistrySession>();
  private readonly activeGenerations = new Map<
    string,
    { generation: string; admittedAtMs: number }
  >();
  // Session ids with a createSession in flight → their organization. The
  // registry is only populated AFTER the backend create resolves (up to
  // createHealthTimeoutMs later, through an image pull), so this map closes
  // the gap a concurrent create would otherwise slip through: the same id
  // (a duplicate) AND the deployment cap, which counts in-flight creates as
  // occupied capacity — a burst of distinct ids during a slow pull must not
  // oversubscribe the host by the number of creates in flight.
  private readonly creating = new Map<string, string>();
  // The working set each create in flight is planned with: memory a starting
  // session is about to take that MemAvailable does not show yet.
  private readonly creatingBytes = new Map<string, number>();
  private readonly acquiring = new Map<string, Promise<Response>>();
  // Sessions that started a moment ago, with the working set they were
  // planned with: what they are still growing into (YOUNG_SESSION_RESERVE_MS).
  private readonly youngBytes = new Map<
    string,
    { bytes: number; sinceMs: number }
  >();
  // The first-come line for host room, by session id, in the order of first
  // refusal — the map's own order (QUEUE_FRONT_HINT_MS). Memory only: a
  // restart starts it afresh.
  private readonly waiters = new Map<string, RoomWaiter>();
  // Settles when the create of that id leaves `creating` (success or
  // failure): an acquire for an id still being created waits for it instead
  // of answering a false not-found that the caller would turn into a
  // duplicate create.
  private readonly createSettled = new Map<
    string,
    PromiseWithResolvers<void>
  >();
  private admission: Promise<void> = Promise.resolve();
  // Reclaim claims runnerd has ACKNOWLEDGED — the daemon is frozen and no
  // work can start in that incarnation — bound to the incarnation they were
  // taken on. A claim outlives a failed backend stop so the next sweep or
  // acquire retries the fenced stop without a new probe (a container whose
  // daemon has since died is still ours to remove); it is dropped with the
  // incarnation, never carried onto a replacement under the same id.
  private readonly reclaimClaims = new Map<
    string,
    { claimId: string; createdAtMs: number }
  >();
  // Stops in flight (pressure reclaim or the sweep), shared so a concurrent
  // create at capacity or an acquire waits for the outcome. Every handle
  // settles to a boolean — a failed stop is `false`, never a rejection a
  // waiter would surface as a 500. Each is the stop of the incarnation the
  // registry holds.
  private readonly stopping = new Map<string, Promise<boolean>>();
  // Removals of ended compute in flight (reapEnded), by session id. Kept
  // apart from `stopping`: the incarnation they remove is never the one the
  // registry holds, so an acquire, a pressure reclaim or the sweep of the
  // registered session must not wait for it or count it as that session's
  // stop. A create of the id waits for it instead (handleCreate). Settles to
  // a boolean, never rejects.
  private readonly endedReaping = new Map<string, Promise<boolean>>();
  // Sessions whose runnerd did not answer a reclaim probe, by failure time:
  // skipped as reclaim candidates for a short window so one wedged daemon
  // (a full health timeout) does not stall every create at capacity.
  private readonly probeFailedAtMs = new Map<string, number>();
  // What each session's daemon last answered, to a reclaim probe or the
  // sweep's, about reclaiming it, and when; an acquire or a release through
  // this spawner counts as an answer too. One that cannot be reclaimed stays
  // off the candidate list for RECLAIM_BUSY_FOR_MS; one that can goes first,
  // so a walk capped at RECLAIM_PROBES_PER_WALK reaches it among hundreds of
  // busy sessions.
  private readonly reclaimSeen = new Map<
    string,
    { atMs: number; reclaimable: boolean }
  >();
  // Until when a create at capacity skips the reclaim walk: the last walk
  // found nothing (RECLAIM_NOTHING_FOR_MS).
  private nothingToReclaimUntilMs = 0;
  // The session disk's critical state as the last sweep saw it, so each
  // change is logged once; and the measurement of its largest workspaces.
  private diskWasCritical = {
    both: false,
    workspace: false,
    dockerData: false,
  };
  private workspaceUsageAtMs = Number.NEGATIVE_INFINITY;
  private workspaceUsage: Promise<void> | null = null;
  // Settles when the destroy of that id is done (success or failure):
  // destroys of one id run one after another, and a create of the id waits
  // for the one under way instead of racing its workspace removal.
  private readonly destroySettled = new Map<
    string,
    PromiseWithResolvers<void>
  >();

  // Backend lists behind ensureRegistered (the platform probes sessionIsAlive
  // + exec-status per turn, so a stopped session would otherwise cost one
  // `docker ps` / pod list PER probe). `resolving` is the list in flight;
  // `resolvingNext` the ONE follow-up every miss that arrives during it waits
  // for — a caller must only be answered by a snapshot taken after its miss.
  // Both `null` when idle; at most two lists are ever in flight.
  private resolving: Promise<BackendSession[]> | null = null;
  private resolvingNext: Promise<BackendSession[]> | null = null;

  // Concurrent adoption paths can discover the same incarnation in separate
  // fresh lists. Share only its in-flight endpoint lookup; a new incarnation
  // or a lookup after settlement must read the backend again.
  private readonly resolvingEndpoints = new Map<
    string,
    { createdAtMs: number; promise: Promise<string> }
  >();
  // The registry object is the fence: a recreate of the same id never joins
  // an old probe, even when both creations share a millisecond timestamp.
  // No settled liveness verdict is cached.
  private readonly checkingLiveness = new Map<
    RegistrySession,
    Promise<boolean>
  >();
  // Entries whose runnerd has named the incarnation they registered. Docker
  // reaches runnerd only through the running container of the session's
  // name, so such an answer proves what the backend's existence check would
  // (a `docker inspect` fork, 30-60 ms and ~28 MB): their acquire, release
  // ticket and release skip that check, since the request names the
  // incarnation and runnerd refuses it when a replacement answers, and their
  // session reads ask runnerd instead. Keyed by the entry, so a replacement
  // starts unproven; an answer naming none (an older runtime image) leaves
  // the entry on the backend's check.
  private readonly namingIncarnation = new WeakSet<RegistrySession>();

  // The maintenance pass in flight: a pass slower than its interval (hung
  // daemons, a slow dockerd) must not stack copies of itself.
  private maintaining: Promise<void> | null = null;
  // The build-cache upkeep in flight — the reconcile for organizations whose
  // agent sessions were just adopted, the retirement of legacy helpers, the
  // idle-helper sweep — and the organizations still waiting for a reconcile.
  // It runs beside the API and beside the maintenance pass, one job at a
  // time: recreating one organization's helpers takes seconds to minutes,
  // and a pass that waited for it held every session's sweep up with it.
  private buildCacheWork: Promise<void> | null = null;
  private readonly buildCacheOrgs = new Set<string>();
  // Consecutive failed health probes of a session's incarnation.
  private readonly probeFailures = new Map<
    string,
    { count: number; createdAtMs: number }
  >();
  // Ended compute whose removal failed, by failure time: retried after a
  // back-off rather than on (and logged by) every sweep.
  private readonly endedReapFailedAtMs = new Map<string, number>();
  // The removal of ended compute in flight, which runs beside the API: after
  // a host reboot every session container has ended.
  private reapingEnded: Promise<void> | null = null;

  /**
   * @param isDraining Read on every registry miss: a lingering (draining)
   * spawner must never adopt — the miss is a session its replacement created
   * behind the shared alias / VIP, and adopting it would keep the deploy
   * lingering and let the max-linger reap stop a live session another
   * replica owns. Same rule as server.ts skipping adoptExisting while
   * draining. Defaults to "never draining" for a routes instance with no
   * deploy control (tests).
   */
  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly backend: SessionBackend,
    private readonly isDraining: () => boolean = () => false,
    /** The Docker host's memory: `latest` without waiting (admission decides
     * with it inside its lock), `read` afresh. Null where it cannot be read
     * (a remote daemon, Kubernetes): admission then counts sessions only. */
    private readonly hostMemory: HostMemorySource = NO_HOST_MEMORY,
    /** The disk the workspaces live on: `latest` without waiting, `read`
     * afresh. Null where it cannot be read (Kubernetes, whose workspaces
     * are volumes of a fixed size): admission then ignores disk. */
    private readonly hostDisk: HostDiskSource = NO_HOST_DISK,
  ) {}

  /** Number of live sessions this spawner currently manages (drain readiness). */
  sessionCount(): number {
    return this.registry.size();
  }

  /** Creates that may not have a container/Pod yet, for capacity reporting. */
  pendingCreates(): ReadonlyMap<string, string> {
    return new Map(this.creating);
  }

  /** Does this spawner hold the session right now (live, or mid-create)? */
  holds(sessionId: string): boolean {
    return this.registry.has(sessionId) || this.creating.has(sessionId);
  }

  /** Live session ids — the deploy reads these from `/v1/drain-status` to decide
   * whether to LINGER this spawner (keep it serving its sessions) rather than
   * tear it down during an in-place roll. */
  sessionIds(): string[] {
    return this.registry.list().map((s) => s.sessionId);
  }

  /** Stop every non-finished session (compute reclaimed, workspace
   * preserved); a busy one gets a grace to end its work first.
   * Used by the spawner's max-linger self-reap so a spawner that lingered
   * past its TTL can shut down without orphaning containers — even if the
   * deploy died mid-roll. Returns the number stopped. */
  async stopAllSessions(): Promise<number> {
    let stopped = 0;
    await forEachLimited(
      this.registry.list(),
      LINGER_STOP_CONCURRENCY,
      async (s) => {
        // A stop already under way (a sweep's, an idle reclaim's) owns the
        // incarnation; a second one would cut its grace short. One that ends
        // without stopping it (a claim a turn won, a failed removal) leaves
        // the session to this reap's own stop.
        for (
          let pending = this.stopping.get(s.sessionId);
          pending !== undefined;
          pending = this.stopping.get(s.sessionId)
        ) {
          if (await pending) {
            stopped += 1;
            return;
          }
          if (this.registry.get(s.sessionId) !== s) return;
        }
        const stop = this.lingerGraceMs(s)
          .then((graceMs) =>
            this.backend.stopSession(s.sessionId, s.createdAtMs, { graceMs }),
          )
          .then(
            () => {
              this.forgetReclaimed(s);
              return true;
            },
            (err: unknown) => {
              if (err instanceof SessionIncarnationChangedError) {
                this.forgetReclaimed(s);
                return false;
              }
              console.warn(
                `[sandbox.session] linger stop failed for ${s.sessionId}:`,
                err,
              );
              return false;
            },
          )
          .finally(() => {
            if (this.stopping.get(s.sessionId) === stop)
              this.stopping.delete(s.sessionId);
          });
        this.stopping.set(s.sessionId, stop);
        if (await stop) stopped += 1;
      },
    );
    return stopped;
  }

  /** How long the linger reap lets this session's work end: a grace while
   * it is busy, none for an idle session. Busy is an exec through this
   * replica or, failing one, what runnerd counts: its live execs and its
   * operations under way. The platform follows a long turn by attach and
   * hangs up at every drain window, so an exec it is still draining is
   * usually registered nowhere here. A daemon that does not answer gets no
   * grace: it could not act on the stop. Never rejects. */
  private async lingerGraceMs(session: RegistrySession): Promise<number> {
    if (session.liveExecs.size === 0) {
      try {
        const health = await runnerdHealth(
          {
            baseUrl: session.endpoint,
            token: this.tokenFor(session.sessionId),
          },
          AbortSignal.timeout(LINGER_HEALTH_PROBE_MS),
        );
        if (
          health.liveExecs === 0 &&
          (health.activity?.activeOperations ?? 0) === 0
        )
          return 0;
      } catch (error) {
        console.warn(
          `[sandbox.session] linger health probe failed for ${session.sessionId}; stopping it without a grace:`,
          error,
        );
        return 0;
      }
    }
    return (session.docker ?? this.cfg.dockerInContainer)
      ? BUSY_DOCKER_STOP_GRACE_MS
      : BUSY_STOP_GRACE_MS;
  }

  /** runnerd token for a session: derived from SANDBOX_TOKEN (always set —
   * loadConfig fails closed without it, so every session carries a real
   * token and runnerd always verifies). */
  private tokenFor(sessionId: string): string {
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
  }

  /** Admission decisions run one at a time: the registry and `creating`
   * counts must never be read by two creates and then claimed by both. The
   * decision itself is synchronous; the slow work — the container create,
   * and reclaiming an idle session at capacity — runs outside the lock. */
  private async withAdmission<T>(decide: () => T): Promise<T> {
    const previous = this.admission;
    const gate = Promise.withResolvers<void>();
    this.admission = gate.promise;
    await previous;
    try {
      return decide();
    } finally {
      gate.resolve();
    }
  }

  private occupiedSlots(occupancy: BackendOccupancy | null): number {
    if (occupancy === null) {
      const ids = new Set([
        ...this.registry.list().map((s) => s.sessionId),
        ...this.creating.keys(),
        ...this.unregistered.keys(),
      ]);
      return ids.size;
    }
    const ids = new Set(occupancy.sessionIds);
    for (const id of this.creating.keys()) ids.add(id);
    // A local create can finish after the API sampled its list. It still
    // occupies a slot even though it has already left `creating`.
    for (const session of this.registry.list()) {
      if (
        session.createdAtMs >= occupancy.startedAtMs ||
        occupancy.creatingWhenListed.has(session.sessionId)
      )
        ids.add(session.sessionId);
    }
    return ids.size;
  }

  private async admissionOccupancy(): Promise<
    BackendOccupancy | null | Response
  > {
    if (this.backend.kind !== 'kubernetes') return null;
    const startedAtMs = Date.now();
    const creatingWhenListed = new Set(this.creating.keys());
    try {
      const sessions = await this.listForResolve();
      return {
        startedAtMs,
        creatingWhenListed,
        degradedSessionIds: new Set(
          sessions
            .filter((s) => s.ended !== true && s.state === 'degraded')
            .map((s) => s.sessionId),
        ),
        sessionIds: new Set(
          sessions.filter((s) => s.ended !== true).map((s) => s.sessionId),
        ),
      };
    } catch (error) {
      console.warn(
        '[sandbox.session] namespace admission inventory unavailable:',
        error,
      );
      return unavailableSessionResponse();
    }
  }

  /** The admission decision for one create: a duplicate id → 409, a disk
   * the workspaces live on below its floor → `'disk'`, a full host →
   * `'full'`, a host whose memory would drop below its reserve with every
   * create in flight at its planned working set → `'short'`, else the id is
   * reserved in `creating`. Synchronous, under the admission lock: each
   * create sees exactly the ones admitted before it. */
  private admit(
    sessionId: string,
    organizationId: string,
    workingSetBytes: number,
    occupancy: BackendOccupancy | null,
  ): Response | 'disk' | 'full' | 'short' | null {
    if (this.registry.has(sessionId) || this.creating.has(sessionId)) {
      return jsonResponse(
        {
          error: 'duplicate',
          message: `session ${sessionId} exists or is being created`,
        },
        409,
      );
    }
    if (
      occupancy !== null
        ? occupancy.degradedSessionIds.has(sessionId)
        : this.unregistered.get(sessionId)?.state === 'degraded'
    ) {
      return jsonResponse(
        {
          error: 'busy',
          message: `session ${sessionId} is still starting or recovering`,
        },
        429,
        { 'retry-after': '5' },
      );
    }
    if (occupancy?.sessionIds.has(sessionId)) {
      return jsonResponse(
        {
          error: 'duplicate',
          message: `session ${sessionId} exists or is being created`,
        },
        409,
      );
    }
    // A disk below its floor takes no session: every running one's next
    // write may be the one that fails.
    if (this.diskShort()) return 'disk';
    // Room that frees is the oldest waiters' first: a create gets in ahead
    // of them only where there is room for them as well.
    const occupied = this.occupiedSlots(occupancy);
    const ahead = this.waitersAhead(sessionId, Date.now());
    if (ahead.length > 0) {
      const free = this.cfg.session.maxSessions - occupied;
      if (free <= ahead.filter((waiter) => waiter.needsSlot).length)
        return 'full';
      // Memory is held only for waiters this host could ever fit: one that
      // asks for more than the host has beside its reserve must not keep
      // every create behind it out for as long as it keeps asking.
      const fits = this.memoryCeiling();
      let held = 0;
      for (const waiter of ahead) {
        if (fits === null || waiter.workingSetBytes <= fits) {
          held += waiter.workingSetBytes;
        }
      }
      if (this.memoryShort(workingSetBytes + held)) return 'short';
    }
    if (occupied >= this.cfg.session.maxSessions) return 'full';
    if (this.memoryShort(workingSetBytes)) return 'short';
    this.waiters.delete(sessionId);
    this.creating.set(sessionId, organizationId);
    this.creatingBytes.set(sessionId, workingSetBytes);
    this.createSettled.set(sessionId, Promise.withResolvers<void>());
    return null;
  }

  /** The most memory a session could ever be given here: the host's total
   * beside its reserve, or null when the host's memory is unknown. */
  private memoryCeiling(): number | null {
    let memory: HostMemory | null;
    try {
      memory = this.hostMemory.latest();
    } catch (error) {
      console.warn('[sandbox.session] host memory unreadable:', error);
      return null;
    }
    if (memory === null) return null;
    return (
      memory.totalBytes -
      memoryReserveBytes(memory.totalBytes, this.cfg.session.minFreeMemoryBytes)
    );
  }

  /** Is the disk the workspaces live on below its floor (the probe's last
   * reading)? An unknown disk never refuses. */
  private diskShort(): boolean {
    try {
      return belowDiskFloor(
        this.hostDisk.latest(),
        this.cfg.session.minFreeDiskBytes,
      );
    } catch (error) {
      console.warn('[sandbox.session] session disk unreadable:', error);
      return false;
    }
  }

  /** Which filesystems are below their critical tier (the probe's last
   * readings): the workspaces' own, whose largest workspaces are then
   * logged, and Docker's data root, where a Docker-in-sandbox session keeps
   * its inner image store, so a released one then stops. They are one disk
   * unless Docker's data root is watched apart. An unknown disk never is
   * critical. Each change is logged once per filesystem. */
  private diskCritical(): { workspace: boolean; dockerData: boolean } {
    let workspace: HostDisk | null;
    let dockerData: HostDisk | null | undefined;
    try {
      const apart = this.hostDisk.byFilesystem?.();
      workspace = apart ? apart.workspace : this.hostDisk.latest();
      dockerData = apart?.dockerData;
    } catch (error) {
      console.warn('[sandbox.session] session disk unreadable:', error);
      return { workspace: false, dockerData: false };
    }
    if (dockerData === undefined) {
      const both = this.criticalTransition('both', workspace);
      return { workspace: both, dockerData: both };
    }
    return {
      workspace: this.criticalTransition('workspace', workspace),
      dockerData: this.criticalTransition('dockerData', dockerData),
    };
  }

  private criticalTransition(
    filesystem: 'both' | 'workspace' | 'dockerData',
    disk: HostDisk | null,
  ): boolean {
    const { minFreeDiskBytes, criticalFreeDiskBytes } = this.cfg.session;
    const critical = belowDiskCritical(
      disk,
      minFreeDiskBytes,
      criticalFreeDiskBytes,
    );
    // A reading that is missing or a placeholder says nothing either way:
    // the last verdict stands, unlogged, until a real one lands.
    if (disk === null || disk.unavailable === true) return critical;
    if (critical === this.diskWasCritical[filesystem]) return critical;
    this.diskWasCritical[filesystem] = critical;
    const name =
      filesystem === 'dockerData' ? "Docker's data disk" : 'the session disk';
    const actions = {
      both: 'released Docker-in-sandbox sessions stop now and the largest workspaces are logged',
      workspace: 'the largest workspaces are logged',
      dockerData: 'released Docker-in-sandbox sessions stop now',
    }[filesystem];
    const free = `${(disk.availableBytes / GIB).toFixed(1)} GiB`;
    const tier = `${(diskCriticalBytes(disk.totalBytes, minFreeDiskBytes, criticalFreeDiskBytes) / GIB).toFixed(1)} GiB`;
    if (critical) {
      console.warn(
        `[sandbox.session] ${name} has ${free} free, below its critical ${tier}: running sessions are about to fail their writes; ${actions} (SANDBOX_CRITICAL_FREE_DISK)`,
      );
    } else {
      console.log(
        `[sandbox.session] ${name} has ${free} free again, above its critical ${tier}`,
      );
    }
    return critical;
  }

  /** Log the largest workspaces of a critical session disk: at most every
   * {@link WORKSPACE_USAGE_LOG_MS}, one measurement at a time, beside the
   * sweep rather than in its way. */
  private logLargestWorkspaces(): void {
    const now = Date.now();
    if (
      this.workspaceUsage !== null ||
      now - this.workspaceUsageAtMs < WORKSPACE_USAGE_LOG_MS
    )
      return;
    const measuring = this.backend.largestWorkspaces?.(WORKSPACES_LOGGED);
    if (measuring === undefined) return;
    this.workspaceUsageAtMs = now;
    this.workspaceUsage = this.sayLargestWorkspaces(measuring).finally(() => {
      this.workspaceUsage = null;
    });
  }

  private async sayLargestWorkspaces(
    measuring: Promise<LargestWorkspaces>,
  ): Promise<void> {
    let usage: LargestWorkspaces;
    try {
      usage = await measuring;
    } catch (error) {
      console.warn(
        '[sandbox.session] measuring the largest workspaces failed:',
        error,
      );
      return;
    }
    const { largest, measured, total } = usage;
    if (largest.length === 0) return;
    const sizes = largest
      .map(
        (entry) => `${entry.sessionId} ${(entry.bytes / GIB).toFixed(1)} GiB`,
      )
      .join(', ');
    const partial =
      measured < total
        ? ` (${measured} of ${total} workspaces measured in time)`
        : '';
    console.warn(
      `[sandbox.session] the session disk is critical; its largest workspaces: ${sizes}${partial}`,
    );
  }

  /** The disk read now, for upkeep that frees space on it and goes on only
   * while it is still short. */
  private async sessionDiskNow(): Promise<SessionDiskState | null> {
    try {
      const disk = await this.hostDisk.read(true);
      if (disk === null || disk.unavailable === true) return null;
      return {
        availableBytes: disk.availableBytes,
        short: belowDiskFloor(disk, this.cfg.session.minFreeDiskBytes),
        filesystem: disk.filesystem,
      };
    } catch (error) {
      console.warn('[sandbox.session] session disk unreadable:', error);
      return null;
    }
  }

  /** Would starting a session of this working set, beside every create in
   * flight at theirs and what the sessions that just started are still
   * growing into, leave the host less than its reserve? Unknown memory never
   * refuses. */
  private memoryShort(
    workingSetBytes: number,
    reacquiringSessionId?: string,
  ): boolean {
    let memory: HostMemory | null;
    try {
      memory = this.hostMemory.latest();
    } catch (error) {
      console.warn('[sandbox.session] host memory unreadable:', error);
      return false;
    }
    if (memory === null) return false;
    let starting = workingSetBytes;
    for (const bytes of this.creatingBytes.values()) starting += bytes;
    const now = Date.now();
    for (const [sessionId, young] of this.youngBytes) {
      const left = 1 - (now - young.sinceMs) / YOUNG_SESSION_RESERVE_MS;
      if (left <= 0) this.youngBytes.delete(sessionId);
      else if (sessionId !== reacquiringSessionId)
        starting += Math.round(young.bytes * left);
    }
    const reserve = memoryReserveBytes(
      memory.totalBytes,
      this.cfg.session.minFreeMemoryBytes,
    );
    return memory.availableBytes - starting < reserve;
  }

  private async reserveCreate(
    sessionId: string,
    organizationId: string,
    profile: SandboxSessionProfile,
    docker?: boolean,
  ): Promise<Response | null> {
    const workingSet = sessionWorkingSetBytes(
      profile,
      docker ?? this.cfg.dockerInContainer,
    );
    const observed =
      this.backend.kind === 'kubernetes'
        ? await this.admissionOccupancy()
        : null;
    if (observed instanceof Response) return observed;
    let occupancy = observed;
    let decision = await this.withAdmission(() =>
      this.admit(sessionId, organizationId, workingSet, occupancy),
    );
    if (decision === 'full' || decision === 'short') {
      // At capacity, or short of memory: try to reclaim ONE released idle
      // session, outside the admission lock (a probe per candidate and a
      // backend stop take seconds — creates that still have room must not
      // queue behind them), then decide again. Concurrent creates at capacity
      // share the one stop in flight and only the first to re-enter admission
      // gets its slot. Short of memory, the decision waits for a reading
      // taken after the reclaim.
      const short = decision === 'short';
      await this.reclaimOneIdle();
      if (short) await this.readHostMemory();
      const refreshed =
        this.backend.kind === 'kubernetes'
          ? await this.admissionOccupancy()
          : null;
      if (refreshed instanceof Response) return refreshed;
      occupancy = refreshed;
      decision = await this.withAdmission(() =>
        this.admit(sessionId, organizationId, workingSet, occupancy),
      );
    }
    if (decision === 'full' || decision === 'short' || decision === 'disk') {
      const place = this.waitInLine(sessionId, workingSet, Date.now());
      const retryAfter = String(Math.ceil(place.hintMs / 1000));
      const queue = { position: place.position, waiting: place.waiting };
      if (decision === 'disk') {
        // Stopping an idle session frees no disk (its workspace stays for
        // its resume): the build-cache upkeep gives back what it can.
        return jsonResponse(
          {
            error: 'host_disk',
            message:
              'the sandbox host is short of disk space; the session starts once some is freed',
            queue,
          },
          429,
          { 'retry-after': retryAfter },
        );
      }
      if (decision === 'full') {
        return jsonResponse(
          {
            error: 'session_quota',
            message: 'spawner session cap reached',
            queue,
          },
          429,
          { 'retry-after': retryAfter },
        );
      }
      return jsonResponse(
        {
          error: 'host_memory',
          message:
            'the sandbox host is short of memory; the session starts once running sessions free some',
          queue,
        },
        429,
        { 'retry-after': retryAfter },
      );
    }
    // Any other answer (admitted, a duplicate) ends the wait.
    this.waiters.delete(sessionId);
    return decision;
  }

  /** The live waiters refused before `sessionId` (all of them, for a create
   * not yet in line), oldest first: the line keeps the order of first
   * refusal, which a repeat never changes. Waiters that stopped asking
   * leave. */
  private waitersAhead(sessionId: string, now: number): RoomWaiter[] {
    const ahead: RoomWaiter[] = [];
    let reachedOwn = false;
    for (const [id, waiter] of this.waiters) {
      if (now - waiter.lastAtMs > 2 * waiter.hintMs + QUEUE_LIVE_SLACK_MS) {
        this.waiters.delete(id);
        continue;
      }
      if (id === sessionId) reachedOwn = true;
      else if (!reachedOwn) ahead.push(waiter);
    }
    return ahead;
  }

  /** Put a refused create or activation in line (keeping its place when it was in line
   * already) and say where it stands and when to ask again. */
  private waitInLine(
    sessionId: string,
    workingSetBytes: number,
    now: number,
    needsSlot = true,
  ): { position: number; waiting: number; hintMs: number } {
    const position = this.waitersAhead(sessionId, now).length;
    const hintMs = Math.min(
      QUEUE_FRONT_HINT_MS + position * QUEUE_STEP_HINT_MS,
      QUEUE_MAX_HINT_MS,
    );
    const known = this.waiters.get(sessionId);
    if (known !== undefined) {
      known.lastAtMs = now;
      known.hintMs = hintMs;
      known.workingSetBytes = workingSetBytes;
      known.needsSlot = needsSlot;
    } else {
      if (this.waiters.size >= QUEUE_CAP) this.dropStalestWaiter();
      this.waiters.set(sessionId, {
        lastAtMs: now,
        hintMs,
        workingSetBytes,
        needsSlot,
      });
    }
    return { position, waiting: this.waiters.size, hintMs };
  }

  private dropStalestWaiter(): void {
    let stalest: string | undefined;
    let stalestAtMs = Infinity;
    for (const [id, waiter] of this.waiters) {
      if (waiter.lastAtMs < stalestAtMs) {
        stalest = id;
        stalestAtMs = waiter.lastAtMs;
      }
    }
    if (stalest !== undefined) this.waiters.delete(stalest);
  }

  /** How many creates or activations wait in the line for host room. */
  roomQueueLength(): number {
    return this.waiters.size;
  }

  /** A fresh reading of the host's memory, for the next admission. */
  private async readHostMemory(): Promise<void> {
    try {
      await this.hostMemory.read(true);
    } catch (error) {
      console.warn('[sandbox.session] host memory unreadable:', error);
    }
  }

  /** Reclaim the released idle session that has been idle longest, if any.
   * Candidates that failed their last probe within the back-off window are
   * skipped: a wedged daemon costs one health timeout per window, not one per
   * create. So are candidates whose daemon said a moment ago that they cannot
   * be reclaimed, while those last seen reclaimable go first; a walk probes
   * at most RECLAIM_PROBES_PER_WALK daemons, and after a walk that found
   * nothing the creates refused next are answered at once. A candidate whose
   * claim is already acknowledged needs no probe. A candidate a concurrent
   * create is already stopping frees that create's slot, so each create at
   * capacity claims a session of its own and shares a sibling's stop only
   * when nothing else is left. */
  private async reclaimOneIdle(): Promise<boolean> {
    const now = Date.now();
    const idleSince = (session: RegistrySession) =>
      session.lastActivityAtMs ?? session.createdAtMs;
    const seenReclaimable = (session: RegistrySession) =>
      this.reclaimSeen.get(session.sessionId)?.reclaimable === true ? 0 : 1;
    const candidates = this.registry
      .list()
      .filter(
        (session) =>
          !session.pinned &&
          (this.pinProtection.get(session.sessionId) !== session ||
            this.reclaimClaims.has(session.sessionId)) &&
          session.liveExecs.size === 0 &&
          !this.activating.has(session.sessionId),
      )
      .sort(
        (a, b) =>
          seenReclaimable(a) - seenReclaimable(b) ||
          idleSince(a) - idleSince(b),
      );
    const walk = now >= this.nothingToReclaimUntilMs;
    if (walk) {
      let probes = 0;
      for (const session of candidates) {
        const sessionId = session.sessionId;
        if (this.stopping.has(sessionId)) continue;
        if (!this.reclaimClaims.has(sessionId)) {
          const failedAt = this.probeFailedAtMs.get(sessionId);
          if (
            failedAt !== undefined &&
            now - failedAt < RECLAIM_PROBE_BACKOFF_MS
          )
            continue;
          const seen = this.reclaimSeen.get(sessionId);
          if (
            seen !== undefined &&
            !seen.reclaimable &&
            now - seen.atMs < RECLAIM_BUSY_FOR_MS
          )
            continue;
          if (probes >= RECLAIM_PROBES_PER_WALK) continue;
          probes += 1;
        }
        if (await this.reclaimIdle(session)) return true;
      }
    }
    for (const session of candidates) {
      const pending = this.stopping.get(session.sessionId);
      if (pending !== undefined && (await pending)) return true;
    }
    if (walk)
      this.nothingToReclaimUntilMs = Date.now() + RECLAIM_NOTHING_FOR_MS;
    return false;
  }

  /** Remember whether this session can be reclaimed, as of now. */
  private noteReclaimable(sessionId: string, canBe: boolean): void {
    this.reclaimSeen.set(sessionId, { atMs: Date.now(), reclaimable: canBe });
  }

  /** runnerd's atomic claim closes the health-probe→stop race across replicas.
   * Busy and pinned sessions refuse; pressure also requires explicit release,
   * while expiry requires the negotiated atomic idle-clock cutoff.
   * A failed stop keeps its claim frozen and counted until a later retry.
   * Never rejects: a waiter sharing the stop sees `false`, not a 500. */
  private reclaimIdle(
    session: RegistrySession,
    idle?: IdleReclaim,
  ): Promise<boolean> {
    const pending = this.stopping.get(session.sessionId);
    if (pending !== undefined) return pending;
    if (
      session.pinned ||
      (this.pinProtection.get(session.sessionId) === session &&
        !this.reclaimClaims.has(session.sessionId)) ||
      session.liveExecs.size > 0 ||
      this.creating.has(session.sessionId)
    ) {
      return Promise.resolve(false);
    }
    const reclaim = this.stopClaimedIdle(session, idle).finally(() => {
      if (this.stopping.get(session.sessionId) === reclaim)
        this.stopping.delete(session.sessionId);
    });
    this.stopping.set(session.sessionId, reclaim);
    return reclaim;
  }

  private async stopClaimedIdle(
    session: RegistrySession,
    idle?: IdleReclaim,
  ): Promise<boolean> {
    const sessionId = session.sessionId;
    const opts = {
      baseUrl: session.endpoint,
      token: this.tokenFor(sessionId),
      incarnation: session.createdAtMs,
    };
    const held = this.reclaimClaims.get(sessionId);
    if (held !== undefined && held.createdAtMs !== session.createdAtMs) {
      // Taken on an incarnation that has since left the registry; it must
      // not follow the deterministic id onto this replacement.
      this.reclaimClaims.delete(sessionId);
    }
    try {
      if (!this.reclaimClaims.has(sessionId)) {
        const health = idle?.health ?? (await runnerdHealth(opts));
        if (this.registry.get(sessionId) !== session) return false;
        this.noteReclaimable(sessionId, reclaimable(health));
        const activity = health.activity;
        if (
          activity === undefined ||
          (idle === undefined
            ? !reclaimable(health)
            : activity.idleReclaim !== true ||
              activity.pinned ||
              health.liveExecs > 0 ||
              activity.activeOperations > 0)
        ) {
          return false;
        }
        const claimId = crypto.randomUUID();
        const result = await runnerdActivity(opts, 'reclaim', {
          claimId,
          generation: activity.generation,
          ...(idle !== undefined ? { idleBeforeMs: idle.beforeMs } : {}),
        });
        if (this.registry.get(sessionId) !== session) return false;
        if (result.claimed !== true) {
          // Acquired or touched between the probe and the claim: keep it.
          this.noteReclaimable(sessionId, false);
          return false;
        }
        // Frozen: nothing can start in this incarnation any more, so a
        // failed stop below is retried later without another probe.
        this.reclaimClaims.set(sessionId, {
          claimId,
          createdAtMs: session.createdAtMs,
        });
      }
      await this.backend.stopSession(sessionId, session.createdAtMs);
      if (await this.backend.sessionExists(sessionId)) {
        throw new Error('runtime still occupies capacity after stop');
      }
      this.forgetReclaimed(session);
      return true;
    } catch (error) {
      if (this.registry.get(sessionId) !== session) return false;
      // An older daemon has no claim route and cannot have frozen itself.
      if (error instanceof RunnerdActivityError && error.status === 404) {
        this.noteReclaimable(sessionId, false);
        return false;
      }
      if (
        error instanceof SessionIncarnationChangedError ||
        this.refusedAsReplaced(session, error)
      ) {
        // The backend object under this id is no longer the incarnation we
        // registered (a peer replica recreated it): our entry and claim are
        // stale, and the replacement is not ours to count as freed — the
        // next sweep adopts it.
        console.warn(
          `[sandbox.session] ${sessionId} was replaced under a pending idle stop; dropping the stale entry`,
        );
        this.forgetReclaimed(session);
        return false;
      }
      if (!this.reclaimClaims.has(sessionId)) {
        this.probeFailedAtMs.set(sessionId, Date.now());
      }
      // The stop may have completed despite a lost acknowledgement. Only a
      // disappeared backend object frees the slot: a terminating Pod is
      // still a RUNNING object in listSessions even though its ordinary
      // aliveness probe is false, while an exited container is not.
      try {
        if (
          !(await this.backend.sessionExists(sessionId)) &&
          !(await this.backend.listSessions()).some(
            (entry) => entry.sessionId === sessionId && entry.state === 'ready',
          )
        ) {
          this.forgetReclaimed(session);
          return true;
        }
      } catch (probeError) {
        console.warn(
          `[sandbox.session] backend state of ${sessionId} unknown after a failed idle stop (capacity stays occupied):`,
          probeError,
        );
      }
      console.warn(
        `[sandbox.session] idle reclaim deferred for ${sessionId} (workspace preserved):`,
        error,
      );
      return false;
    }
  }

  /** The incarnation is gone (stopped, or replaced): drop its registry entry
   * — only if the registry still holds THAT entry — and every reclaim mark. */
  private forgetReclaimed(session: RegistrySession): void {
    const current = this.registry.get(session.sessionId);
    if (current !== undefined && current !== session) return;
    if (this.registry.get(session.sessionId) === session) {
      this.registry.delete(session.sessionId);
    }
    if (
      this.unregistered.get(session.sessionId)?.createdAtMs ===
      session.createdAtMs
    )
      this.unregistered.delete(session.sessionId);
    this.forgetReclaimMarks(session.sessionId);
  }

  private forgetReclaimMarks(sessionId: string): void {
    this.reclaimClaims.delete(sessionId);
    this.probeFailedAtMs.delete(sessionId);
    this.reclaimSeen.delete(sessionId);
    this.probeFailures.delete(sessionId);
    // Its memory is the host's again: no reservation for it either.
    this.youngBytes.delete(sessionId);
    this.activeGenerations.delete(sessionId);
    this.pinProtection.delete(sessionId);
  }

  /**
   * Re-adoption: rebuild the in-memory registry from the backend objects still
   * running (the registry is a cache; the backend labels/annotations are the
   * source of truth). Idempotent for the same incarnation; replacements get
   * their own endpoint and lifecycle state. Called at boot AND on every
   * periodic sweep tick, so a session this spawner
   * missed (a boot-time `docker ps`/apiserver blip, a peer replica's create)
   * is registered within one interval and from then on routable + subject to
   * the TTL/idle reaper, instead of lingering unregistered for the life of the
   * process. Only RUNNING objects are adopted: a stopped/exited one is a
   * resumable state whose correct answer is 404 (the platform resumes it).
   */
  async adoptExisting(): Promise<void> {
    if (this.isDraining()) return;
    let sessions: BackendSession[];
    try {
      sessions = await this.backend.listSessions();
    } catch (err) {
      console.warn('[sandbox.session] adoptExisting list failed:', err);
      return;
    }
    if (this.isDraining()) return;
    const candidates: BackendSession[] = [];
    const ended: BackendSession[] = [];
    this.unregistered = new Map(
      sessions
        .filter((session) => session.ended !== true)
        .map((session) => [session.sessionId, session]),
    );
    const seen = new Set<string>();
    for (const s of sessions) {
      // A create in flight on this replica registers itself when it completes;
      // adopting it early would race that registration.
      if (
        this.registry.get(s.sessionId)?.createdAtMs === s.createdAtMs ||
        this.creating.has(s.sessionId) ||
        seen.has(s.sessionId)
      ) {
        continue;
      }
      if (s.ended === true) {
        seen.add(s.sessionId);
        ended.push(s);
        continue;
      }
      if (s.state !== 'ready') {
        if (this.backend.reapStaleSession !== undefined) ended.push(s);
        continue;
      }
      seen.add(s.sessionId);
      candidates.push(s);
    }
    // Each Kubernetes endpoint requires an API read. Resolve a bounded set
    // together so recovery waits for waves of calls, never their whole sum;
    // deduplicate before awaiting so a duplicate cannot take another lane.
    const adoptedIds = new Set<string>();
    await forEachLimited(candidates, SWEEP_CONCURRENCY, async (s) => {
      const adopted = await this.adoptSession(s);
      if (adopted !== undefined && !(adopted instanceof Response)) {
        adoptedIds.add(s.sessionId);
      }
    });
    // A drain that began during resolution ends this old spawner's adoption:
    // replacement-owned compute and build helpers stay with its successor.
    if (this.isDraining()) return;
    const adopted = candidates.filter((s) => adoptedIds.has(s.sessionId));
    // The removal runs beside the API: after a host reboot every session
    // container has ended, and removing each takes up to seconds (with its
    // inner image volume). A pass still under way covers what it listed; the
    // next sweep takes the rest.
    if (ended.length > 0 && this.reapingEnded === null) {
      this.reapingEnded = this.reapEnded(ended)
        .catch((error: unknown) => {
          console.warn(
            '[sandbox.session] removing ended compute failed:',
            error,
          );
        })
        .finally(() => {
          this.reapingEnded = null;
        });
    }

    // Heal the shared build cache for every org whose agent session was just
    // adopted (only agent sessions build). The buildkitd outlives the spawner,
    // so the same stack restart that bounced this spawner may have moved
    // sandbox-egress to a new IP — leaving the daemon's egress fence stale. An
    // adopted session that reuses it would build with no DNS/egress (the
    // createSession heal never fires for it). Best-effort inside the backend; a
    // no-op when there's no shared cache or nothing drifted. It runs beside the
    // API instead of ahead of it: a recreate per organization takes seconds to
    // minutes, and the sessions are routable as soon as they are registered.
    const builders = adopted
      .filter((s) => s.profile === 'agent' && s.docker !== false)
      .map((s) => s.organizationId);
    if (builders.length > 0) void this.maintainBuildCache(builders);
  }

  /** Start the build-cache upkeep, or join the job under way; organizations
   * named here are reconciled by it, or by the run that follows it. Never
   * rejects: a failure is logged and the next sweep asks again. */
  private maintainBuildCache(
    organizationIds: readonly string[] = [],
  ): Promise<void> {
    for (const organizationId of organizationIds) {
      this.buildCacheOrgs.add(organizationId);
    }
    this.buildCacheWork ??= this.runBuildCache().finally(() => {
      this.buildCacheWork = null;
      // Named while the last run was finishing: they get a run of their own.
      if (this.buildCacheOrgs.size > 0) void this.maintainBuildCache();
    });
    return this.buildCacheWork;
  }

  private async runBuildCache(): Promise<void> {
    do {
      const organizationIds = [...this.buildCacheOrgs];
      this.buildCacheOrgs.clear();
      try {
        // With no organization named, the backend retires drained legacy
        // helpers and stops idle ones without provisioning anything: the last
        // legacy session may just have stopped, letting its global helpers go.
        await this.backend.reconcileBuildCache(organizationIds, {
          sessionDisk: () => this.sessionDiskNow(),
        });
      } catch (error) {
        console.warn(
          organizationIds.length > 0
            ? '[sandbox.session] build-cache reconcile after adoption failed:'
            : '[sandbox.session] build-cache maintenance failed:',
          error,
        );
      }
    } while (this.buildCacheOrgs.size > 0);
  }

  /** Settles once no build-cache upkeep is under way. */
  async buildCacheSettled(): Promise<void> {
    while (this.buildCacheWork !== null) await this.buildCacheWork;
  }

  /** Settles once the removal of ended compute adoption started is done. */
  endedReapSettled(): Promise<void> {
    return this.reapingEnded ?? Promise.resolve();
  }

  /** Containers/Pods whose process ended for good — a host reboot or daemon
   * restart, an init killed by the OOM killer, an evicted Pod — are never
   * adopted, and nothing but a resume or a destroy used to remove them: the
   * container record stayed, and on Docker its inner image volume with it.
   * Remove their compute as an idle stop does, fenced to that incarnation and
   * keeping the workspace for the resume. */
  private async reapEnded(ended: readonly BackendSession[]): Promise<void> {
    const now = Date.now();
    await forEachLimited(ended, SWEEP_CONCURRENCY, async (s) => {
      const id = s.sessionId;
      const failedAt = this.endedReapFailedAtMs.get(id);
      if (
        this.registry.has(id) ||
        this.creating.has(id) ||
        this.stopping.has(id) ||
        this.endedReaping.has(id) ||
        this.destroySettled.has(id) ||
        (failedAt !== undefined && now - failedAt < ENDED_REAP_BACKOFF_MS)
      ) {
        return;
      }
      const removal =
        s.ended === true
          ? this.backend.stopSession(id, s.createdAtMs).then(() => true)
          : (this.backend.reapStaleSession?.(id, s.createdAtMs) ??
            Promise.resolve(false));
      const stop = removal
        .then(
          (removed) => {
            this.endedReapFailedAtMs.delete(id);
            if (
              removed &&
              this.unregistered.get(id)?.createdAtMs === s.createdAtMs
            )
              this.unregistered.delete(id);
            return removed;
          },
          (error: unknown) => {
            if (error instanceof SessionIncarnationChangedError) {
              // Replaced under the id meanwhile (a peer replica's create):
              // the ended incarnation is gone, and the new one is not ours.
              this.endedReapFailedAtMs.delete(id);
              return false;
            }
            this.endedReapFailedAtMs.set(id, Date.now());
            console.warn(
              `[sandbox.session] removing the ended compute of ${id} failed (retried in ${ENDED_REAP_BACKOFF_MS / 60_000} min):`,
              error,
            );
            return false;
          },
        )
        .finally(() => {
          this.endedReaping.delete(id);
        });
      this.endedReaping.set(id, stop);
      if (await stop) {
        console.log(
          `[sandbox.session] removed the ended compute of ${id} (workspace preserved for resume)`,
        );
      }
    });
  }

  /** One maintenance pass: adoption (never while draining — a lingering
   * spawner must not adopt, and later linger-reap, the sessions its
   * replacement is creating), then the reaper. A call while a pass is under
   * way joins it instead of starting another. The pass starts the removal of
   * ended compute and the build-cache upkeep and waits for neither: both run
   * beside it, so a slow one never holds up the next pass's sweep. */
  maintain(): Promise<void> {
    if (this.maintaining !== null) return this.maintaining;
    const pass = (async () => {
      if (!this.isDraining()) await this.adoptExisting();
      await this.sweepExpired();
    })().finally(() => {
      this.maintaining = null;
    });
    this.maintaining = pass;
    return pass;
  }

  /** Register one backend-listed session in the cache, resolving its runnerd
   * endpoint. An endpoint that cannot be observed is retryable, never proof
   * of a lost session. The sweep skips it and the next route miss retries. */
  private async adoptSession(
    s: BackendSession,
  ): Promise<RegistrySession | Response | undefined> {
    // A queued adoption or a route miss may reach this after draining began.
    // Only sessions already registered belong to the lingering spawner.
    const registered = this.registry.get(s.sessionId);
    if (registered?.createdAtMs === s.createdAtMs) return registered;
    if (this.adoptionBlocked(s.sessionId, registered)) return undefined;
    let endpoint: string;
    try {
      endpoint = await this.resolveForAdoption(s);
    } catch (err) {
      console.warn(
        `[sandbox.session] adopt skipped for ${s.sessionId} (endpoint unresolved; will retry):`,
        err instanceof Error ? err.message : err,
      );
      return unavailableSessionResponse();
    }
    // A concurrent create/adopt/destroy may have changed the captured entry
    // while we awaited. Its successor and reservations belong to that owner.
    const raced = this.registry.get(s.sessionId);
    if (raced !== registered) return raced;
    // A create that is still awaiting its backend has not registered yet.
    // It owns the id too: never adopt an older listing over its pending work.
    if (this.adoptionBlocked(s.sessionId, registered)) return undefined;
    const entry: RegistrySession = {
      sessionId: s.sessionId,
      organizationId: s.organizationId,
      profile: s.profile,
      ...(s.docker === undefined ? {} : { docker: s.docker }),
      state: s.state,
      createdAtMs: s.createdAtMs,
      expiresAtMs: s.createdAtMs + s.ttlMs,
      idleTimeoutMs: s.idleTimeoutMs,
      endpoint,
      liveExecs: new Map(),
      // The reaper exemption is re-read from the backend object's durable
      // record: a restart used to rebuild entries unpinned, and an always-on
      // session older than maxLifetime was TTL-stopped on the first sweep.
      pinned: s.pinned === true,
    };
    // Both endpoint and listed metadata describe the same verified stamp.
    // Abort old streams and drop their lifecycle marks, never the peer's compute.
    if (registered !== undefined) this.forgetReclaimed(registered);
    this.registry.set(entry);
    return entry;
  }

  private adoptionBlocked(
    sessionId: string,
    registered: RegistrySession | undefined,
  ): boolean {
    return (
      this.isDraining() ||
      this.creating.has(sessionId) ||
      this.stopping.has(sessionId) ||
      this.destroySettled.has(sessionId) ||
      (registered !== undefined &&
        (this.activating.has(sessionId) || this.pinOperations.has(sessionId)))
    );
  }

  private resolveForAdoption(session: BackendSession): Promise<string> {
    const pending = this.resolvingEndpoints.get(session.sessionId);
    if (pending?.createdAtMs === session.createdAtMs) return pending.promise;
    const promise = this.backend
      .resolveEndpoint(session.sessionId, session.createdAtMs)
      .finally(() => {
        // An older incarnation's completion must not clear its successor's slot.
        if (
          this.resolvingEndpoints.get(session.sessionId)?.promise === promise
        ) {
          this.resolvingEndpoints.delete(session.sessionId);
        }
      });
    this.resolvingEndpoints.set(session.sessionId, {
      createdAtMs: session.createdAtMs,
      promise,
    });
    return promise;
  }

  /**
   * Registry lookup that falls back to the backend on a miss. The registry is
   * a per-replica cache: a session created by a peer replica (K8s Deployment
   * behind a VIP) or missed at boot exists backend-side under its
   * deterministic name but is unknown here. Answering 404 from the cache alone
   * is the platform's "phantom session" signal — it would recreate a session
   * that is alive elsewhere (and on K8s that create 409s against the live
   * Pod). So a miss re-resolves: list the backend, adopt a RUNNING match, then
   * route to it. A stopped/exited object (or nothing) stays a genuine 404.
   * NOT while draining: a lingering spawner answers 404 for anything it does
   * not already own and leaves the session to the replacement serving it.
   */
  private async ensureRegistered(
    sessionId: string,
  ): Promise<RegistrySession | Response | undefined> {
    const hit = this.registry.get(sessionId);
    if (hit !== undefined) return hit;
    // Our own in-flight create registers itself on completion.
    if (this.creating.has(sessionId)) return unavailableSessionResponse();
    // A lingering spawner never adopts — 404 is the status quo; the
    // replacement serves the session (see the constructor's isDraining).
    if (this.isDraining()) return undefined;
    let sessions: BackendSession[];
    try {
      sessions = await this.listForResolve();
    } catch (err) {
      console.warn(
        `[sandbox.session] backend re-resolve for ${sessionId} unavailable (retry later):`,
        err instanceof Error ? err.message : err,
      );
      return unavailableSessionResponse();
    }
    const s = sessions.find((x) => x.sessionId === sessionId);
    if (s === undefined || s.ended === true) return undefined;
    if (s.state !== 'ready') return unavailableSessionResponse();
    return this.adoptSession(s);
  }

  /**
   * The backend list behind ensureRegistered. Concurrent misses share lists
   * instead of each spawning their own (health-probe.ts shape, without the
   * TTL — a resolve must see the current backend state), but a miss is only
   * answered by a list STARTED AFTER it: `docker ps` / a pod list is a
   * snapshot taken when it starts, so joining the one already in flight would
   * hand a probe for a session a peer replica created a moment ago a snapshot
   * from before it existed — a false 404 the platform reads as "gone" and
   * finalizes the turn on. So a miss with no list in flight starts one; every
   * miss that arrives while one is in flight is coalesced into ONE follow-up
   * list that starts once the current one settles (success or failure).
   */
  private listForResolve(): Promise<BackendSession[]> {
    if (this.resolving === null) return this.startResolve();
    if (this.resolvingNext === null) {
      // The in-flight list's outcome is its own callers' business — the
      // follow-up starts either way (a failed list must not strand joiners).
      this.resolvingNext = this.resolving
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          this.resolvingNext = null;
          return this.startResolve();
        });
    }
    return this.resolvingNext;
  }

  private startResolve(): Promise<BackendSession[]> {
    const list = this.backend.listSessions().finally(() => {
      // Only clear our own slot: a follow-up may already occupy it.
      if (this.resolving === list) this.resolving = null;
    });
    this.resolving = list;
    return list;
  }

  /**
   * TTL/idle reaper, called periodically. STOPS (releases compute, PRESERVES
   * the workspace) any session past its lifetime (cheap registry check) or idle
   * past its idle timeout (queried from runnerd's activity clock, so it stays
   * correct after a spawner restart). Neither idle nor TTL deletes data — only
   * an explicit Destroy does. The next turn resumes a stopped session by
   * re-creating against the preserved workspace. Returns the number reaped.
   */
  async sweepExpired(nowMs: number = Date.now()): Promise<number> {
    let reaped = 0;
    const critical = this.diskCritical();
    if (critical.workspace) this.logLargestWorkspaces();
    await forEachLimited(
      this.registry.list(),
      SWEEP_CONCURRENCY,
      async (session) => {
        if (await this.sweepSession(session, nowMs, critical.dockerData))
          reaped += 1;
      },
    );
    // The build helpers follow the sessions just stopped, beside the sweep
    // rather than inside it: the next sweep never waits for a slow recreate.
    void this.maintainBuildCache();
    return reaped;
  }

  /** Does this session keep the full idle window once released? A
   * Docker-in-sandbox session's resume starts its inner daemon on an empty
   * image store, so stopping it early would cost every turn a re-pull. An
   * engine that never started has no store to lose, so that session gets the
   * short window; a runtime that does not report its engine keeps the full
   * one. */
  private keepsFullIdleWindow(
    session: RegistrySession,
    health: RunnerdHealth,
  ): boolean {
    return (
      (session.docker ?? this.cfg.dockerInContainer) &&
      session.profile === 'agent' &&
      health.docker?.used !== false
    );
  }

  /** Count a failed health probe of this incarnation; returns the streak. */
  private noteProbeFailure(session: RegistrySession): number {
    const previous = this.probeFailures.get(session.sessionId);
    const count =
      previous !== undefined && previous.createdAtMs === session.createdAtMs
        ? previous.count + 1
        : 1;
    this.probeFailures.set(session.sessionId, {
      count,
      createdAtMs: session.createdAtMs,
    });
    return count;
  }

  /** The sweep's decision for one session: true when it stopped. */
  private async sweepSession(
    s: RegistrySession,
    nowMs: number,
    diskCritical = false,
  ): Promise<boolean> {
    if (this.reclaimClaims.has(s.sessionId)) return this.reclaimIdle(s);
    // Pinned ("always-on") sessions are exempt from BOTH idle and TTL reap.
    // Unprobed, a streak of failed probes from before no longer describes
    // the daemon, so it starts over.
    if (s.pinned || this.pinProtection.get(s.sessionId) === s) {
      this.probeFailures.delete(s.sessionId);
      // Always-on exempts live compute from idle stops, not confirmed-dead
      // backend objects from reconciliation. Unknown still stays held.
      return this.evictUnlessRunnerdNamesIt(s);
    }
    if (this.activating.has(s.sessionId)) return false;
    // A session with a live exec is NEVER reaped — a long, QUIET tool (no
    // stdout for >idleTimeout) would otherwise be idle-killed mid-task, and a
    // running task shouldn't be cut at the hard TTL either. The registry
    // tracks in-flight execs on this replica; after a spawner restart its
    // cache is cold, so the runnerd health.liveExecs check below is the
    // backstop for a re-adopted busy session. An exec running through this
    // replica shows its runnerd answers: any streak of failed probes ends.
    if (s.liveExecs.size > 0) {
      this.probeFailures.delete(s.sessionId);
      return false;
    }
    let expired = nowMs > s.expiresAtMs;
    let reason = expired ? 'lifetime' : 'idle';
    // Local exec cache is cold (e.g. a spawner restart re-adopted this session
    // with an empty liveExecs map), so consult runnerd's own clock. This probe
    // gates BOTH the idle AND the TTL reap: a re-adopted exec that's been
    // running past the hard TTL must not be stopped mid-task just because this
    // replica's liveExecs map is empty. Run it unconditionally (not only when
    // !expired) — that's the cold-cache backstop for a busy re-adopted session.
    try {
      const health = await runnerdHealth({
        baseUrl: s.endpoint,
        token: this.tokenFor(s.sessionId),
      });
      if (this.registry.get(s.sessionId) !== s) return false;
      // A replacement under the session's name answered: what it reports is
      // not this entry's to act on, and the entry's incarnation is gone.
      if (this.noteIncarnation(s, health.incarnation) === 'replaced')
        return this.evictStale(s, 'was replaced under its name');
      this.probeFailures.delete(s.sessionId);
      s.lastActivityAtMs = health.lastActivityAtMs;
      // What the sweep saw spares a create at capacity a probe of its own.
      this.noteReclaimable(s.sessionId, reclaimable(health));
      // Resume a frozen stop after a spawner restart through the same
      // generation and backend-incarnation fences as pressure admission.
      if (health.activity?.reclaiming) return this.reclaimIdle(s);
      if (
        health.activity?.pinned === true ||
        health.liveExecs > 0 ||
        (health.activity?.activeOperations ?? 0) > 0
      ) {
        return false;
      }
      if (
        health.dockerReady === false &&
        health.dockerRecoveryRequired === true
      ) {
        return this.reclaimIdle(s, { health, beforeMs: nowMs - 1 });
      }
      // A transient failure (or a legacy boolean-only health response) cannot
      // accelerate destruction. Normal idle/TTL expiry still bounds recovery.
      const idleForMs = nowMs - health.lastActivityAtMs;
      if (!expired) expired = idleForMs > s.idleTimeoutMs;
      if (expired && health.activity?.idleReclaim === true) {
        // An acquire changes the generation; a completed operation changes
        // the daemon's clock. Either wins over the sweep's stale snapshot.
        // TTL still expires a held but idle session, while a touch at or
        // after the sweep start defers that stop to the next pass.
        return this.reclaimIdle(s, {
          health,
          beforeMs: reason === 'lifetime' ? nowMs - 1 : nowMs - s.idleTimeoutMs,
        });
      }
      // Released by the platform (its turn or run settled, nothing holds it):
      // a few idle minutes are enough. The stop goes through runnerd's
      // claim, so a turn that acquires the session meanwhile keeps it. On a
      // critical session disk a released Docker-in-sandbox session goes at
      // once: its stop removes its inner image store, the most a stop gives
      // back, and its resume's re-pull costs less than the writes of every
      // running session failing.
      if (
        !expired &&
        health.activity?.released === true &&
        ((diskCritical && (s.docker ?? this.cfg.dockerInContainer)) ||
          (!this.keepsFullIdleWindow(s, health) &&
            idleForMs >
              Math.min(this.cfg.session.releasedIdleMs, s.idleTimeoutMs)))
      ) {
        return this.reclaimIdle(s);
      }
    } catch (err) {
      // runnerd unreachable. Distinguish a transient blip (leave for a
      // later sweep; the TTL is the hard backstop) from a ZOMBIE — the
      // backend object is gone but the cache entry survived. Without
      // this, a dead session lingers routable-but-unreachable until TTL.
      if (this.registry.get(s.sessionId) !== s) return false;
      console.warn(
        `[sandbox.session] sweep health probe failed for ${s.sessionId} (${s.endpoint}):`,
        err,
      );
      if (await this.evictIfBackendGone(s.sessionId)) {
        this.probeFailures.delete(s.sessionId);
        return true;
      }
      // Backend still present: a blip, or a daemon that is never coming
      // back. One that has not answered for several sweeps in a row holds a
      // slot nothing can use; stop it (the workspace stays for the resume).
      if (!expired && this.noteProbeFailure(s) >= WEDGED_PROBE_FAILURES) {
        expired = true;
        reason = 'unreachable';
      }
    }
    if (!expired) return false;
    // A pressure claim may have begun while the health probe awaited.
    // Its owner alone stops that incarnation, including retries.
    if (
      this.reclaimClaims.has(s.sessionId) ||
      this.stopping.has(s.sessionId) ||
      s.pinned ||
      s.liveExecs.size > 0
    ) {
      return false;
    }
    // Stop, never destroy: idle/TTL release compute but keep the workspace
    // so the session resumes with its data on the next turn. stopSession
    // THROWS on a transient backend hiccup (its contract) — keep the
    // registry entry so the next sweep retries, rather than dropping a
    // still-running container from the cache and orphaning it until a
    // restart re-adopts it. The stop is fenced to the incarnation this
    // entry describes: a replacement under the same id is never touched.
    // The shared handle settles to a boolean: an acquire or a create at
    // capacity waiting on it must see a failed stop as `false`, never as a
    // rejection it would answer with a 500.
    const stop = this.backend
      .stopSession(s.sessionId, s.createdAtMs)
      .then(
        () => {
          if (this.registry.get(s.sessionId) !== s) return false;
          this.forgetReclaimed(s);
          this.probeFailures.delete(s.sessionId);
          if (reason === 'unreachable') {
            console.warn(
              `[sandbox.session] stopped ${s.sessionId}: runnerd did not answer ${WEDGED_PROBE_FAILURES} sweeps in a row (workspace preserved)`,
            );
          }
          return true;
        },
        (err: unknown) => {
          if (err instanceof SessionIncarnationChangedError) {
            // A replacement now lives under the id; this entry is stale and
            // the next adoption registers the replacement.
            this.forgetReclaimed(s);
            return false;
          }
          console.warn(
            '[sandbox.session] sweep stop failed (will retry next sweep):',
            err,
          );
          return false;
        },
      )
      .finally(() => {
        if (this.stopping.get(s.sessionId) === stop)
          this.stopping.delete(s.sessionId);
      });
    this.stopping.set(s.sessionId, stop);
    return stop;
  }

  private toInfo(sessionId: string): SessionInfo | null {
    const s = this.registry.get(sessionId);
    if (!s) return null;
    return {
      sessionId: s.sessionId,
      organizationId: s.organizationId,
      profile: s.profile,
      ...(s.docker === undefined ? {} : { docker: s.docker }),
      // Sourced from the registry (set at create, refreshed by adoptExisting
      // from the backend) rather than a hardcoded literal, so the wire state
      // tracks the one field that records it instead of always saying 'ready'.
      state: s.state,
      backend: this.backend.kind,
      createdAtMs: s.createdAtMs,
      expiresAtMs: s.expiresAtMs,
      idleTimeoutMs: s.idleTimeoutMs,
      pinned: s.pinned === true,
      ...(this.pinProtection.get(sessionId) === s
        ? { pinSynchronized: false }
        : {}),
    };
  }

  /**
   * Zombie-registry eviction. The registry is a cache; the backend object can
   * disappear underneath it without any spawner involvement (manual
   * `docker rm`, OOM teardown, K8s Pod eviction / node loss). A zombie entry
   * then routes runnerd calls at a dead address — the platform sees transport
   * errors instead of the definitive 404 its phantom self-heal keys on, so
   * every turn fails without recovery.
   *
   * Called from runnerd-failure paths, and wherever a runnerd answer cannot
   * prove the registered incarnation (provesIncarnation): verifies the
   * backend object with the DEFINITIVE `sessionExists` check; on
   * confirmed-gone it evicts only the stale registry entry so this and
   * subsequent calls resolve to 404 → `SessionNotFoundError` → the platform
   * resumes the session in place (re-create against the PRESERVED workspace).
   * It does NOT delete the workspace: a gone container is now a resumable
   * stopped state, and data is removed only by a destroy (the explicit
   * Destroy, or the platform's workspace cleanup). A THROWING
   * check means "can't judge" (backend hiccup): keep the entry — a transient
   * blip must never evict a live session. Returns true when a stale entry was
   * evicted.
   */
  private evictIfBackendGone(sessionId: string): Promise<boolean> {
    const session = this.registry.get(sessionId);
    if (session === undefined) return Promise.resolve(false);
    // A terminating Pod is unavailable for work before its compute is gone.
    // Its stop owner keeps the slot until removal is actually confirmed.
    if (this.stopping.has(sessionId)) return Promise.resolve(false);
    const pending = this.checkingLiveness.get(session);
    if (pending !== undefined) return pending;
    const probe = this.checkBackendGone(session).finally(() => {
      this.checkingLiveness.delete(session);
    });
    this.checkingLiveness.set(session, probe);
    return probe;
  }

  private async checkBackendGone(session: RegistrySession): Promise<boolean> {
    const { sessionId } = session;
    let alive: boolean;
    try {
      alive = await this.backend.sessionExists(sessionId, session.createdAtMs);
    } catch (err) {
      console.warn(
        `[sandbox.session] liveness check for ${sessionId} failed (treating as alive):`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
    return !alive && this.evictStale(session, 'backend object gone');
  }

  /** Drop a registry entry whose incarnation is confirmed gone, keeping its
   * workspace for the resume; true when it did. The verdict describes the
   * entry it was reached for: a destroy / recreate or a stop that began
   * meanwhile owns its new state and capacity. */
  private evictStale(session: RegistrySession, reason: string): boolean {
    const { sessionId } = session;
    if (
      this.registry.get(sessionId) !== session ||
      this.stopping.has(sessionId)
    )
      return false;
    console.warn(
      `[sandbox.session] ${sessionId} ${reason}; evicting stale registry entry (workspace preserved for resume)`,
    );
    this.registry.delete(sessionId);
    const unregistered = this.unregistered.get(sessionId);
    if (
      unregistered?.createdAtMs === session.createdAtMs &&
      unregistered.state !== 'degraded'
    )
      this.unregistered.delete(sessionId);
    this.forgetReclaimMarks(sessionId);
    return true;
  }

  /** Record which incarnation a runnerd answer named for this entry. Only an
   * answer that names the registered one proves it; one naming none (an older
   * runtime image, or a replacement launched without a stamp) returns the
   * entry to the backend's check. */
  private noteIncarnation(
    session: RegistrySession,
    named: unknown,
  ): ReturnType<typeof answeringIncarnation> {
    const answer = answeringIncarnation(session.createdAtMs, named);
    if (answer === 'registered') this.namingIncarnation.add(session);
    else this.namingIncarnation.delete(session);
    return answer;
  }

  /** Can a runnerd answer stand in for the backend's existence check of this
   * entry? Only on Docker, where runnerd is reached through the running
   * container of the session's name, and only once runnerd has named the
   * registered incarnation. A terminating Pod still answers through its IP
   * while the backend already counts it gone, so Kubernetes keeps the
   * backend's check. */
  private provesIncarnation(session: RegistrySession): boolean {
    return (
      this.backend.kind === 'docker' && this.namingIncarnation.has(session)
    );
  }

  /** Did runnerd refuse a request for this entry because it serves another
   * incarnation of the session? */
  private refusedAsReplaced(session: RegistrySession, error: unknown): boolean {
    return (
      error instanceof RunnerdActivityError &&
      answeringIncarnation(session.createdAtMs, error.incarnation) ===
        'replaced'
    );
  }

  /** Liveness of a registered entry, evicting it when its incarnation is
   * gone; true when it did. On Docker a /healthz answer naming the
   * registered incarnation proves it without the backend's check, and one
   * naming another proves it gone. No answer, or one naming none, asks the
   * backend. */
  private async evictUnlessRunnerdNamesIt(
    session: RegistrySession,
  ): Promise<boolean> {
    const { sessionId } = session;
    if (this.backend.kind === 'docker' && !this.stopping.has(sessionId)) {
      try {
        const health = await runnerdHealth(
          { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
          AbortSignal.timeout(LIVENESS_PROBE_TIMEOUT_MS),
        );
        const named = this.noteIncarnation(session, health.incarnation);
        if (named === 'registered') return false;
        if (named === 'replaced')
          return this.evictStale(session, 'was replaced under its name');
      } catch (error) {
        console.warn(
          `[sandbox.session] runnerd of ${sessionId} did not answer a liveness probe; asking the backend:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    if (this.registry.get(sessionId) !== session) return false;
    return this.evictIfBackendGone(sessionId);
  }

  async handleCreate(body: string, signal?: AbortSignal): Promise<Response> {
    try {
      return await withOperationBudget(
        this.cfg.session.createHealthTimeoutMs,
        () => this.handleCreateNow(body),
        signal,
      );
    } catch (error) {
      return jsonResponse(
        {
          error: 'create_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        502,
      );
    }
  }

  private async handleCreateNow(body: string): Promise<Response> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const v = validateCreateSession(parsed, this.cfg);
    if (!v.ok)
      return jsonResponse({ error: 'bad_request', message: v.error }, 400);
    const req = v.value;

    const refused = await this.reserveCreate(
      req.sessionId,
      req.organizationId,
      req.profile,
      req.docker,
    );
    if (refused !== null) return refused;
    try {
      // A destroy of this id already under way finishes first, so the create
      // lays out its workspace on a settled slate instead of racing the old
      // one's removal. Bounded: one wedged on a stuck filesystem must not
      // hold this create, and its capacity slot, for ever — the caller
      // retries on the busy answer.
      const destroying = this.destroySettled.get(req.sessionId);
      if (
        destroying !== undefined &&
        !(await waitWithinOperation(
          settlesWithin(destroying.promise, CREATE_WAITS_FOR_DESTROY_MS),
        ))
      ) {
        return jsonResponse(
          {
            error: 'busy',
            message: `a destroy of ${req.sessionId} is still under way`,
          },
          429,
          { 'retry-after': '30' },
        );
      }
      // So does the removal of the id's ended compute (a resume right after
      // a host reboot): its steps are keyed by the session's name — the
      // inner image volume, the pin marker — and run beside this create
      // they would remove what the new container is about to use.
      const reaping = this.endedReaping.get(req.sessionId);
      if (
        reaping !== undefined &&
        !(await waitWithinOperation(
          settlesWithin(reaping, CREATE_WAITS_FOR_ENDED_REAP_MS),
        ))
      ) {
        return jsonResponse(
          {
            error: 'busy',
            message: `the removal of ${req.sessionId}'s ended compute is still under way`,
          },
          429,
          { 'retry-after': '10' },
        );
      }
      const pinning = this.pinOperations.get(req.sessionId);
      if (
        pinning !== undefined &&
        !(await waitWithinOperation(
          settlesWithin(pinning, CREATE_WAITS_FOR_DESTROY_MS),
        ))
      ) {
        return jsonResponse(
          {
            error: 'busy',
            message: 'previous pin persistence is still under way',
          },
          429,
          { 'retry-after': '5' },
        );
      }
      const createdAtMs = Date.now();
      let created: CreateSessionResult;
      try {
        created = await this.backend.createSession({
          sessionId: req.sessionId,
          organizationId: req.organizationId,
          profile: req.profile,
          docker: req.docker,
          ttlMs: req.ttlMs,
          idleTimeoutMs: req.idleTimeoutMs,
          env: req.env,
          createdAtMs,
          signal: operationSignal(),
        });
      } catch (err) {
        // A live session the registry does not hold already runs under the
        // id: a duplicate, which the caller adopts through acquire. As a
        // failed create, its cleanup would remove that session's compute.
        if (err instanceof SessionExistsError) {
          return jsonResponse(
            { error: 'duplicate', message: err.message },
            409,
          );
        }
        return jsonResponse(
          {
            error: 'create_failed',
            message: err instanceof Error ? err.message : String(err),
          },
          502,
        );
      }

      let endpoint: string;
      try {
        endpoint = await this.backend.resolveEndpoint(req.sessionId);
      } catch (err) {
        // The backend object was created above but we can't address it. Roll it
        // back rather than leak an unregistered, unroutable, never-reaped session
        // (the sweep only walks the registry, so an unregistered backend object
        // lingers until a spawner restart re-adopts it). The VERB depends on
        // what this create provisioned: a RESUME re-attached a preserved
        // workspace that is not ours to delete — a blip reading a Pod IP must
        // never wipe the user's data — so it rolls back with stop (compute
        // released, workspace kept for the retry); only a fresh create destroys
        // the half-made workspace it created itself. Mirrors the backends' own
        // failed-create cleanup.
        const preserveWorkspace = created.resumed || operationSignal()?.aborted;
        const rollback = outsideOperationBudget(() =>
          withOperationBudget(30_000, () =>
            preserveWorkspace
              ? this.backend.stopSession(req.sessionId, createdAtMs)
              : this.backend.destroySession(req.sessionId),
          ),
        );
        await rollback.catch((rollbackErr) => {
          console.warn(
            `[sandbox.session] rollback ${created.resumed ? 'stop' : 'destroy'} after resolveEndpoint failure:`,
            rollbackErr,
          );
        });
        return jsonResponse(
          {
            error: 'create_failed',
            message: err instanceof Error ? err.message : String(err),
          },
          502,
        );
      }
      const entry: RegistrySession = {
        sessionId: req.sessionId,
        organizationId: req.organizationId,
        profile: req.profile,
        docker: req.docker,
        state: 'ready',
        createdAtMs,
        expiresAtMs: createdAtMs + req.ttlMs,
        idleTimeoutMs: req.idleTimeoutMs,
        endpoint,
        liveExecs: new Map(),
      };
      this.registry.set(entry);
      // The readiness answer the create waited for is a runnerd answer like
      // any other: naming this incarnation, it spares the session's first
      // ticket or acquire the backend's existence check.
      this.noteIncarnation(entry, created.incarnation);
      const planned = this.creatingBytes.get(req.sessionId);
      if (planned !== undefined) {
        this.youngBytes.set(req.sessionId, {
          bytes: planned,
          sinceMs: Date.now(),
        });
      }
      return jsonResponse({ session: this.toInfo(req.sessionId) }, 201);
    } finally {
      this.creating.delete(req.sessionId);
      this.creatingBytes.delete(req.sessionId);
      this.createSettled.get(req.sessionId)?.resolve();
      this.createSettled.delete(req.sessionId);
    }
  }

  /** GET /v1/sessions/:id — the platform's pre-turn aliveness probe keys its
   * phantom-recreate on this route's 404, so a registry hit must be verified
   * against the backend object: answering from the cache alone turns a dead
   * container into "alive" and the turn then fails on a dead address. Once
   * runnerd has named the registered incarnation, its /healthz verifies it
   * instead. */
  async handleGet(sessionId: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (session === undefined) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    if (
      this.provesIncarnation(session)
        ? await this.evictUnlessRunnerdNamesIt(session)
        : await this.evictIfBackendGone(sessionId)
    ) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    const info = this.toInfo(sessionId);
    if (!info) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ session: info }, 200);
  }

  handleList(organizationId: string | null): Response {
    const sessions = this.registry
      .list(organizationId ?? undefined)
      .map((s) => this.toInfo(s.sessionId))
      .filter((s): s is SessionInfo => s !== null);
    return jsonResponse({ sessions }, 200);
  }

  /**
   * GET /v1/workspaces — every workspace this spawner holds (stopped
   * sessions' preserved data included) and the organizations holding
   * resources beyond them: the physical half of the platform's workspace
   * cleanup, which decides from its own records what may go. A session this
   * replica is creating or serving reads as active even when the backend
   * listing has not caught up with it. An inventory that cannot be read is a
   * 503, never an empty answer.
   */
  async handleWorkspaces(): Promise<Response> {
    try {
      const [workspaces, organizations] = await Promise.all([
        this.backend.listWorkspaces(),
        this.backend.listOrganizationResources(),
      ]);
      for (const workspace of workspaces) {
        if (this.holds(workspace.sessionId)) workspace.active = true;
      }
      return jsonResponse(
        { backend: this.backend.kind, workspaces, organizations },
        200,
        { 'cache-control': 'no-store' },
      );
    } catch (error) {
      console.warn('[sandbox.session] workspace inventory failed:', error);
      return jsonResponse({ error: 'inventory_unavailable' }, 503, {
        'cache-control': 'no-store',
      });
    }
  }

  /**
   * DELETE /v1/organizations/:id — tear down an organization that no longer
   * exists: destroy every session the backend still holds for it (running or
   * stopped containers/Pods, workspaces with them), then its resources beyond
   * them (build helpers, networks, caches). The platform calls it only after
   * the organization is deleted and after destroying the sessions it knew
   * of; this is the pass that catches the rest. A create still in flight for
   * the organization answers 409 so the caller retries once it settled; a
   * destroy or removal that failed answers 502, and a retry resumes where
   * this one stopped.
   */
  async handleOrganizationTeardown(organizationId: string): Promise<Response> {
    if ([...this.creating.values()].includes(organizationId)) {
      return jsonResponse({ error: 'busy' }, 409, { 'retry-after': '10' });
    }
    let listed: BackendSession[];
    try {
      listed = await this.backend.listSessions(organizationId);
    } catch (error) {
      console.warn(
        `[sandbox.session] teardown of ${organizationId}: session list failed:`,
        error,
      );
      return jsonResponse({ error: 'inventory_unavailable' }, 503);
    }
    const sessionIds = new Set([
      ...listed.map((session) => session.sessionId),
      ...this.registry.list(organizationId).map((session) => session.sessionId),
    ]);
    // Stopped sessions hold no compute, only their workspaces: the ones the
    // backend attributes to the organization go too. A list that cannot be
    // read (Kubernetes without `list` on claims) leaves them to the
    // platform, which names every workspace its rows knew.
    try {
      for (const workspace of await this.backend.listWorkspaces()) {
        if (workspace.organizationId === organizationId) {
          sessionIds.add(workspace.sessionId);
        }
      }
    } catch (error) {
      console.warn(
        `[sandbox.session] teardown of ${organizationId}: workspace list failed; its stopped workspaces stay to the platform's list:`,
        error,
      );
    }
    let sessions = 0;
    for (const sessionId of sessionIds) {
      const destroyed = await this.handleDestroy(sessionId);
      if (!destroyed.ok) {
        return jsonResponse({ error: 'destroy_failed', sessionId }, 502);
      }
      sessions += 1;
    }
    try {
      const removed = await this.backend.teardownOrganization(organizationId);
      return jsonResponse({ sessions, ...removed }, 200);
    } catch (error) {
      console.error(
        `[sandbox.session] teardown of ${organizationId} failed:`,
        error,
      );
      reportSandboxError(error, 'organization-teardown');
      return jsonResponse({ error: 'teardown_failed' }, 502);
    }
  }

  /** The release ticket is read BEFORE the platform releases its allocation.
   * Reacquiring invalidates all earlier tickets, so a delayed completion can
   * never make the next workload eligible for pressure reclamation. */
  async handleActivity(
    sessionId: string,
    action: 'ticket' | 'acquire' | 'release',
    body = '',
    knownHealth?: { session: RegistrySession; health?: RunnerdHealth },
  ): Promise<Response> {
    if (action !== 'acquire') {
      // A release/ticket separates turns; only adjacent acquires coalesce.
      this.acquiring.delete(sessionId);
      return this.queueActivity(sessionId, action, body);
    }
    let work = this.acquiring.get(sessionId);
    if (work === undefined) {
      work = this.queueActivity(sessionId, action, body, knownHealth).finally(
        () => {
          if (this.acquiring.get(sessionId) === work)
            this.acquiring.delete(sessionId);
        },
      );
      this.acquiring.set(sessionId, work);
    }
    const response = await work;
    return new Response(response.clone().body, {
      status: response.status,
      headers: response.headers,
    });
  }

  private async queueActivity(
    sessionId: string,
    action: 'ticket' | 'acquire' | 'release',
    body: string,
    knownHealth?: { session: RegistrySession; health?: RunnerdHealth },
  ): Promise<Response> {
    // Runnerd's generation remains the cross-replica authority. Serializing
    // this spawner's requests also keeps an old completion from clearing the
    // growth reservation belonging to the acquire that overtook it.
    const previous =
      this.activityOperations.get(sessionId) ?? Promise.resolve();
    const work = previous.then(() =>
      this.handleActivityUnlocked(sessionId, action, body, knownHealth),
    );
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.activityOperations.set(sessionId, settled);
    try {
      return await work;
    } finally {
      if (this.activityOperations.get(sessionId) === settled)
        this.activityOperations.delete(sessionId);
    }
  }

  private async handleActivityUnlocked(
    sessionId: string,
    action: 'ticket' | 'acquire' | 'release',
    body: string,
    knownHealth?: { session: RegistrySession; health?: RunnerdHealth },
  ): Promise<Response> {
    let generation: string | undefined;
    if (action === 'release') {
      try {
        const parsed: unknown = JSON.parse(body);
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'generation' in parsed &&
          typeof parsed.generation === 'string' &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(parsed.generation)
        ) {
          generation = parsed.generation;
        }
      } catch (parseError) {
        // Malformed JSON is the same boundary error as a missing generation.
        console.warn(
          `[sandbox.session] release body for ${sessionId} is not JSON:`,
          parseError,
        );
      }
      if (generation === undefined)
        return jsonResponse({ error: 'bad_request' }, 400);
    }
    if (action === 'acquire') {
      // A sibling turn of the same owner may still be creating this id (a
      // slow image pull): wait for that create rather than answer a
      // not-found the caller turns into a duplicate create and a failed turn.
      const creating = this.createSettled.get(sessionId);
      if (creating !== undefined) {
        await Promise.race([
          creating.promise,
          new Promise<void>((resolve) => {
            setTimeout(resolve, ACQUIRE_WAITS_FOR_CREATE_MS).unref?.();
          }),
        ]);
      }
      await this.stopping.get(sessionId);
      if (
        knownHealth !== undefined &&
        this.registry.get(sessionId) !== knownHealth.session
      )
        return jsonResponse({ error: 'not_found' }, 404);
      const frozen = this.registry.get(sessionId);
      if (frozen !== undefined && this.reclaimClaims.has(sessionId)) {
        // Frozen by an acknowledged claim whose backend stop failed: finish
        // the fenced stop now, so the caller recreates against the preserved
        // workspace instead of hitting `reclaiming` until the next sweep.
        if (await this.reclaimIdle(frozen))
          return jsonResponse({ error: 'not_found' }, 404);
      }
    }
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    // A direct exec may have queued behind a release while adoption replaced
    // its session. Its health and request must never acquire that successor.
    if (knownHealth !== undefined && knownHealth.session !== session)
      return jsonResponse({ error: 'not_found' }, 404);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    // An entry whose runnerd already named the registered incarnation skips
    // the backend's check: the request below names that incarnation, runnerd
    // refuses it when a replacement answers, and a failure asks the backend.
    const proven = this.provesIncarnation(session);
    if (!proven && (await this.evictIfBackendGone(sessionId))) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    if (this.registry.get(sessionId) !== session)
      return jsonResponse({ error: 'not_found' }, 404);
    const opts = {
      baseUrl: session.endpoint,
      token: this.tokenFor(sessionId),
      incarnation: session.createdAtMs,
    };
    try {
      if (action === 'acquire') {
        this.activating.set(sessionId, session);
        const refused = await this.reserveActivation(
          session,
          knownHealth?.health,
        );
        if (refused !== null) return refused;
        if (this.registry.get(sessionId) !== session)
          return jsonResponse({ error: 'not_found' }, 404);
      }
      const result = await runnerdActivity(
        opts,
        action,
        generation === undefined ? undefined : { generation },
      );
      if (this.registry.get(sessionId) !== session)
        return jsonResponse({ error: 'not_found' }, 404);
      const named = this.noteIncarnation(session, result.incarnation);
      if (named === 'replaced') {
        this.evictStale(session, 'was replaced under its name');
        return jsonResponse({ error: 'not_found' }, 404);
      }
      // The check skipped above runs after all when the answer proves
      // nothing: a replacement launched without a stamp answered instead.
      if (
        named === 'unnamed' &&
        proven &&
        ((await this.evictIfBackendGone(sessionId)) ||
          this.registry.get(sessionId) !== session)
      )
        return jsonResponse({ error: 'not_found' }, 404);
      if (action === 'release') {
        if (typeof result.released !== 'boolean')
          throw new Error('invalid runnerd release response');
        if (result.released) {
          this.youngBytes.delete(sessionId);
          this.activeGenerations.delete(sessionId);
          // A reclaim candidate now: the next create at capacity may take it.
          this.noteReclaimable(sessionId, true);
          this.nothingToReclaimUntilMs = 0;
        }
        return jsonResponse({ released: result.released }, 200);
      }
      if (
        typeof result.generation !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(result.generation)
      ) {
        throw new Error('invalid runnerd generation');
      }
      // Held by the caller's work from now on: no reclaim candidate.
      if (action === 'acquire') {
        this.activeGenerations.set(sessionId, {
          generation: result.generation,
          admittedAtMs:
            this.youngBytes.get(sessionId)?.sinceMs ??
            this.activeGenerations.get(sessionId)?.admittedAtMs ??
            Date.now(),
        });
        this.noteReclaimable(sessionId, false);
      }
      return jsonResponse({ generation: result.generation }, 200);
    } catch (error) {
      if (this.registry.get(sessionId) !== session)
        return jsonResponse({ error: 'not_found' }, 404);
      // Refused by a replacement under the session's name: the registered
      // incarnation is gone, and the request changed nothing.
      if (
        this.refusedAsReplaced(session, error) &&
        this.evictStale(session, 'was replaced under its name')
      )
        return jsonResponse({ error: 'not_found' }, 404);
      if (await this.evictIfBackendGone(sessionId))
        return jsonResponse({ error: 'not_found' }, 404);
      if (this.registry.get(sessionId) !== session)
        return jsonResponse({ error: 'not_found' }, 404);
      if (error instanceof RunnerdActivityError && error.status === 404) {
        // Older runtime images cannot be pressure-reclaimed. They can still
        // serve work during a rolling upgrade; a release ticket stays absent.
        if (action === 'acquire') {
          const health = await runnerdHealth(opts).catch(
            (probeError: unknown) => {
              console.warn(
                `[sandbox.session] health probe after an unsupported acquire on ${sessionId} failed:`,
                probeError,
              );
              return null;
            },
          );
          if (this.registry.get(sessionId) !== session)
            return jsonResponse({ error: 'not_found' }, 404);
          if (health !== null && health.activity === undefined) {
            return jsonResponse({ generation: 'legacy' }, 200);
          }
        } else return jsonResponse({ error: 'unsupported' }, 404);
      }
      return jsonResponse({ error: 'session_unavailable' }, 503, {
        'retry-after': '1',
      });
    } finally {
      if (action === 'acquire' && this.activating.get(sessionId) === session)
        this.activating.delete(sessionId);
    }
  }

  /** Renew the growth reservation when idle compute becomes working compute.
   * Repeated acquires of an already-held generation spend no second budget.
   * An ambiguous RPC retains the bounded reservation: it may have run. */
  private async reserveActivation(
    session: RegistrySession,
    knownHealth?: RunnerdHealth,
  ): Promise<Response | null> {
    // Disk admission applies even when host memory is unavailable (Kubernetes).
    if (this.diskShort()) {
      return jsonResponse(
        {
          error: 'host_disk',
          message: 'the sandbox host is short of disk space',
        },
        429,
        { 'retry-after': '5' },
      );
    }
    const observesMemory = this.memoryCeiling() !== null;
    if (!observesMemory && !(session.docker ?? this.cfg.dockerInContainer))
      return null;
    const sessionId = session.sessionId;
    const health =
      knownHealth ??
      (await runnerdHealth({
        baseUrl: session.endpoint,
        token: this.tokenFor(sessionId),
      }));
    if (this.registry.get(sessionId) !== session)
      return jsonResponse({ error: 'not_found' }, 404);
    if (health.dockerReady === false)
      return this.unavailableDocker(session, health);
    if (!observesMemory) return null;
    const previous = this.activeGenerations.get(sessionId);
    const young = this.youngBytes.get(sessionId);
    if (
      health.liveExecs > 0 ||
      (health.activity?.activeOperations ?? 0) > 0 ||
      (health.activity?.released === false &&
        (previous?.generation === health.activity.generation ||
          (previous === undefined && young !== undefined)) &&
        Date.now() -
          Math.max(
            previous?.admittedAtMs ?? young?.sinceMs ?? 0,
            health.lastActivityAtMs,
          ) <
          YOUNG_SESSION_RESERVE_MS)
    ) {
      this.waiters.delete(sessionId);
      return null;
    }
    const workingSet = sessionWorkingSetBytes(
      session.profile,
      session.docker ?? this.cfg.dockerInContainer,
    );
    const admit = () => {
      if (this.registry.get(sessionId) !== session) return 'replaced';
      const now = Date.now();
      const fits = this.memoryCeiling();
      const held = this.waitersAhead(sessionId, now).reduce(
        (bytes, waiter) =>
          bytes +
          (fits === null || waiter.workingSetBytes <= fits
            ? waiter.workingSetBytes
            : 0),
        0,
      );
      if (this.memoryShort(workingSet + held, sessionId)) return false;
      this.youngBytes.set(sessionId, { bytes: workingSet, sinceMs: now });
      this.waiters.delete(sessionId);
      return true;
    };
    let admitted = await this.withAdmission(admit);
    if (admitted === false) {
      await this.reclaimOneIdle();
      await this.readHostMemory();
      admitted = await this.withAdmission(admit);
    }
    if (admitted === 'replaced')
      return jsonResponse({ error: 'not_found' }, 404);
    if (admitted) return null;
    const place = this.waitInLine(sessionId, workingSet, Date.now(), false);
    return jsonResponse(
      {
        error: 'host_memory',
        message:
          'the sandbox host is short of memory; work resumes once running sessions free some',
        queue: { position: place.position, waiting: place.waiting },
      },
      429,
      { 'retry-after': String(Math.ceil(place.hintMs / 1000)) },
    );
  }

  /** Refuse new work immediately, but recover compute only after runnerd
   * confirms sustained probe failure or a terminal Docker state. Its atomic
   * idle claim still protects active work, pins and a concurrent acquire. */
  private async unavailableDocker(
    session: RegistrySession,
    health: RunnerdHealth,
  ): Promise<Response> {
    if (
      (health.dockerRecoveryRequired === true &&
        (await this.reclaimIdle(session, {
          health,
          beforeMs: Date.now() - 1,
        }))) ||
      this.registry.get(session.sessionId) !== session
    )
      return jsonResponse({ error: 'not_found' }, 404);
    return unavailableSessionResponse();
  }

  async handleDestroy(
    sessionId: string,
    opts: {
      ifIdle?: boolean;
      ifStopped?: boolean;
      awaitDeletion?: boolean;
      keepWorkspace?: boolean;
    } = {},
  ): Promise<Response> {
    // A destroyed session asks for no room any more.
    this.waiters.delete(sessionId);
    // Conditional destroy (`?if_idle=1`): a janitor caller (the end-of-turn
    // thread-session teardown) must never destroy a session another turn is
    // actively executing in — two turns can share one thread session (e.g.
    // the model invoking the same delegate twice in parallel onto one
    // sub-thread). Busy is decided HERE, not by the caller: the spawner owns
    // the live-exec truth. The skip is always safe — the surviving turn's own
    // teardown (or the TTL reaper) cleans up later; destroying a live exec
    // never is.
    //
    // `?if_stopped=1` is stricter, for the workspace cleanup of a session
    // nobody has used for a while: only the preserved workspace of a STOPPED
    // session goes. Any compute under the id — a container a turn just
    // resumed, before its first exec — or a create in flight means someone
    // came back to it, and the cleanup must leave it alone.
    //
    // `?keep_workspace=1` removes the compute alone (`backend.stopSession`)
    // and keeps the workspace: the platform's cleanup after a failed create
    // of an agent session, whose id may name a workspace preserved for its
    // next turn. Deleting a workspace nothing owns is the workspace
    // cleanup's, through a plain destroy.
    //
    // Either condition also refuses while a create of the id is in flight:
    // the create is laying out the very workspace this would delete. The
    // destroy is announced BEFORE that check, so a create admitted while the
    // check awaits the backend finds it and waits for it to settle (see
    // handleCreate) — and a create admitted first is caught by the re-check.
    const settled = Promise.withResolvers<void>();
    const previous = this.destroySettled.get(sessionId);
    this.destroySettled.set(sessionId, settled);
    let destroyed: boolean;
    try {
      await previous?.promise;
      await this.pinOperations.get(sessionId);
      if (opts.ifIdle || opts.ifStopped) {
        const busy =
          this.creating.has(sessionId) ||
          (opts.ifStopped
            ? await this.holdsCompute(sessionId)
            : await this.hasLiveExecs(sessionId)) ||
          this.creating.has(sessionId);
        if (busy) return jsonResponse({ destroyed: false, busy: true }, 200);
      }
      const outcome = await this.destroyNow(
        sessionId,
        opts.keepWorkspace === true,
      );
      if (outcome instanceof Response) return outcome;
      destroyed = outcome.destroyed;
    } finally {
      settled.resolve();
      if (this.destroySettled.get(sessionId) === settled) {
        this.destroySettled.delete(sessionId);
      }
    }
    // Nothing was deleted: the answer says the workspace stays, so a device
    // hub keeps routing the id to the machine holding it.
    if (opts.keepWorkspace === true) {
      return jsonResponse(
        { stopped: destroyed, busy: false, workspaceKept: true },
        200,
      );
    }
    // Out of use is not deleted: `deletion` says how far the workspace's
    // bytes came, on every answer that is not busy — an erasure or a
    // retirement settles only on an explicit `done` (or Kubernetes'
    // `handed_off`), and reads an answer without it as unconfirmed. The wait
    // comes after the destroy settled — the id is free once the workspace is
    // out of use, so a create of it never waits for the bytes.
    const deletion = await this.deletionOf(
      sessionId,
      opts.awaitDeletion === true,
    );
    return jsonResponse({ destroyed, busy: false, deletion }, 200);
  }

  /** Is there compute under the id — a registered session, a stop still
   * removing one (an ended container's removal too), or a container/Pod the
   * backend holds that has not ended (one still starting on a peer replica
   * counts; an exited container whose process died out-of-band does not)? A
   * backend that cannot answer counts as holding it. */
  private async holdsCompute(sessionId: string): Promise<boolean> {
    if (
      this.registry.has(sessionId) ||
      this.stopping.has(sessionId) ||
      this.endedReaping.has(sessionId)
    ) {
      return true;
    }
    try {
      return (await this.backend.listSessions()).some(
        (session) => session.sessionId === sessionId && !session.ended,
      );
    } catch (error) {
      console.warn(
        `[sandbox.session] compute of ${sessionId} unknown; keeping its workspace:`,
        error,
      );
      return true;
    }
  }

  /** The destroy itself: whether it reached anything under the id, or the
   * 502 a failed backend destroy answers. `keepWorkspace` stops the session
   * instead — its compute removed, its workspace kept. */
  private async destroyNow(
    sessionId: string,
    keepWorkspace = false,
  ): Promise<Response | { destroyed: boolean }> {
    // Delete from the registry BEFORE awaiting the backend so a concurrent
    // destroy of the same id sees an empty cache and can't double-call
    // destroySession. The backend destroy then runs exactly once; its return
    // value (false = nothing existed) covers the adopted-but-unregistered case.
    const entry = this.registry.get(sessionId);
    const had = entry !== undefined;
    if (had) this.registry.delete(sessionId);
    // Whatever the destroy does to the object, no reclaim mark may outlive
    // the incarnation and follow the deterministic id onto a later resume.
    this.forgetReclaimMarks(sessionId);
    try {
      const backendExisted = keepWorkspace
        ? await this.backend.stopSession(sessionId)
        : await this.backend.destroySession(sessionId);
      this.unregistered.delete(sessionId);
      return { destroyed: had || backendExisted };
    } catch (err) {
      // The backend destroy FAILED (a wedged dockerd, an apiserver blip). Do
      // NOT report success: the container/workspace may survive, and laundering
      // it to a 200 would flip the platform's session row `destroyed` while the
      // user's data lives on — the "success toast, workspace survives" defect.
      // Restore the registry entry so the session isn't lost, and surface the
      // failure so the caller retries.
      const verb = keepWorkspace ? 'stop' : 'destroy';
      console.error(`[sandbox.session] ${verb} backend failed:`, err);
      reportSandboxError(err, `session-${verb}`);
      if (entry !== undefined) this.registry.set(entry);
      return jsonResponse(
        { destroyed: false, busy: false, error: `backend ${verb} failed` },
        502,
      );
    }
  }

  /** How far deleting the destroyed workspace has come, waited for up to
   * {@link DESTROY_AWAITS_DELETION_MS} when the caller asked. Unknown reads
   * `pending`, never `done`. */
  private async deletionOf(
    sessionId: string,
    awaitDeletion: boolean,
  ): Promise<WorkspaceDeletion> {
    try {
      return await this.backend.workspaceDeletion(
        sessionId,
        awaitDeletion ? DESTROY_AWAITS_DELETION_MS : 0,
      );
    } catch (error) {
      console.warn(
        `[sandbox.session] deletion of ${sessionId}'s workspace unknown:`,
        error,
      );
      return 'pending';
    }
  }

  /**
   * Does the session have a live exec — or is it in an unknown-but-possibly-
   * live state? Mirrors sweepExpired's two-tier check: this replica's
   * in-flight registry map first, then runnerd's own `liveExecs` counter as
   * the cold-cache backstop (correct after a spawner restart). A failed probe
   * is "unknown", not "idle": only a backend object that is definitively gone
   * may report not-busy, so a wedged-but-alive container is left to the
   * reaper rather than destroyed under a possibly-running exec.
   */
  private async hasLiveExecs(sessionId: string): Promise<boolean> {
    const s = this.registry.get(sessionId);
    if (s !== undefined && s.liveExecs.size > 0) return true;
    const endpoint =
      s?.endpoint ??
      (await this.backend.resolveEndpoint(sessionId).catch(() => null));
    if (endpoint === null) {
      return this.backend.sessionExists(sessionId).catch(() => true);
    }
    try {
      const health = await runnerdHealth({
        baseUrl: endpoint,
        token: this.tokenFor(sessionId),
      });
      return health.liveExecs > 0;
    } catch {
      return this.backend.sessionExists(sessionId).catch(() => true);
    }
  }

  /** POST /v1/sessions/:id/exec — proxies runnerd's NDJSON stream to SSE,
   * mirroring the /v1/execute event grammar. */
  async handleExec(
    req: Request,
    sessionId: string,
    body: string,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const v = validateExecSession(parsed, this.cfg);
    if (!v.ok)
      return jsonResponse({ error: 'bad_request', message: v.error }, 400);
    const execReq = v.value;

    // Direct exec callers need not acquire a work lease first. Admit their
    // warm growth once, while an acquired turn or active exec already owns
    // its working set. An idempotent retry remains usable under pressure.
    let replayOnly = false;
    const retainedExec = async () => {
      const status = await runnerdExecStatus(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execReq.execId,
      );
      return status.state === 'running' || status.state === 'exited';
    };
    let readiness: RunnerdHealth | undefined;
    if (session.docker ?? this.cfg.dockerInContainer) {
      try {
        readiness = await runnerdHealth({
          baseUrl: session.endpoint,
          token: this.tokenFor(sessionId),
        });
        if (this.registry.get(sessionId) !== session)
          return jsonResponse({ error: 'not_found' }, 404);
        if (readiness.dockerReady === false) {
          // Docker readiness gates fresh work, not retained output. Resolve
          // the id before idle recovery can remove the daemon's replay store.
          replayOnly = await retainedExec();
          if (this.registry.get(sessionId) !== session)
            return jsonResponse({ error: 'not_found' }, 404);
          if (!replayOnly) return this.unavailableDocker(session, readiness);
        }
      } catch (error) {
        if (this.registry.get(sessionId) !== session)
          return jsonResponse({ error: 'not_found' }, 404);
        console.warn('[sandbox.session] Docker readiness unavailable:', error);
        return jsonResponse({ error: 'session_unavailable' }, 503, {
          'retry-after': '1',
        });
      }
    }
    const active = this.activeGenerations.get(sessionId);
    if (
      !replayOnly &&
      session.liveExecs.size === 0 &&
      (active === undefined ||
        Date.now() - active.admittedAtMs >= YOUNG_SESSION_RESERVE_MS)
    ) {
      const refused =
        this.memoryCeiling() === null
          ? await this.reserveActivation(session, readiness)
          : await this.handleActivity(sessionId, 'acquire', '', {
              session,
              health: readiness,
            });
      if (refused !== null && !refused.ok) {
        // Docker may fail after our health snapshot; /acquire remains the
        // authority and refuses fresh work without deleting retained replay.
        if (refused.status !== 429 && refused.status !== 503) return refused;
        try {
          if (!(await retainedExec())) return refused;
          // Attach, never POST: retention may evict the id after this probe,
          // and that race must not turn a refused retry into fresh execution.
          replayOnly = true;
        } catch (error) {
          if (await this.evictIfBackendGone(sessionId))
            return jsonResponse({ error: 'not_found' }, 404);
          console.warn(
            '[sandbox.session] exec retry status unavailable:',
            error,
          );
          return refused;
        }
      }
    }

    if (this.registry.get(sessionId) !== session)
      return jsonResponse({ error: 'not_found' }, 404);

    const ac = new AbortController();
    const abortHandler = () => ac.abort();
    req.signal.addEventListener('abort', abortHandler, { once: true });
    if (req.signal.aborted) ac.abort();
    this.registry.registerExec(sessionId, execReq.execId, ac);

    const token = this.tokenFor(sessionId);
    // collectOutput (default true): accumulate stdout/stderr into the terminal
    // `result` buffers (one-shot contract). A long-lived streaming exec (the
    // agent) passes false — the live SSE is the sole delivery, so we skip
    // accumulation (no unbounded growth for a never-exiting exec) and tell
    // runnerd the cap is unlimited (0) so its output is never silently cut off.
    const collect = execReq.collectOutput ?? true;
    const binaryOutput =
      req.headers.get('accept')?.includes('tale-output=base64') === true;
    return sseResponse(async ({ send, signal }) => {
      // Terminal-state accumulation so the SSE `result` event matches the
      // one-shot ExecuteResponse contract (the runnerd `exit` carries
      // truncation/timeout; stdout/stderr are summed here for the buffers).
      // Skipped entirely when collect=false — the buffers stay empty.
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let result: SessionExecResponse | null = null;
      let replayGap = false;
      const onEvent = async (e: RunnerdExecEvent) => {
        switch (e.t) {
          case 'replay-start':
            await send('replay-start', {});
            break;
          case 'replay-complete':
            await send('replay-complete', { throughSeq: e.throughSeq });
            break;
          case 'start':
            await send('phase', { phase: 'running' });
            break;
          case 'stdout': {
            const bytes = b64decode(e.b64);
            if (collect) stdoutChunks.push(bytes);
            await send('stdout', {
              ...(binaryOutput
                ? { b64: e.b64 }
                : {
                    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
                      bytes,
                    ),
                    b64: e.b64,
                  }),
              seq: e.seq,
            });
            break;
          }
          case 'stderr': {
            const bytes = b64decode(e.b64);
            if (collect) stderrChunks.push(bytes);
            await send('stderr', {
              ...(binaryOutput
                ? { b64: e.b64 }
                : {
                    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
                      bytes,
                    ),
                    b64: e.b64,
                  }),
              seq: e.seq,
            });
            break;
          }
          case 'exit':
            result = {
              status: e.cancelled
                ? 'cancelled'
                : e.exitCode === 0
                  ? 'completed'
                  : 'failed',
              exitCode: e.exitCode,
              durationMs: e.durationMs,
              stdoutBase64: concatBase64(stdoutChunks),
              stderrBase64: concatBase64(stderrChunks),
              truncated: e.truncated,
              // Only mark TIMEOUT when the exit wasn't clean: a process that
              // raced the deadline and still exited 0 genuinely `completed`, so
              // pairing it with errorCode:'TIMEOUT' is a contradictory result.
              ...(e.timedOut && e.exitCode !== 0
                ? { errorCode: 'TIMEOUT' as const }
                : {}),
            };
            break;
          case 'gap':
            replayGap = true;
            await send('gap', { fromSeq: e.fromSeq, toSeq: e.toSeq });
            break;
          case 'fail':
            result = {
              status: 'failed',
              exitCode: null,
              // Sentinel: the process never ran, so there is no runnerd
              // measurement to forward (wire.ts `durationMs` contract).
              durationMs: 0,
              stdoutBase64: '',
              stderrBase64: '',
              truncated: { stdout: false, stderr: false },
              errorCode: execFailErrorCode(e.code),
              errorMessage: e.message,
            };
            break;
        }
      };
      try {
        const opts = { baseUrl: session.endpoint, token };
        const execSignal = AbortSignal.any([ac.signal, signal]);
        if (replayOnly) {
          if (!(await runnerdAttach(opts, execReq.execId, onEvent, execSignal)))
            throw new Error(`exec ${execReq.execId} not found`);
        } else {
          await runnerdExec(
            opts,
            {
              execId: execReq.execId,
              ...(execReq.command ? { command: execReq.command } : {}),
              ...(execReq.shell ? { shell: execReq.shell } : {}),
              ...(execReq.cwd ? { cwd: execReq.cwd } : {}),
              ...(execReq.env ? { env: execReq.env } : {}),
              ...(execReq.stdinBase64
                ? { stdinBase64: execReq.stdinBase64 }
                : {}),
              ...(execReq.stdinMode ? { stdinMode: execReq.stdinMode } : {}),
              timeoutMs: execReq.timeoutMs,
              // 0 = unlimited for streaming execs (collect=false): runnerd never
              // truncates the live stream; memory stays bounded by replay and consumer queues.
              stdoutMaxBytes: collect ? this.cfg.stdoutMaxBytes : 0,
              stderrMaxBytes: collect ? this.cfg.stderrMaxBytes : 0,
            },
            onEvent,
            execSignal,
          );
        }
        // An acknowledged-prefix gap asks the platform to restore a newer
        // checkpoint. It is not evidence that the daemon or session died.
        if (replayGap) return;
        if (result) {
          await send('result', result);
        } else {
          // Stream ended without a terminal event — runnerd/ container died.
          await send('result', {
            status: 'failed',
            exitCode: null,
            // Sentinel: the terminal `exit` line was lost with the container,
            // so there is no measurement to forward (wire.ts contract).
            durationMs: 0,
            stdoutBase64: concatBase64(stdoutChunks),
            stderrBase64: concatBase64(stderrChunks),
            truncated: { stdout: false, stderr: false },
            errorCode: 'SESSION_LOST',
            errorMessage: 'runnerd stream ended without a terminal event',
          } satisfies SessionExecResponse);
          // Mid-exec container death: evict the zombie now so the platform's
          // reconnect/next turn gets the definitive 404 instead of retrying a
          // dead address.
          await this.evictIfBackendGone(sessionId);
        }
      } catch (err) {
        // The caller hung up (the platform ends its stream at every drain
        // window): nobody reads an error, and the backend is not suspect.
        if (req.signal.aborted || signal.aborted) return;
        if (err instanceof RunnerdAttachBusyError) {
          await send('error', { code: 'ATTACH_BUSY', message: err.message });
          return;
        }
        await send('error', {
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof RunnerdProtocolError ||
          err instanceof RunnerdOutputGapError
            ? { code: err.code }
            : {}),
        });
        // A transport-level runnerd failure on a gone container must convert
        // the platform's resilient-drain retry into a 404 (registry miss),
        // not another connection error.
        if (
          !(err instanceof RunnerdProtocolError) &&
          !(err instanceof RunnerdOutputGapError)
        )
          await this.evictIfBackendGone(sessionId);
      } finally {
        if (this.registry.get(sessionId) === session)
          this.registry.unregisterExec(sessionId, execReq.execId);
        req.signal.removeEventListener('abort', abortHandler);
      }
    });
  }

  /** POST /v1/sessions/:id/exec/:execId/cancel — end an exec. With
   * `keepLeftovers` (`?leftovers=keep`: a steer's restart), runnerd ends only
   * the exec's own process group and holds what it left outside it for the
   * exec that takes over; without, everything the exec started ends. */
  async handleExecCancel(
    sessionId: string,
    execId: string,
    mode: { keepLeftovers?: boolean } = {},
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    // Local abort (ends the SSE proxy) + tell runnerd to kill the process group.
    this.registry.getExec(sessionId, execId)?.abort();
    let killed: boolean;
    try {
      killed = await runnerdCancelExec(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
        mode,
      );
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        // Container gone → nothing left to kill; the cancel is moot.
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse({ killed }, 200);
  }

  /** GET /v1/sessions/:id/exec/:execId — per-exec status without consuming the
   * stream. `running`/`exited` (200) or `gone` (404: session lost, or exec
   * evicted past the recent window). A transport blip with a live backend
   * returns 502 so the platform's restorative watchdog treats it as "unknown"
   * and skips (never finalizes a turn on a daemon hiccup). */
  async handleExecCheckpoint(
    req: Request,
    sessionId: string,
    execId: string,
    body: string,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    try {
      return await runnerdExecCheckpoint(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
        req.method === 'PUT' ? 'PUT' : 'GET',
        body,
        req.signal,
      );
    } catch (error) {
      if (req.signal.aborted) return jsonResponse({ error: 'cancelled' }, 502);
      if (await this.evictIfBackendGone(sessionId))
        return jsonResponse({ error: 'not_found' }, 404);
      console.warn('[sandbox.session] checkpoint transport failed:', error);
      return jsonResponse({ error: 'upstream_error' }, 502);
    }
  }

  async handleExecStatus(
    sessionId: string,
    execId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (signal?.aborted) return jsonResponse({ error: 'cancelled' }, 502);
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ execId, state: 'gone' }, 404);
    try {
      const status = await runnerdExecStatus(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
        signal,
      );
      return jsonResponse(status, status.state === 'gone' ? 404 : 200);
    } catch (err) {
      if (signal?.aborted) return jsonResponse({ error: 'cancelled' }, 502);
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ execId, state: 'gone' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  }

  /** POST /v1/sessions/:id/exec/:execId/stdin — append a line to a held-open
   * exec stdin (stdinMode:'hold') or close it. Transport failures return 502
   * (after gone-backend eviction) so the platform can distinguish "session
   * lost" from runnerd's structured STDIN_CLOSED/NOT_FOUND refusals (200). */
  async handleExecStdin(
    sessionId: string,
    execId: string,
    body: string,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { b64?: string; eof?: boolean };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as { b64?: string; eof?: boolean };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    if (parsed.b64 !== undefined && typeof parsed.b64 !== 'string') {
      return jsonResponse(
        { error: 'bad_request', message: 'b64 must be a string' },
        400,
      );
    }
    try {
      const result = await runnerdWriteStdin(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
        {
          ...(typeof parsed.b64 === 'string' ? { b64: parsed.b64 } : {}),
          ...(parsed.eof === true ? { eof: true } : {}),
        },
      );
      return jsonResponse(result, 200);
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
  }

  /** GET /v1/sessions/:id/exec/:execId/attach — reconnect to a running or
   * just-finished exec; replays runnerd's journal then follows to exit. The
   * resilience path for a platform action that dropped its original SSE. */
  async handleExecAttach(
    req: Request,
    sessionId: string,
    execId: string,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    // Resume cursor: the platform passes the highest seq already consumed.
    const sinceSeq = parseRunnerdSequence(
      new URL(req.url).searchParams.get('sinceSeq'),
    );
    if (sinceSeq === null)
      return jsonResponse({ error: 'invalid_since_seq' }, 400);
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.signal.addEventListener('abort', onAbort, { once: true });
    const token = this.tokenFor(sessionId);
    return sseResponse(async ({ send, signal }) => {
      try {
        const found = await runnerdAttach(
          { baseUrl: session.endpoint, token },
          execId,
          (e) =>
            forwardExecEvent(
              e,
              send,
              req.headers.get('accept')?.includes('tale-output=base64') ===
                true,
            ),
          AbortSignal.any([ac.signal, signal]),
          sinceSeq,
        );
        if (!found)
          await send('error', { message: `exec ${execId} not found` });
      } catch (err) {
        // The caller hung up: see handleExec.
        if (req.signal.aborted || signal.aborted) return;
        if (err instanceof RunnerdAttachBusyError) {
          await send('error', { code: 'ATTACH_BUSY', message: err.message });
          return;
        }
        await send('error', {
          message: err instanceof Error ? err.message : String(err),
          ...(err instanceof RunnerdProtocolError ||
          err instanceof RunnerdOutputGapError
            ? { code: err.code }
            : {}),
        });
        // See handleExec: a dead backend object must surface as 404 on the
        // next reconnect, not as an endless transport error.
        if (
          !(err instanceof RunnerdProtocolError) &&
          !(err instanceof RunnerdOutputGapError)
        )
          await this.evictIfBackendGone(sessionId);
      } finally {
        req.signal.removeEventListener('abort', onAbort);
      }
    });
  }

  /** PATCH /v1/sessions/:id/env — set/unset session env (the hook the
   * credential/gateway-token injection uses). */
  async handleEnvPatch(sessionId: string, body: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { set?: Record<string, string>; unset?: string[] };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as {
        set?: Record<string, string>;
        unset?: string[];
      };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let denied: string[];
    try {
      denied = await runnerdEnvPatch(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        { set: parsed.set, unset: parsed.unset },
      );
    } catch (err) {
      if (await this.evictIfBackendGone(sessionId)) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse({ ok: true, denied }, 200);
  }

  /** A pin is published only after runnerd and durable storage agree. Serial
   * requests cannot overtake one another or write into a local replacement. */
  async handleSetPinned(sessionId: string, body: string): Promise<Response> {
    const previous = this.pinOperations.get(sessionId) ?? Promise.resolve();
    const work = previous.then(() => this.setPinned(sessionId, body));
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.pinOperations.set(sessionId, settled);
    try {
      return await work;
    } finally {
      if (this.pinOperations.get(sessionId) === settled)
        this.pinOperations.delete(sessionId);
    }
  }

  private async setPinned(sessionId: string, body: string): Promise<Response> {
    if (this.destroySettled.has(sessionId) || this.creating.has(sessionId)) {
      return jsonResponse({ error: 'session_unavailable' }, 503, {
        'retry-after': '1',
      });
    }
    await this.stopping.get(sessionId);
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let pinned: boolean;
    try {
      const parsed: unknown = JSON.parse(body);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !('pinned' in parsed) ||
        typeof parsed.pinned !== 'boolean'
      ) {
        return jsonResponse(
          { error: 'bad_request', message: 'pinned must be a boolean' },
          400,
        );
      }
      pinned = parsed.pinned;
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    // Protect even a legacy runnerd while persistence retries; report only the
    // acknowledged value so platform reconciliation can still see the drift.
    this.pinProtection.set(sessionId, session);
    try {
      try {
        const applied = await runnerdActivity(
          {
            baseUrl: session.endpoint,
            token: this.tokenFor(sessionId),
            incarnation: session.createdAtMs,
          },
          'pin',
          { pinned },
        );
        if (applied.ok !== true)
          throw new Error('runnerd did not acknowledge the pin');
      } catch (error) {
        if (!(error instanceof RunnerdActivityError && error.status === 404))
          throw error;
      }
      if (this.registry.get(sessionId) !== session)
        return jsonResponse({ error: 'session_unavailable' }, 503);
      await this.backend.setPinned(sessionId, pinned, session.createdAtMs);
      if (this.registry.get(sessionId) !== session)
        return jsonResponse({ error: 'session_unavailable' }, 503);
      const wasPinned = session.pinned === true;
      session.pinned = pinned;
      if (wasPinned && !pinned)
        session.expiresAtMs = Date.now() + this.cfg.session.maxLifetimeMs;
      if (this.pinProtection.get(sessionId) === session)
        this.pinProtection.delete(sessionId);
      return jsonResponse({ ok: true, pinned }, 200);
    } catch (error) {
      if (this.registry.get(sessionId) !== session)
        return jsonResponse({ error: 'session_unavailable' }, 503);
      console.warn(
        `[sandbox.session] pin=${pinned} for ${sessionId} was not durably acknowledged:`,
        error,
      );
      if (
        error instanceof SessionIncarnationChangedError ||
        this.refusedAsReplaced(session, error)
      ) {
        this.forgetReclaimed(session);
        return jsonResponse({ error: 'session_unavailable' }, 503, {
          'retry-after': '1',
        });
      }
      if (await this.evictIfBackendGone(sessionId))
        return jsonResponse({ error: 'not_found' }, 404);
      return jsonResponse({ error: 'session_unavailable' }, 503, {
        'retry-after': '1',
      });
    }
  }

  /** POST /v1/sessions/:id/files/stage — write files into /agent (inline
   * base64 content, or presigned URLs the daemon fetches). */
  async handleFilesStage(
    sessionId: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: {
      files?: Array<{
        path: string;
        url?: string;
        contentBase64?: string;
        sha256?: string;
        cacheKey?: string;
        sourceId?: string;
      }>;
      replaceRoots?: string[];
      keepPaths?: string[];
    };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as typeof parsed;
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        (parsed.files !== undefined &&
          (!Array.isArray(parsed.files) ||
            parsed.files.some(
              (file) =>
                file === null ||
                typeof file !== 'object' ||
                typeof file.path !== 'string' ||
                (file.url === undefined &&
                  file.contentBase64 === undefined &&
                  file.sourceId === undefined) ||
                (file.url !== undefined && typeof file.url !== 'string') ||
                (file.contentBase64 !== undefined &&
                  typeof file.contentBase64 !== 'string') ||
                (file.sha256 !== undefined &&
                  (typeof file.sha256 !== 'string' ||
                    !/^[a-f0-9]{64}$/.test(file.sha256))) ||
                (file.cacheKey !== undefined &&
                  (typeof file.cacheKey !== 'string' ||
                    file.cacheKey.length === 0 ||
                    file.cacheKey.length > 256)) ||
                (file.sourceId !== undefined &&
                  (typeof file.sourceId !== 'string' ||
                    file.sourceId.length === 0 ||
                    file.sourceId.length > 2048)),
            ))) ||
        [parsed.replaceRoots, parsed.keepPaths].some(
          (paths) =>
            paths !== undefined &&
            (!Array.isArray(paths) ||
              paths.some((path) => typeof path !== 'string')),
        )
      ) {
        return jsonResponse(
          {
            error: 'bad_request',
            message: 'invalid staging files or reconciliation paths',
          },
          400,
        );
      }
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let result;
    try {
      result = await runnerdStageFiles(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        parsed.files ?? [],
        { replaceRoots: parsed.replaceRoots, keepPaths: parsed.keepPaths },
        { signal },
      );
    } catch (err) {
      if (err instanceof RunnerdStageBusyError)
        return jsonResponse({ error: 'busy' }, 503, { 'retry-after': '1' });
      // Evict a zombie but answer 502, NOT 404 — the file routes' 404 already
      // means "path not found" platform-side; a session-gone 404 here would
      // be misread. The eviction makes the next aliveness probe 404 instead.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse(result, 200);
  }

  /** POST /v1/sessions/:id/files/delete — remove paths (file or dir) from
   * /agent. Idempotent reconcile primitive (e.g. pruning stale skills). */
  async handleFilesDelete(sessionId: string, body: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { paths?: string[] };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as { paths?: string[] };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let result;
    try {
      result = await runnerdDeleteFiles(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        parsed.paths ?? [],
      );
    } catch (err) {
      // 502 not 404 — see handleFilesStage.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    return jsonResponse(result, 200);
  }

  /** GET /v1/sessions/:id/files?path= — directory listing. */
  async handleFilesList(sessionId: string, path: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let entries;
    try {
      entries = await runnerdListDir(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        path,
      );
    } catch (err) {
      // 502 not 404 — see handleFilesStage.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    if (entries === null) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ entries }, 200);
  }

  /** GET /v1/sessions/:id/files/content?path= — raw file bytes streamed
   * through the spawner. */
  async handleFileContent(
    sessionId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (session instanceof Response) return session;
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let bytes;
    try {
      bytes = await runnerdReadFile(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        path,
        signal,
      );
    } catch (err) {
      // 502 not 404 — see handleFilesStage.
      await this.evictIfBackendGone(sessionId);
      return jsonResponse(
        {
          error: 'upstream_error',
          message: err instanceof Error ? err.message : String(err),
        },
        502,
      );
    }
    if (bytes === null) return jsonResponse({ error: 'not_found' }, 404);
    return new Response(bytes.body, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
}

/** The result code for a runnerd exec refused before it spawned. A cwd it
 * rejected and a session whose every live-exec place is taken keep their own
 * codes: the caller fixes the first and waits out the second, where any
 * other refusal is a runtime error. */
function execFailErrorCode(
  code: Extract<RunnerdExecEvent, { t: 'fail' }>['code'],
): SandboxErrorCode {
  return code === 'INVALID_CWD' || code === 'EXEC_LIMIT'
    ? code
    : 'RUNTIME_ERROR';
}

/** Translate a runnerd exec NDJSON event into the SSE event grammar used by
 * both /exec and /exec/:id/attach. */
async function forwardExecEvent(
  e: RunnerdExecEvent,
  send: (event: string, data: unknown) => void | Promise<void>,
  binaryOutput = false,
): Promise<void> {
  switch (e.t) {
    case 'replay-start':
      await send('replay-start', {});
      break;
    case 'replay-complete':
      await send('replay-complete', { throughSeq: e.throughSeq });
      break;
    case 'start':
      await send('phase', { phase: 'running' });
      break;
    case 'stdout':
      await send('stdout', {
        ...(binaryOutput
          ? { b64: e.b64 }
          : {
              text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
                b64decode(e.b64),
              ),
              b64: e.b64,
            }),
        seq: e.seq,
      });
      break;
    case 'stderr':
      await send('stderr', {
        ...(binaryOutput
          ? { b64: e.b64 }
          : {
              text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
                b64decode(e.b64),
              ),
              b64: e.b64,
            }),
        seq: e.seq,
      });
      break;
    case 'exit':
      await send('result', {
        status: e.cancelled
          ? 'cancelled'
          : e.exitCode === 0
            ? 'completed'
            : 'failed',
        exitCode: e.exitCode,
        durationMs: e.durationMs,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: e.truncated,
        // See handleExec: a clean exit (0) that raced the deadline genuinely
        // completed — don't pair it with a contradictory TIMEOUT marker.
        ...(e.timedOut && e.exitCode !== 0
          ? { errorCode: 'TIMEOUT' as const }
          : {}),
      } satisfies SessionExecResponse);
      break;
    case 'gap':
      await send('gap', { fromSeq: e.fromSeq, toSeq: e.toSeq });
      break;
    case 'fail':
      await send('result', {
        status: 'failed',
        exitCode: null,
        // Sentinel: the process never ran, so there is no runnerd
        // measurement to forward (wire.ts `durationMs` contract).
        durationMs: 0,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: { stdout: false, stderr: false },
        errorCode: execFailErrorCode(e.code),
        errorMessage: e.message,
      } satisfies SessionExecResponse);
      break;
  }
}

function concatBase64(chunks: Uint8Array[]): string {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return Buffer.from(out).toString('base64');
}
