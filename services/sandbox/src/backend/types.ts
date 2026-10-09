// Backend abstraction — the spawner's host lifecycle + persistent sessions.
//
// Every sandbox run is a session. The `HostBackend` (docker | k8s) owns the spawner's host-level lifecycle (boot init,
// image warm, /health, shutdown) + the legacy one-shot orphan sweep. The
// `SessionBackend` owns the long-lived session container/Pod lifecycle. Both are
// chosen once at boot from `SANDBOX_BACKEND` (see backend/index.ts).

import type { SessionDiskState } from '../host-disk.ts';
import type { LargestWorkspaces } from '../session/workspace-usage.ts';
import type { SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile, SandboxSessionState } from '../wire.ts';

export type HealthResult =
  | { ok: true; detail: string }
  | {
      ok: false;
      error: string;
      /** The probe could not ask the backend at all (no docker CLI slot came
       * free in time): answered as unhealthy, never cached. */
      transient?: boolean;
    };

/** A fenced operation found a DIFFERENT incarnation under the session's
 * deterministic name than the one it was asked to observe (`expectedCreatedAtMs`
 * mismatch, or the Pod/Secret UID moved): nothing was touched, and the caller
 * must not count that replacement as freed. */
export class SessionIncarnationChangedError extends Error {
  constructor(sessionId: string, detail: string) {
    super(`session ${sessionId} incarnation changed (${detail})`);
    this.name = 'SessionIncarnationChangedError';
  }
}

/** A create found a LIVE session under the id's deterministic name — a
 * running container, or a Pod that is neither terminating nor ended — that
 * the route's registry does not hold: a peer replica's create, or compute
 * this spawner lost track of (a restart before adoption). Nothing was
 * touched. The route answers it as a duplicate, so the caller adopts the
 * session through acquire instead of treating the create as failed and
 * tearing down what runs under the id. */
export class SessionExistsError extends Error {
  constructor(sessionId: string, detail: string, options?: ErrorOptions) {
    super(`session ${sessionId} already exists (${detail})`, options);
    this.name = 'SessionExistsError';
  }
}

export interface SweepOptions {
  /** Reap runtimes whose start time is older than this epoch-ms threshold. */
  staleBeforeMs: number;
  /** True while a runtime id is still live (legacy one-shot sweep; nothing is
   * live now, so this is `() => false` — see cleanup.ts). */
  isLive: (executionId: string) => boolean;
}

/**
 * The spawner's host lifecycle backend — no longer executes code (every run is
 * a session). One implementation per deployment target (DockerBackend = Compose;
 * KubernetesBackend = Helm).
 */
export interface HostBackend {
  readonly kind: 'docker' | 'kubernetes';

  /**
   * Boot setup. DockerBackend acquires the host-session lock and runs the boot
   * orphan sweep; KubernetesBackend verifies API/RBAC reachability. Throwing
   * here is fatal (server exits).
   */
  init(): Promise<void>;
  /** Graceful-shutdown hook (DockerBackend releases the host-session lock). */
  shutdown(): Promise<void>;

  /** Liveness probe backing GET /health. */
  health(): Promise<HealthResult>;
  /** Make the runtime image present (no-op where the platform pulls).
   * Throws while it stays absent, so the caller tries again later. */
  warmImage(): Promise<void>;

  /**
   * Reap orphaned one-shot runtimes/dirs left by crashes or stale runs. Every
   * sandbox run is a session now, so this finds nothing new (session
   * containers/Pods are label-disjoint and swept by the session TTL/idle
   * reaper); it stays to clean up stray legacy `tale.sandbox=1` orphans.
   */
  sweepOrphans(opts: SweepOptions): Promise<number>;
}

// ---------------------------------------------------------------------------
// Persistent sessions. A SessionBackend manages
// LONG-LIVED runtime containers/Pods running the in-container runnerd daemon;
// the spawner's session routes proxy in-session operations to runnerd over
// HTTP (Docker: container DNS name on tale-sandbox-net; K8s: Pod IP). The
// interface is deliberately thin — exec/file/env operations are runnerd's
// job, addressed via `resolveEndpoint`; the backend owns only the
// container/Pod lifecycle.
// ---------------------------------------------------------------------------

/** What `createSession()` needs to launch a session container/Pod. */
export interface SessionSpec {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  /** Resolved capability for this incarnation; absent uses the deployment default. */
  docker?: boolean;
  /** Clamped by the route layer to cfg.session.maxLifetimeMs / maxIdleMs. */
  ttlMs: number;
  idleTimeoutMs: number;
  /** Initial session env (deny-list validated route-side; runnerd
   * re-enforces). Reaches the daemon's env store, NOT the container's
   * process env — docker inspect must never show user values. */
  env: Record<string, string>;
  createdAtMs: number;
  /** Caller cancellation; never serialized into the container or Pod. */
  signal?: AbortSignal;
}

/** A backend's record of one live session, reconstructed from backend-object
 * labels/annotations on boot re-adoption (the registry is a cache, not the
 * source of truth). */
export interface BackendSession {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  /** Durable capability label; absent only on older runtime objects. */
  docker?: boolean;
  createdAtMs: number;
  ttlMs: number;
  idleTimeoutMs: number;
  /** Liveness as far as the backend object can tell (running container vs
   * exited). `degraded` here means the object exists but isn't running;
   * runnerd reachability is layered on top by the route/registry layer. */
  state: Extract<SandboxSessionState, 'ready' | 'degraded'>;
  /** "Always-on" as recorded by {@link SessionBackend.setPinned} — the reaper
   * exemption a re-adopting spawner must carry over, or a restart (deploy,
   * crash) TTL/idle-reaps the user's pinned session on its first sweep. */
  pinned?: boolean;
  /** The object's process has ended for good (a Docker container exited or
   * dead, a Pod Succeeded or Failed) — nothing runs or will run in it. Unlike
   * `degraded`, which also covers one still starting. */
  ended?: boolean;
  /** The egress proxy address the session pinned its transparent egress to
   * when it booted (Docker: the `tale.egress-ip` label). Absent when the
   * session pins none, or a spawner without the label created it. */
  egressAddress?: string;
}

/** One workspace a backend holds (host dir / PVC), whatever its compute
 * state — the physical half of the platform's workspace cleanup, which
 * decides from its own ownership records which of these may go. */
export interface BackendWorkspace {
  sessionId: string;
  /** When the backend last saw the workspace change: a Docker workspace
   * dir's newest mtime/ctime (a resume re-chowns it), a PVC's creation.
   * The platform leaves a recently touched workspace alone whatever its
   * records say, so a create racing its own row is never taken. */
  touchedAtMs: number;
  /** A container/Pod exists for the session (running or not). */
  active: boolean;
  /** The durable "always-on" record (see {@link SessionBackend.setPinned}). */
  pinned: boolean;
  /** The owning organization, where the backend object records it. */
  organizationId?: string;
}

/** What {@link SessionBackend.teardownOrganization} removed. */
export interface OrganizationTeardownResult {
  containers: number;
  volumes: number;
  networks: number;
}

/** What `createSession()` reports back once the session is `ready`. */
export interface CreateSessionResult {
  /**
   * True when the workspace (host dir / PVC) already existed — this create
   * RESUMED a stopped session onto preserved data. The route layer keys its
   * own post-create rollback on it: a resume rolls back with `stopSession`
   * (compute released, data kept); only a fresh create may `destroySession`
   * the half-made workspace it provisioned itself.
   */
  resumed: boolean;
  /**
   * The incarnation runnerd named in the readiness answer this create waited
   * for (see RUNNERD_INCARNATION_ENV): the route layer records it like any
   * later runnerd answer, so a fresh or resumed session's first activity call
   * needs no backend existence check. Absent when runnerd named none (an
   * older runtime image, or a backend that launches without the stamp).
   */
  incarnation?: string;
  /** The egress proxy address the create recorded as the one the session
   * pins (see {@link BackendSession.egressAddress}); absent when it pins
   * none or the address could not be read. */
  egressAddress?: string;
}

/**
 * How far deleting a destroyed workspace's bytes has come, as every destroy
 * answers it — the one completion signal the platform settles on:
 *  - `done` — nothing of it is left (Docker: no trash entry of the id);
 *  - `pending` — it waits in the trash or is being deleted;
 *  - `failed` — the last attempt at it failed, and the next one tries again;
 *  - `handed_off` — Kubernetes: the PVC delete was accepted, and the volume
 *    is its storage provisioner's to delete under the storage class's reclaim
 *    policy, which the spawner cannot observe. Never presented as `done`.
 * A destroy answer without it comes from a spawner or device older than this
 * contract — one that already deleted in the background (19776cf18) — and
 * proves nothing about the bytes.
 */
export type WorkspaceDeletion = 'done' | 'pending' | 'failed' | 'handed_off';

/** What the build-cache upkeep is told about the host. */
export interface BuildCacheUpkeep {
  /** The disk the workspaces live on, read now (null when it cannot be):
   * while it is below its floor, the caches of organizations that are not
   * building go first. */
  sessionDisk?: () => Promise<SessionDiskState | null>;
}

/** How a stop ends what still runs in the session. */
export interface StopSessionOptions {
  /** Let the session end its own work for this long before it is killed:
   * runnerd passes the stop on to every live exec (a harness writes its
   * transcript, a wrapper restores what it staged) and a Docker-in-sandbox
   * session's supervisor shuts its inner engine down. Absent or 0, the
   * compute is killed at once — the stop of an idle session, which has
   * nothing to end. Docker only: a Kubernetes Pod is always deleted with its
   * own grace period. */
  graceMs?: number;
}

export interface SessionBackend {
  readonly kind: 'docker' | 'kubernetes';
  /**
   * Launch the session container/Pod and wait until runnerd's /healthz
   * answers (budget: cfg.session.createHealthTimeoutMs). On failure the
   * backend cleans up whatever it created before throwing — a failed create
   * never leaks a container, and a failed RESUME never deletes the preserved
   * workspace (stop, not destroy). Returns once the session is `ready`.
   */
  createSession(spec: SessionSpec): Promise<CreateSessionResult>;
  /** Base URL of the session's runnerd (e.g. http://tale-sbx-ses-<id>:8200).
   * Resolved per call — on K8s the Pod IP can change across container
   * replacements. Throws if the backend object doesn't exist. When given a
   * creation stamp, rejects a replacement with SessionIncarnationChangedError;
   * never pairs listed metadata with another incarnation's endpoint. */
  resolveEndpoint(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<string>;
  /**
   * DEFINITIVE liveness check of the backend object: true only when the
   * container/Pod exists AND is running. Returns false on a confirmed
   * "object gone/dead" answer (docker "No such object", K8s 404, exited
   * container) — the zombie-registry-eviction signal. THROWS when the
   * backend can't answer (daemon/API hiccup): callers MUST treat a throw as
   * "unknown", never as "gone" — a transient backend blip must not get a
   * live session destroyed. With an expected creation stamp, a different
   * incarnation is false, while unreadable identity still throws. Without
   * one, ANY running incarnation counts (notably when verifying freed capacity).
   */
  sessionExists(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean>;
  /** Tear down container/Pod (+ Secret on K8s) and DELETE the workspace
   * (host dir / PVC). The ONLY data-deleting verb — reached through the
   * DELETE route (the explicit Destroy, and the platform's workspace cleanup)
   * and a deleted organization's teardown. Resolves without waiting for the
   * data itself to go, so a large workspace answers as fast as a small one:
   * Docker renames the dir into the session root's trash, emptied in the
   * background (session/workspace-trash.ts), and deletes in place only where
   * that rename cannot happen; the PVC delete hands the volume to its
   * provisioner. Idempotent; returns false when nothing existed. */
  destroySession(sessionId: string): Promise<boolean>;
  /**
   * How far deleting the workspaces destroyed under the id has come — what
   * an erasure or a retirement waits for, since a destroy answers once the
   * workspace is out of use. With `waitMs`, what is left is attempted now (a
   * failed removal again) and waited for that long. Required: every backend
   * states its own contract (Docker reads its trash; Kubernetes answers
   * `handed_off`), because an answer without one reads as unconfirmed.
   */
  workspaceDeletion(
    sessionId: string,
    waitMs?: number,
  ): Promise<WorkspaceDeletion>;
  /**
   * Stop the container/Pod (+ Secret on K8s) to release compute, but PRESERVE
   * the workspace (host dir / PVC) so a later createSession with the same
   * sessionId re-attaches it. This is the idle/TTL-reaper outcome — never
   * deletes data. Idempotent; returns false when nothing existed. THROWS on a
   * transient backend hiccup (never returns false on a blip — same contract as
   * destroySession), so the reaper leaves a flaky session for the next sweep.
   * Pressure reclamation supplies expectedCreatedAtMs: removal is fenced to
   * that incarnation's immutable identity and confirms compute is gone before
   * returning. A mismatch throws without touching the replacement.
   */
  stopSession(
    sessionId: string,
    expectedCreatedAtMs?: number,
    options?: StopSessionOptions,
  ): Promise<boolean>;
  /** Recover an abandoned startup only when its durable age and current
   * backend state prove no peer is still starting it. Fenced to the original
   * incarnation and observed state; preserves the workspace. False means
   * still starting/unknown, never permission to release its capacity. */
  reapStaleSession?(
    sessionId: string,
    expectedCreatedAtMs: number,
  ): Promise<boolean>;
  /** Hear that a create found the runtime image missing on this host (an
   * `image prune` on an idle Docker host removes it once no session uses
   * it): the spawner pulls it again and holds creates until it is back. */
  onRuntimeImageMissing?(listener: (detail: string) => void): void;
  /**
   * The address a session booting now would pin its transparent egress to,
   * read once per sweep and compared with what each session recorded: the
   * egress proxy is recreated by every stack restart and deploy, and Docker
   * may hand it another address, while a running session keeps relaying to
   * the old one and has no egress left. Null when no move can be followed (a
   * literal proxy address). THROWS when it cannot be read. Absent on
   * Kubernetes: sessions reach the proxy through its Service's cluster IP,
   * which stays the same while the proxy's Pods are replaced.
   */
  egressAddress?(): Promise<string | null>;
  /** List session objects (label-selected), for boot + periodic re-adoption
   * and the route layer's registry-miss re-resolve. THROWS when the backend
   * cannot list (daemon/API hiccup) — never returns `[]` for "couldn't tell":
   * callers read an empty list as "no sessions" and would leave every running
   * session unregistered until the next successful list. */
  listSessions(organizationId?: string): Promise<BackendSession[]>;
  /**
   * Record the "always-on" pin on the backend object's DURABLE state (Docker:
   * a marker beside the workspace under the host session root; Kubernetes: a
   * Pod annotation) so `listSessions` reports it back on boot re-adoption.
   * The registry's own `pinned` flag is a cache that dies with the process;
   * without this a spawner restart forgets every pin and the next sweep reaps
   * the user's always-on session. A new create always starts unpinned (the
   * platform row is the truth and re-pushes); stop/destroy clear the record.
   * THROWS when the backend cannot record it. The caller keeps the previous
   * published value for reconciliation and protects the pending incarnation.
   * An expected creation stamp fences writes away from a same-name replacement.
   */
  setPinned(
    sessionId: string,
    pinned: boolean,
    expectedCreatedAtMs?: number,
  ): Promise<void>;
  /**
   * Reconcile the shared cross-session build cache (the per-org buildkitd) at
   * spawner startup, after running sessions are re-adopted. The daemon is
   * launched once and outlives the spawner (`--restart unless-stopped`), so a
   * stack restart that recreated sandbox-egress on a new IP leaves the daemon's
   * egress fence stale while it keeps running — and an adopted session that
   * reuses it would build with no DNS/egress. `createSession` only heals freshly
   * created sessions; this closes the gap for adopted ones (ensureBuildkitd
   * recreates a drifted daemon). Best-effort — the cache is an optimization, so
   * a failure is never fatal. A no-op on backends without a shared build cache
   * (Kubernetes) or when the cache is disabled.
   */
  reconcileBuildCache(
    orgIds: readonly string[],
    upkeep?: BuildCacheUpkeep,
  ): Promise<void>;
  /**
   * Does this backend hold a workspace for the session — a running container
   * or a stopped one's preserved data? The device hub asks before placing a
   * session on a device: a session that already lives here stays here.
   * Absent on backends the hub never runs beside (Kubernetes).
   */
  hasWorkspace?(sessionId: string): Promise<boolean>;
  /**
   * Every workspace this backend holds — stopped sessions' preserved data
   * included, which `listSessions` never shows. The platform destroys only
   * a workspace this list NAMES and its records disown, so leaving one out
   * is safe; a wrong `active` is not. THROWS when the workspaces or the
   * containers/Pods beside them cannot be listed at all.
   */
  listWorkspaces(): Promise<BackendWorkspace[]>;
  /**
   * The `limit` largest workspaces this backend holds, measured now, for the
   * log of a session disk below its critical tier. Bounded in time: what was
   * measured by the deadline is answered, with how much that was. THROWS
   * when the workspaces cannot be listed. Absent where the spawner does not
   * hold the workspaces' disk (Kubernetes).
   */
  largestWorkspaces?(limit: number): Promise<LargestWorkspaces>;
  /**
   * The organizations holding resources beyond their sessions' workspaces
   * (Docker: the organization's build helpers, their network and cache
   * volumes, and its package caches). THROWS when it cannot be read.
   */
  listOrganizationResources(): Promise<string[]>;
  /**
   * Remove an organization's resources beyond its sessions' workspaces —
   * called for an organization that no longer exists, once its sessions are
   * destroyed. Idempotent: a second call finds nothing and reports zeros.
   * THROWS when a resource could not be removed, so the caller retries.
   */
  teardownOrganization(
    organizationId: string,
  ): Promise<OrganizationTeardownResult>;
}

export type { SpawnerConfig };
