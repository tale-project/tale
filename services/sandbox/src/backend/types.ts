// Backend abstraction — the spawner's host lifecycle + persistent sessions.
//
// Every sandbox run is a session now. The `ExecutionBackend` (docker | k8s) no
// longer executes code — it owns the spawner's host-level lifecycle (boot init,
// image warm, /health, shutdown) + the legacy one-shot orphan sweep. The
// `SessionBackend` owns the long-lived session container/Pod lifecycle. Both are
// chosen once at boot from `SANDBOX_BACKEND` (see backend/index.ts).

import type { SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile, SandboxSessionState } from '../wire.ts';

export type HealthResult =
  | { ok: true; detail: string }
  | { ok: false; error: string };

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
export interface ExecutionBackend {
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
  /** Best-effort warm of the runtime image (no-op where the platform pulls). */
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
// Persistent sessions (sessions plan, milestone A). A SessionBackend manages
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
  /** Clamped by the route layer to cfg.session.maxLifetimeMs / maxIdleMs. */
  ttlMs: number;
  idleTimeoutMs: number;
  /** Initial session env (deny-list validated route-side; runnerd
   * re-enforces). Reaches the daemon's env store, NOT the container's
   * process env — docker inspect must never show user values. */
  env: Record<string, string>;
  createdAtMs: number;
}

/** A backend's record of one live session, reconstructed from backend-object
 * labels/annotations on boot re-adoption (the registry is a cache, not the
 * source of truth). */
export interface BackendSession {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
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
   * restarts. Throws if the backend object doesn't exist. */
  resolveEndpoint(sessionId: string): Promise<string>;
  /**
   * DEFINITIVE liveness check of the backend object: true only when the
   * container/Pod exists AND is running. Returns false on a confirmed
   * "object gone/dead" answer (docker "No such object", K8s 404, exited
   * container) — the zombie-registry-eviction signal. THROWS when the
   * backend can't answer (daemon/API hiccup): callers MUST treat a throw as
   * "unknown", never as "gone" — a transient backend blip must not get a
   * live session destroyed.
   */
  sessionExists(sessionId: string): Promise<boolean>;
  /** Tear down container/Pod (+ Secret on K8s) and DELETE the workspace
   * (host dir / PVC). The ONLY data-deleting verb — reached only via the
   * explicit Destroy path. Idempotent; returns false when nothing existed. */
  destroySession(sessionId: string): Promise<boolean>;
  /**
   * Stop the container/Pod (+ Secret on K8s) to release compute, but PRESERVE
   * the workspace (host dir / PVC) so a later createSession with the same
   * sessionId re-attaches it. This is the idle/TTL-reaper outcome — never
   * deletes data. Idempotent; returns false when nothing existed. THROWS on a
   * transient backend hiccup (never returns false on a blip — same contract as
   * destroySession), so the reaper leaves a flaky session for the next sweep.
   */
  stopSession(sessionId: string): Promise<boolean>;
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
   * THROWS when the backend cannot record it — the caller keeps the in-memory
   * pin and warns, so the current process still honours it.
   */
  setPinned(sessionId: string, pinned: boolean): Promise<void>;
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
  reconcileBuildCache(orgIds: readonly string[]): Promise<void>;
}

export type { SpawnerConfig };
