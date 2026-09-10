// HTTP route handlers for the /v1/sessions API. Mounted by server.ts behind
// the same HMAC authorize() gate as the deploy routes. The handlers own session
// quota + registry bookkeeping; the SessionBackend owns container/Pod
// lifecycle and runnerd addressing; runnerd owns the actual exec.

import {
  SessionIncarnationChangedError,
  type BackendSession,
  type CreateSessionResult,
  type SessionBackend,
} from '../backend/types.ts';
import { jsonResponse } from '../http-util.ts';
import { sseResponse } from '../sse.ts';
import type { SpawnerConfig } from '../types.ts';
import type { SessionExecResponse, SessionInfo } from '../wire.ts';
import {
  RunnerdActivityError,
  runnerdActivity,
  runnerdAttach,
  runnerdCancelExec,
  runnerdDeleteFiles,
  runnerdEnvPatch,
  runnerdExec,
  runnerdExecStatus,
  runnerdHealth,
  runnerdListDir,
  runnerdReadFile,
  runnerdStageFiles,
  runnerdWriteStdin,
} from './runnerd-client.ts';
import type { RunnerdExecEvent } from './runnerd-protocol.ts';
import { deriveRunnerdToken } from './session-naming.ts';
import { SessionRegistry, type RegistrySession } from './session-registry.ts';
import {
  validateCreateSession,
  validateExecSession,
} from './validate-session.ts';

function b64decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** How long a session whose runnerd failed a reclaim probe stays off the
 * candidate list — the periodic sweep re-probes everything anyway. */
const RECLAIM_PROBE_BACKOFF_MS = 30_000;

/** Longest an acquire waits for an in-flight create of the same id. Under
 * the platform's own acquire timeout, so a create that is still pulling its
 * image answers not-found (the caller retries) rather than a client timeout. */
const ACQUIRE_WAITS_FOR_CREATE_MS = 10_000;

export class SessionRoutes {
  private readonly registry = new SessionRegistry();
  // Session ids with a createSession in flight → their organization. The
  // registry is only populated AFTER the backend create resolves (up to
  // createHealthTimeoutMs later, through an image pull), so this map closes
  // the gap a concurrent create would otherwise slip through: the same id
  // (a duplicate) AND the deployment cap, which counts in-flight creates as
  // occupied capacity — a burst of distinct ids during a slow pull must not
  // oversubscribe the host by the number of creates in flight.
  private readonly creating = new Map<string, string>();
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
  // waiter would surface as a 500.
  private readonly stopping = new Map<string, Promise<boolean>>();
  // Sessions whose runnerd did not answer a reclaim probe, by failure time:
  // skipped as reclaim candidates for a short window so one wedged daemon
  // (a full health timeout) does not stall every create at capacity.
  private readonly probeFailedAtMs = new Map<string, number>();

  // Backend lists behind ensureRegistered (the platform probes sessionIsAlive
  // + exec-status per turn, so a stopped session would otherwise cost one
  // `docker ps` / pod list PER probe). `resolving` is the list in flight;
  // `resolvingNext` the ONE follow-up every miss that arrives during it waits
  // for — a caller must only be answered by a snapshot taken after its miss.
  // Both `null` when idle; at most two lists are ever in flight.
  private resolving: Promise<BackendSession[]> | null = null;
  private resolvingNext: Promise<BackendSession[]> | null = null;

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
  ) {}

  /** Number of live sessions this spawner currently manages (drain readiness). */
  sessionCount(): number {
    return this.registry.size();
  }

  /** Creates that may not have a container/Pod yet, for capacity reporting. */
  pendingCreates(): ReadonlyMap<string, string> {
    return new Map(this.creating);
  }

  /** Live session ids — the deploy reads these from `/v1/drain-status` to decide
   * whether to LINGER this spawner (keep it serving its sessions) rather than
   * tear it down during an in-place roll. */
  sessionIds(): string[] {
    return this.registry.list().map((s) => s.sessionId);
  }

  /** Force-stop every non-finished session (compute reclaimed, workspace
   * preserved). Used by the spawner's max-linger self-reap so a spawner that
   * lingered past its TTL can shut down without orphaning containers — even if
   * the deploy died mid-roll. Returns the number stopped. */
  async stopAllSessions(): Promise<number> {
    let stopped = 0;
    for (const s of this.registry.list()) {
      try {
        await this.backend.stopSession(s.sessionId);
        this.registry.delete(s.sessionId);
        this.forgetReclaimMarks(s.sessionId);
        stopped += 1;
      } catch (err) {
        console.warn(
          `[sandbox.session] linger stop failed for ${s.sessionId}:`,
          err,
        );
      }
    }
    return stopped;
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

  private atCapacity(): boolean {
    return (
      this.registry.size() + this.creating.size >= this.cfg.session.maxSessions
    );
  }

  /** The admission decision for one create: a duplicate id → 409, a full
   * host → `'full'`, else the id is reserved in `creating`. */
  private admit(
    sessionId: string,
    organizationId: string,
  ): Response | 'full' | null {
    if (this.registry.has(sessionId) || this.creating.has(sessionId)) {
      return jsonResponse(
        {
          error: 'duplicate',
          message: `session ${sessionId} exists or is being created`,
        },
        409,
      );
    }
    if (this.atCapacity()) return 'full';
    this.creating.set(sessionId, organizationId);
    this.createSettled.set(sessionId, Promise.withResolvers<void>());
    return null;
  }

  private async reserveCreate(
    sessionId: string,
    organizationId: string,
  ): Promise<Response | null> {
    let decision = await this.withAdmission(() =>
      this.admit(sessionId, organizationId),
    );
    if (decision === 'full') {
      // At capacity: try to reclaim ONE released idle session, outside the
      // admission lock (a probe per candidate and a backend stop take
      // seconds — creates that still have room must not queue behind them),
      // then decide again. Concurrent creates at capacity share the one stop
      // in flight and only the first to re-enter admission gets its slot.
      await this.reclaimOneIdle();
      decision = await this.withAdmission(() =>
        this.admit(sessionId, organizationId),
      );
    }
    if (decision === 'full') {
      return jsonResponse(
        { error: 'session_quota', message: 'spawner session cap reached' },
        429,
        { 'retry-after': '10' },
      );
    }
    return decision;
  }

  /** Reclaim the oldest released idle session, if any. Candidates that
   * failed their last probe within the back-off window are skipped: a
   * wedged daemon costs one health timeout per window, not one per create. */
  private async reclaimOneIdle(): Promise<boolean> {
    const now = Date.now();
    for (const session of this.registry.list()) {
      const failedAt = this.probeFailedAtMs.get(session.sessionId);
      if (
        failedAt !== undefined &&
        now - failedAt < RECLAIM_PROBE_BACKOFF_MS &&
        !this.reclaimClaims.has(session.sessionId)
      ) {
        continue;
      }
      if (await this.reclaimIdle(session)) return true;
    }
    return false;
  }

  /** runnerd's atomic claim closes the health-probe→stop race across replicas.
   * Unknown/old daemons refuse, as do busy, pinned and unreleased sessions.
   * A failed stop keeps its claim frozen and counted until a later retry.
   * Never rejects: a waiter sharing the stop sees `false`, not a 500. */
  private reclaimIdle(session: RegistrySession): Promise<boolean> {
    const pending = this.stopping.get(session.sessionId);
    if (pending !== undefined) return pending;
    if (
      session.pinned ||
      session.liveExecs.size > 0 ||
      this.creating.has(session.sessionId)
    ) {
      return Promise.resolve(false);
    }
    const reclaim = this.stopClaimedIdle(session).finally(() => {
      this.stopping.delete(session.sessionId);
    });
    this.stopping.set(session.sessionId, reclaim);
    return reclaim;
  }

  private async stopClaimedIdle(session: RegistrySession): Promise<boolean> {
    const sessionId = session.sessionId;
    const opts = { baseUrl: session.endpoint, token: this.tokenFor(sessionId) };
    const held = this.reclaimClaims.get(sessionId);
    if (held !== undefined && held.createdAtMs !== session.createdAtMs) {
      // Taken on an incarnation that has since left the registry; it must
      // not follow the deterministic id onto this replacement.
      this.reclaimClaims.delete(sessionId);
    }
    try {
      if (!this.reclaimClaims.has(sessionId)) {
        const health = await runnerdHealth(opts);
        const activity = health.activity;
        if (
          activity === undefined ||
          activity.pinned ||
          health.liveExecs > 0 ||
          activity.activeOperations > 0 ||
          (!activity.released && !activity.reclaiming)
        ) {
          return false;
        }
        const claimId = crypto.randomUUID();
        const result = await runnerdActivity(opts, 'reclaim', {
          claimId,
          generation: activity.generation,
        });
        if (result.claimed !== true) return false;
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
      // An older daemon has no claim route and cannot have frozen itself.
      if (error instanceof RunnerdActivityError && error.status === 404) {
        return false;
      }
      if (error instanceof SessionIncarnationChangedError) {
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
    if (this.registry.get(session.sessionId) === session) {
      this.registry.delete(session.sessionId);
    }
    this.forgetReclaimMarks(session.sessionId);
  }

  private forgetReclaimMarks(sessionId: string): void {
    this.reclaimClaims.delete(sessionId);
    this.probeFailedAtMs.delete(sessionId);
  }

  /**
   * Re-adoption: rebuild the in-memory registry from the backend objects still
   * running (the registry is a cache; the backend labels/annotations are the
   * source of truth). Idempotent — skips sessions already registered — and
   * called at boot AND on every periodic sweep tick, so a session this spawner
   * missed (a boot-time `docker ps`/apiserver blip, a peer replica's create)
   * is registered within one interval and from then on routable + subject to
   * the TTL/idle reaper, instead of lingering unregistered for the life of the
   * process. Only RUNNING objects are adopted: a stopped/exited one is a
   * resumable state whose correct answer is 404 (the platform resumes it).
   */
  async adoptExisting(): Promise<void> {
    let sessions: BackendSession[];
    try {
      sessions = await this.backend.listSessions();
    } catch (err) {
      console.warn('[sandbox.session] adoptExisting list failed:', err);
      return;
    }
    const adopted: BackendSession[] = [];
    for (const s of sessions) {
      // A create in flight on this replica registers itself when it completes;
      // adopting it early would race that registration.
      if (this.registry.has(s.sessionId) || this.creating.has(s.sessionId)) {
        continue;
      }
      if (s.state !== 'ready') continue;
      const registered = await this.adoptSession(s);
      if (registered !== undefined) adopted.push(s);
    }

    // Heal the shared build cache for every org whose session was just adopted.
    // The buildkitd outlives the spawner, so the same stack restart that bounced
    // this spawner may have moved sandbox-egress to a new IP — leaving the
    // daemon's egress fence stale. An adopted session that reuses it would build
    // with no DNS/egress (the createSession heal never fires for it). Best-effort
    // inside the backend; a no-op when there's no shared cache or nothing drifted.
    if (adopted.length > 0) {
      await this.backend.reconcileBuildCache(
        adopted.map((s) => s.organizationId),
      );
    }
  }

  /** Register one backend-listed session in the cache, resolving its runnerd
   * endpoint. Returns the entry, or undefined (logged) when the endpoint can't
   * be read right now — the next sweep or route miss retries. */
  private async adoptSession(
    s: BackendSession,
  ): Promise<RegistrySession | undefined> {
    let endpoint: string;
    try {
      endpoint = await this.backend.resolveEndpoint(s.sessionId);
    } catch (err) {
      console.warn(
        `[sandbox.session] adopt skipped for ${s.sessionId} (endpoint unresolved; will retry):`,
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
    // A concurrent create/adopt may have registered it while we awaited —
    // never overwrite a live entry (it may already track in-flight execs).
    const raced = this.registry.get(s.sessionId);
    if (raced !== undefined) return raced;
    const entry: RegistrySession = {
      sessionId: s.sessionId,
      organizationId: s.organizationId,
      profile: s.profile,
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
    this.registry.set(entry);
    return entry;
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
  ): Promise<RegistrySession | undefined> {
    const hit = this.registry.get(sessionId);
    if (hit !== undefined) return hit;
    // Our own in-flight create registers itself on completion.
    if (this.creating.has(sessionId)) return undefined;
    // A lingering spawner never adopts — 404 is the status quo; the
    // replacement serves the session (see the constructor's isDraining).
    if (this.isDraining()) return undefined;
    let sessions: BackendSession[];
    try {
      sessions = await this.listForResolve();
    } catch (err) {
      console.warn(
        `[sandbox.session] backend re-resolve for ${sessionId} failed (answering not-found):`,
        err instanceof Error ? err.message : err,
      );
      return undefined;
    }
    const s = sessions.find((x) => x.sessionId === sessionId);
    if (s === undefined || s.state !== 'ready') return undefined;
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
    for (const s of this.registry.list()) {
      if (this.reclaimClaims.has(s.sessionId)) {
        if (await this.reclaimIdle(s)) reaped += 1;
        continue;
      }
      // Pinned ("always-on") sessions are exempt from BOTH idle and TTL reap.
      if (s.pinned) continue;
      // A session with a live exec is NEVER reaped — a long, QUIET tool (no
      // stdout for >idleTimeout) would otherwise be idle-killed mid-task, and a
      // running task shouldn't be cut at the hard TTL either. The registry
      // tracks in-flight execs on this replica; after a spawner restart its
      // cache is cold, so the runnerd health.liveExecs check below is the
      // backstop for a re-adopted busy session.
      if (s.liveExecs.size > 0) continue;
      let expired = nowMs > s.expiresAtMs;
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
        // Resume a frozen stop after a spawner restart through the same
        // generation and backend-incarnation fences as pressure admission.
        if (health.activity?.reclaiming) {
          if (await this.reclaimIdle(s)) reaped += 1;
          continue;
        }
        if (
          health.liveExecs > 0 ||
          (health.activity?.activeOperations ?? 0) > 0
        )
          continue;
        if (!expired) {
          expired = nowMs - health.lastActivityAtMs > s.idleTimeoutMs;
        }
      } catch (err) {
        // runnerd unreachable. Distinguish a transient blip (leave for a
        // later sweep; the TTL is the hard backstop) from a ZOMBIE — the
        // backend object is gone but the cache entry survived. Without
        // this, a dead session lingers routable-but-unreachable until TTL.
        console.warn(
          `[sandbox.session] sweep health probe failed for ${s.sessionId} (${s.endpoint}):`,
          err,
        );
        if (await this.evictIfBackendGone(s.sessionId)) {
          reaped += 1;
          continue;
        }
        // Backend still present (transient blip): fall through to the TTL-only
        // decision below — a not-yet-expired session is left for a later sweep.
      }
      if (expired) {
        // A pressure claim may have begun while the health probe awaited.
        // Its owner alone stops that incarnation, including retries.
        if (
          this.reclaimClaims.has(s.sessionId) ||
          this.stopping.has(s.sessionId) ||
          s.pinned ||
          s.liveExecs.size > 0
        )
          continue;
        // Stop, never destroy: idle/TTL release compute but keep the workspace
        // so the session resumes with its data on the next turn. stopSession
        // THROWS on a transient backend hiccup (its contract) — keep the
        // registry entry so the next sweep retries, rather than dropping a
        // still-running container from the cache and orphaning it until a
        // restart re-adopts it.
        // The shared handle settles to a boolean: an acquire or a create at
        // capacity waiting on it must see a failed stop as `false`, never
        // as a rejection it would answer with a 500.
        const stop = this.backend
          .stopSession(s.sessionId)
          .then(
            () => {
              this.registry.delete(s.sessionId);
              this.forgetReclaimMarks(s.sessionId);
              return true;
            },
            (err: unknown) => {
              console.warn(
                '[sandbox.session] sweep stop failed (will retry next sweep):',
                err,
              );
              return false;
            },
          )
          .finally(() => {
            this.stopping.delete(s.sessionId);
          });
        this.stopping.set(s.sessionId, stop);
        if (await stop) reaped += 1;
      }
    }
    // No newly adopted session is required for maintenance: the last legacy
    // session may just have stopped, allowing its global build helpers to
    // retire. Empty orgIds performs cleanup without provisioning new builders.
    try {
      await this.backend.reconcileBuildCache([]);
    } catch (error) {
      console.warn('[sandbox.session] build-cache maintenance failed:', error);
    }
    return reaped;
  }

  private toInfo(sessionId: string): SessionInfo | null {
    const s = this.registry.get(sessionId);
    if (!s) return null;
    return {
      sessionId: s.sessionId,
      organizationId: s.organizationId,
      profile: s.profile,
      // Sourced from the registry (set at create, refreshed by adoptExisting
      // from the backend) rather than a hardcoded literal, so the wire state
      // tracks the one field that records it instead of always saying 'ready'.
      state: s.state,
      backend: this.backend.kind,
      createdAtMs: s.createdAtMs,
      expiresAtMs: s.expiresAtMs,
      idleTimeoutMs: s.idleTimeoutMs,
      pinned: s.pinned === true,
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
   * Called from runnerd-failure paths and the aliveness probe: verifies the
   * backend object with the DEFINITIVE `sessionExists` check; on
   * confirmed-gone it evicts only the stale registry entry so this and
   * subsequent calls resolve to 404 → `SessionNotFoundError` → the platform
   * resumes the session in place (re-create against the PRESERVED workspace).
   * It does NOT delete the workspace: a gone container is now a resumable
   * stopped state, and data is removed only by an explicit Destroy. A THROWING
   * check means "can't judge" (backend hiccup): keep the entry — a transient
   * blip must never evict a live session. Returns true when a stale entry was
   * evicted.
   */
  private async evictIfBackendGone(sessionId: string): Promise<boolean> {
    if (!this.registry.has(sessionId)) return false;
    // A terminating Pod is unavailable for work before its compute is gone.
    // Its stop owner keeps the slot until removal is actually confirmed.
    if (this.stopping.has(sessionId)) return false;
    let alive: boolean;
    try {
      alive = await this.backend.sessionExists(sessionId);
    } catch (err) {
      console.warn(
        `[sandbox.session] liveness check for ${sessionId} failed (treating as alive):`,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
    if (alive) return false;
    console.warn(
      `[sandbox.session] ${sessionId} backend object gone; evicting stale registry entry (workspace preserved for resume)`,
    );
    this.registry.delete(sessionId);
    this.forgetReclaimMarks(sessionId);
    return true;
  }

  async handleCreate(body: string): Promise<Response> {
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

    const refused = await this.reserveCreate(req.sessionId, req.organizationId);
    if (refused !== null) return refused;
    try {
      const createdAtMs = Date.now();
      let created: CreateSessionResult;
      try {
        created = await this.backend.createSession({
          sessionId: req.sessionId,
          organizationId: req.organizationId,
          profile: req.profile,
          ttlMs: req.ttlMs,
          idleTimeoutMs: req.idleTimeoutMs,
          env: req.env,
          createdAtMs,
        });
      } catch (err) {
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
        const rollback = created.resumed
          ? this.backend.stopSession(req.sessionId)
          : this.backend.destroySession(req.sessionId);
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
      this.registry.set({
        sessionId: req.sessionId,
        organizationId: req.organizationId,
        profile: req.profile,
        state: 'ready',
        createdAtMs,
        expiresAtMs: createdAtMs + req.ttlMs,
        idleTimeoutMs: req.idleTimeoutMs,
        endpoint,
        liveExecs: new Map(),
      });
      return jsonResponse({ session: this.toInfo(req.sessionId) }, 201);
    } finally {
      this.creating.delete(req.sessionId);
      this.createSettled.get(req.sessionId)?.resolve();
      this.createSettled.delete(req.sessionId);
    }
  }

  /** GET /v1/sessions/:id — the platform's pre-turn aliveness probe keys its
   * phantom-recreate on this route's 404, so a registry hit must be verified
   * against the backend object: answering from the cache alone turns a dead
   * container into "alive" and the turn then fails on a dead address. */
  async handleGet(sessionId: string): Promise<Response> {
    if ((await this.ensureRegistered(sessionId)) === undefined) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    if (await this.evictIfBackendGone(sessionId)) {
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

  /** The release ticket is read BEFORE the platform releases its allocation.
   * Reacquiring invalidates all earlier tickets, so a delayed completion can
   * never make the next workload eligible for pressure reclamation. */
  async handleActivity(
    sessionId: string,
    action: 'ticket' | 'acquire' | 'release',
    body = '',
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
    if (!session || (await this.evictIfBackendGone(sessionId))) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    const opts = { baseUrl: session.endpoint, token: this.tokenFor(sessionId) };
    try {
      const result = await runnerdActivity(
        opts,
        action,
        generation === undefined ? undefined : { generation },
      );
      if (action === 'release') {
        if (typeof result.released !== 'boolean')
          throw new Error('invalid runnerd release response');
        return jsonResponse({ released: result.released }, 200);
      }
      if (
        typeof result.generation !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(result.generation)
      ) {
        throw new Error('invalid runnerd generation');
      }
      return jsonResponse({ generation: result.generation }, 200);
    } catch (error) {
      if (await this.evictIfBackendGone(sessionId))
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
          if (health !== null && health.activity === undefined) {
            return jsonResponse({ generation: 'legacy' }, 200);
          }
        } else return jsonResponse({ error: 'unsupported' }, 404);
      }
      return jsonResponse({ error: 'session_unavailable' }, 503, {
        'retry-after': '1',
      });
    }
  }

  async handleDestroy(
    sessionId: string,
    opts: { ifIdle?: boolean } = {},
  ): Promise<Response> {
    // Conditional destroy (`?if_idle=1`): a janitor caller (the end-of-turn
    // thread-session teardown) must never destroy a session another turn is
    // actively executing in — two turns can share one thread session (e.g.
    // the model invoking the same delegate twice in parallel onto one
    // sub-thread). Busy is decided HERE, not by the caller: the spawner owns
    // the live-exec truth. The skip is always safe — the surviving turn's own
    // teardown (or the TTL reaper) cleans up later; destroying a live exec
    // never is.
    if (opts.ifIdle && (await this.hasLiveExecs(sessionId))) {
      return jsonResponse({ destroyed: false, busy: true }, 200);
    }
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
      const backendExisted = await this.backend.destroySession(sessionId);
      return jsonResponse(
        { destroyed: had || backendExisted, busy: false },
        200,
      );
    } catch (err) {
      // The backend destroy FAILED (a wedged dockerd, an apiserver blip). Do
      // NOT report success: the container/workspace may survive, and laundering
      // it to a 200 would flip the platform's session row `destroyed` while the
      // user's data lives on — the "success toast, workspace survives" defect.
      // Restore the registry entry so the session isn't lost, and surface the
      // failure so the caller retries.
      console.error('[sandbox.session] destroy backend failed:', err);
      if (entry !== undefined) this.registry.set(entry);
      return jsonResponse(
        { destroyed: false, busy: false, error: 'backend destroy failed' },
        502,
      );
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

    const ac = new AbortController();
    const abortHandler = () => ac.abort();
    req.signal.addEventListener('abort', abortHandler, { once: true });
    this.registry.registerExec(sessionId, execReq.execId, ac);

    const token = this.tokenFor(sessionId);
    // collectOutput (default true): accumulate stdout/stderr into the terminal
    // `result` buffers (one-shot contract). A long-lived streaming exec (the
    // agent) passes false — the live SSE is the sole delivery, so we skip
    // accumulation (no unbounded growth for a never-exiting exec) and tell
    // runnerd the cap is unlimited (0) so its output is never silently cut off.
    const collect = execReq.collectOutput ?? true;
    return sseResponse(async ({ send }) => {
      // Terminal-state accumulation so the SSE `result` event matches the
      // one-shot ExecuteResponse contract (the runnerd `exit` carries
      // truncation/timeout; stdout/stderr are summed here for the buffers).
      // Skipped entirely when collect=false — the buffers stay empty.
      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let result: SessionExecResponse | null = null;
      const onEvent = (e: RunnerdExecEvent) => {
        switch (e.t) {
          case 'start':
            send('phase', { phase: 'running' });
            break;
          case 'stdout': {
            const bytes = b64decode(e.b64);
            if (collect) stdoutChunks.push(bytes);
            send('stdout', {
              text: new TextDecoder().decode(bytes),
              seq: e.seq,
            });
            break;
          }
          case 'stderr': {
            const bytes = b64decode(e.b64);
            if (collect) stderrChunks.push(bytes);
            send('stderr', {
              text: new TextDecoder().decode(bytes),
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
              errorCode:
                e.code === 'INVALID_CWD' ? 'INVALID_CWD' : 'RUNTIME_ERROR',
              errorMessage: e.message,
            };
            break;
        }
      };
      try {
        await runnerdExec(
          { baseUrl: session.endpoint, token },
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
            // truncates the live stream; memory stays bounded by its ring.
            stdoutMaxBytes: collect ? this.cfg.stdoutMaxBytes : 0,
            stderrMaxBytes: collect ? this.cfg.stderrMaxBytes : 0,
          },
          onEvent,
          ac.signal,
        );
        if (result) {
          send('result', result);
        } else {
          // Stream ended without a terminal event — runnerd/ container died.
          send('result', {
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
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
        // A transport-level runnerd failure on a gone container must convert
        // the platform's resilient-drain retry into a 404 (registry miss),
        // not another connection error.
        await this.evictIfBackendGone(sessionId);
      } finally {
        this.registry.unregisterExec(sessionId, execReq.execId);
        req.signal.removeEventListener('abort', abortHandler);
      }
    });
  }

  async handleExecCancel(sessionId: string, execId: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    // Local abort (ends the SSE proxy) + tell runnerd to kill the process group.
    this.registry.getExec(sessionId, execId)?.abort();
    let killed: boolean;
    try {
      killed = await runnerdCancelExec(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
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
  async handleExecStatus(sessionId: string, execId: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (!session) return jsonResponse({ execId, state: 'gone' }, 404);
    try {
      const status = await runnerdExecStatus(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        execId,
      );
      return jsonResponse(status, status.state === 'gone' ? 404 : 200);
    } catch (err) {
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
   * just-finished exec; replays runnerd's ring then follows to exit. The
   * resilience path for a platform action that dropped its original SSE. */
  async handleExecAttach(
    req: Request,
    sessionId: string,
    execId: string,
  ): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.signal.addEventListener('abort', onAbort, { once: true });
    // Resume cursor: the platform passes the highest seq it already consumed so
    // runnerd replays only newer events (idempotent reconnect).
    const sinceSeq =
      Number(new URL(req.url).searchParams.get('sinceSeq') ?? '0') || 0;
    const token = this.tokenFor(sessionId);
    return sseResponse(async ({ send }) => {
      try {
        const found = await runnerdAttach(
          { baseUrl: session.endpoint, token },
          execId,
          (e) => forwardExecEvent(e, send),
          ac.signal,
          sinceSeq,
        );
        if (!found) send('error', { message: `exec ${execId} not found` });
      } catch (err) {
        send('error', {
          message: err instanceof Error ? err.message : String(err),
        });
        // See handleExec: a dead backend object must surface as 404 on the
        // next reconnect, not as an endless transport error.
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

  /** PATCH /v1/sessions/:id/pin — toggle "always-on". Pinned sessions are
   * exempt from the idle/TTL reaper; unpinning restores a fresh normal TTL.
   * The flag takes effect in the registry at once and is then recorded on
   * the backend object's durable state (see SessionBackend.setPinned) so a
   * spawner restart re-adopts it — the platform row is the durable truth
   * platform-side, but nothing re-pushes it at spawner boot. */
  async handleSetPinned(sessionId: string, body: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: { pinned?: boolean };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as { pinned?: boolean };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    const pinned = parsed.pinned === true;
    try {
      await runnerdActivity(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        'pin',
        { pinned },
      );
    } catch (error) {
      // An old image has no pressure gate, so the durable backend pin remains
      // sufficient. Other failures must not acknowledge an unapplied pin.
      if (!(error instanceof RunnerdActivityError && error.status === 404)) {
        return jsonResponse({ error: 'session_unavailable' }, 503);
      }
    }
    session.pinned = pinned;
    if (!pinned) {
      // Give an unpinned session a fresh lifetime so it isn't reaped instantly.
      session.expiresAtMs = Date.now() + this.cfg.session.maxLifetimeMs;
    }
    // Best-effort durability: the in-memory pin already protects this process;
    // a failed record means the pin would not survive a RESTART, which is
    // worth an operator-visible line, not a failed toggle.
    try {
      await this.backend.setPinned(sessionId, pinned);
    } catch (err) {
      console.warn(
        `[sandbox.session] recording pin=${pinned} for ${sessionId} on the backend failed (in-memory pin applied; will not survive a spawner restart):`,
        err,
      );
    }
    return jsonResponse({ ok: true, pinned }, 200);
  }

  /** POST /v1/sessions/:id/files/stage — write files into /agent (inline
   * base64 content, or presigned URLs the daemon fetches). */
  async handleFilesStage(sessionId: string, body: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let parsed: {
      files?: Array<{ path: string; url?: string; contentBase64?: string }>;
    };
    try {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      parsed = JSON.parse(body) as {
        files?: Array<{ path: string; url?: string; contentBase64?: string }>;
      };
    } catch (err) {
      return jsonResponse({ error: 'bad_request', message: String(err) }, 400);
    }
    let result;
    try {
      result = await runnerdStageFiles(
        { baseUrl: session.endpoint, token: this.tokenFor(sessionId) },
        parsed.files ?? [],
      );
    } catch (err) {
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
  async handleFileContent(sessionId: string, path: string): Promise<Response> {
    const session = await this.ensureRegistered(sessionId);
    if (!session) return jsonResponse({ error: 'not_found' }, 404);
    let bytes;
    try {
      bytes = await runnerdReadFile(
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
    if (bytes === null) return jsonResponse({ error: 'not_found' }, 404);
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }
}

/** Translate a runnerd exec NDJSON event into the SSE event grammar used by
 * both /exec and /exec/:id/attach. */
function forwardExecEvent(
  e: RunnerdExecEvent,
  send: (event: string, data: unknown) => void,
): void {
  switch (e.t) {
    case 'start':
      send('phase', { phase: 'running' });
      break;
    case 'stdout':
      send('stdout', {
        text: new TextDecoder().decode(b64decode(e.b64)),
        seq: e.seq,
      });
      break;
    case 'stderr':
      send('stderr', {
        text: new TextDecoder().decode(b64decode(e.b64)),
        seq: e.seq,
      });
      break;
    case 'exit':
      send('result', {
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
    case 'fail':
      send('result', {
        status: 'failed',
        exitCode: null,
        // Sentinel: the process never ran, so there is no runnerd
        // measurement to forward (wire.ts `durationMs` contract).
        durationMs: 0,
        stdoutBase64: '',
        stderrBase64: '',
        truncated: { stdout: false, stderr: false },
        errorCode: e.code === 'INVALID_CWD' ? 'INVALID_CWD' : 'RUNTIME_ERROR',
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
