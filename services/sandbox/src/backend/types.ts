// Execution-backend abstraction.
//
// The spawner's HTTP/SSE/auth layer and the in-flight registry in spawn.ts are
// backend-agnostic; the per-request orchestration lives behind
// `ExecutionBackend.execute`. Everything specific to HOW a runtime is launched
// — `docker run` against the host daemon, or a Kubernetes Pod — lives behind
// the backend. It is chosen once at boot from `SANDBOX_BACKEND` (see
// backend/index.ts) and threaded through the dispatcher, the health probe, the
// orphan sweep, and the lifecycle hooks.
//
// Design note — the execution seam: `execute()` is coarse on purpose. The
// DockerBackend stages inputs onto a host directory bind-mounted 1:1 into the
// runtime container and harvests outputs back with node:fs (the
// `LocalWorkspaceRuntime` flow in backend/local-workspace-run.ts). The
// KubernetesBackend instead moves staging/harvest INTO the Pod (helper
// containers do presigned-URL I/O) and only performs HTTP control-plane ops.
// Those two shapes don't share a workspace abstraction, so the seam is the
// whole `execute()` call rather than the Phase-1 fine-grained
// createWorkspace/launch/harvest steps (which are now DockerBackend-internal).

import type {
  ExecuteRequest,
  ExecuteResponse,
  Language,
  SpawnerConfig,
} from '../types.ts';
import type {
  SandboxPhaseEvent,
  SandboxSessionProfile,
  SandboxSessionState,
} from '../wire.ts';

/**
 * Per-execution staging + harvest directory on the SPAWNER's local
 * filesystem. The orchestrator writes inputs under `localRoot` and reads
 * outputs back from it with node:fs. How those bytes reach (and return from)
 * the actual runtime container/Pod is the backend's concern.
 */
export interface Workspace {
  /** Absolute path on the spawner fs to stage into / harvest from. */
  readonly localRoot: string;
  /**
   * Called once after `stageWorkspace` has written all inputs, before launch.
   * DockerBackend chowns the tree to the runtime uid (the container reads the
   * bind-mount as `nobody`); a non-shared-fs backend is a no-op (it re-owns
   * when it transports the tree into the runtime).
   */
  finalizeStaging(): Promise<void>;
  /** Remove the staging directory (and any backend-local scratch). */
  destroy(): Promise<void>;
}

/** Opaque per-org dependency-cache handles the backend mounts at run time. */
export interface CacheStores {
  pip: string;
  npm: string;
}

/** What `launch()` needs — the request-shape fields plus the staged workspace. */
export interface LaunchSpec {
  executionId: string;
  organizationId: string;
  // bash is rejected upstream in executeRequest; the runtime only ever
  // launches one of these three.
  language: Extract<Language, 'python' | 'node' | 'polyglot'>;
  /** Inner (user) wall-clock cap in ms; the backend arms its own kill at this. */
  timeoutMs: number;
  startedAtMs: number;
  /** Absolute path the runtime entrypoint will exec (see docker-args.ts). */
  entryPath: string;
  /**
   * Sanitized step-scoped env (reserved names already dropped by
   * validate-request). Merged into the runtime process env WITHOUT
   * overriding the infrastructure baseline (proxy / cache / HOME).
   */
  userEnv?: Record<string, string>;
  workspace: Workspace;
}

/**
 * Mirror of `RunDockerResult` (spawn-util.ts) so the spawn.ts consumer is
 * backend-independent: a backend produces the runtime's canonical
 * stdout/stderr + exit code, with the same truncation flags.
 */
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface RunOptions {
  /**
   * Outer wall-clock ceiling in ms (== inner timeout + 30_000 today). The
   * backstop that kills the launch mechanism itself if it wedges; the inner
   * SIGKILL at the user timeout is armed by the running execution.
   */
  outerTimeoutMs: number;
  signal: AbortSignal;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
  /** Per-chunk stdout callback (drives the phase-marker parser + live tail). */
  onStdoutChunk?: (chunk: Uint8Array) => void;
  /** Per-chunk stderr callback (drives the live stderr tail). */
  onStderrChunk?: (chunk: Uint8Array) => void;
}

/** A launched runtime the orchestrator streams from, waits on, and tears down. */
export interface RunningExecution {
  /**
   * Stream stdout/stderr (via the RunOptions callbacks), enforce the in-band
   * byte caps + the inner SIGKILL timeout, and resolve once the runtime has
   * exited. By the time this resolves, the runtime's outputs are present
   * under `workspace.localRoot/output` (a non-shared-fs backend pulls them
   * back before resolving).
   */
  wait(opts: RunOptions): Promise<RunResult>;
  /** Remove the container/Pod (the orchestrator's finally block). */
  remove(): Promise<void>;
}

export type HealthResult =
  | { ok: true; detail: string }
  | { ok: false; error: string };

/**
 * Live-progress callbacks the SSE layer wires in. The orchestrator fires
 * `onPhase` on PHASE markers and `onStdoutDelta`/`onStderrDelta` for the live
 * tail; the canonical buffers still ride the final `ExecuteResponse`.
 */
export interface ExecuteCallbacks {
  onPhase?: (event: { phase: SandboxPhaseEvent }) => void;
  onStdoutDelta?: (text: string) => void;
  /**
   * Best-effort and backend-dependent: the docker backend streams stderr live;
   * the exec-free K8s backend never fires this (the runner's stderr goes to a
   * file so its log stream stays clean stdout) — stderr arrives only in the
   * final response. UI must not assume a live stderr tail exists.
   */
  onStderrDelta?: (text: string) => void;
}

/** Everything `execute()` needs beyond the request: the cancel signal, the
 * shared wall-clock start (also the in-flight registry's `startedAt`), and the
 * live-progress callbacks. */
export interface ExecuteOptions extends ExecuteCallbacks {
  /**
   * Aborted by `cancelExecution`; ends the runtime stream so `execute()`
   * unwinds to its cleanup and returns a `cancelled` response.
   */
  signal: AbortSignal;
  /** Wall-clock start shared with the in-flight registry; drives durationMs + timing. */
  startedAtMs: number;
}

/**
 * The fine-grained local-workspace contract the DockerBackend exposes for the
 * shared `runLocalWorkspaceExecution` orchestration (backend/local-workspace-
 * run.ts): stage onto a local dir, run against it, harvest it back. This is no
 * longer part of `ExecutionBackend` — the KubernetesBackend doesn't have a
 * local workspace, so it implements `execute()` directly instead.
 */
export interface LocalWorkspaceRuntime {
  /** Create the per-execution staging workspace. */
  createWorkspace(executionId: string): Promise<Workspace>;
  /** Idempotently ensure the per-org dependency caches exist. */
  ensureCacheStore(organizationId: string): Promise<CacheStores>;
  /** Launch the runtime against the already-staged workspace. */
  launch(spec: LaunchSpec, cache: CacheStores): Promise<RunningExecution>;
}

export interface SweepOptions {
  /** Reap runtimes whose start time is older than this epoch-ms threshold. */
  staleBeforeMs: number;
  /** True while an execution id is still tracked in the in-flight registry. */
  isLive: (executionId: string) => boolean;
}

/**
 * Pluggable runtime executor. One implementation per deployment target
 * (DockerBackend = Compose; KubernetesBackend = Helm, added in Phase 2).
 */
export interface ExecutionBackend {
  readonly kind: 'docker' | 'kubernetes';

  /**
   * One-shot boot setup. DockerBackend acquires the host-session lock and
   * runs the boot orphan sweep; throwing here is fatal (server exits). A
   * future KubernetesBackend verifies API/RBAC reachability.
   */
  init(): Promise<void>;
  /** Graceful-shutdown hook (DockerBackend releases the host-session lock). */
  shutdown(): Promise<void>;

  /** Liveness probe backing GET /health. */
  health(): Promise<HealthResult>;
  /** Best-effort warm of the runtime image (no-op where the platform pulls). */
  warmImage(): Promise<void>;

  /**
   * Run one execution end-to-end: stage inputs, launch the runtime, stream
   * live progress (via `opts` callbacks), harvest outputs, and return the
   * canonical `ExecuteResponse`. Owns all runtime-specific staging/cleanup;
   * the dispatcher in spawn.ts only wraps this with the in-flight registry +
   * request validation. Never throws for an execution-level failure — it
   * returns a `failed`/`cancelled` response instead.
   *
   * NORMATIVE OUTCOME TABLE — every terminal response is built through the
   * shared constructors in exec-response.ts; exec-response.test.ts asserts
   * these invariants (the cross-backend contract test):
   *
   * | outcome                  | status    | errorCode             | exitCode            |
   * |--------------------------|-----------|-----------------------|---------------------|
   * | success                  | completed | —                     | 0                   |
   * | success, harvest hiccup  | failed    | UPLOAD_* / HARVEST_*  | 0                   |
   * | user code non-zero exit  | failed    | classifyFailure(...)  | real exit code      |
   * | user timeout             | failed    | TIMEOUT               | backend-real (137 docker / 124 k8s) |
   * | machinery wedged         | failed    | TIMEOUT               | 124                 |
   * | harvest result lost      | failed    | HARVEST_READ_FAILED   | real if recoverable, else null |
   * | runner container killed  | failed    | OOM / RUNTIME_ERROR   | 137 / container exit |
   * | staging failure          | failed    | SPAWNER_UNAVAILABLE   | null                |
   * | infra failure            | failed    | SPAWNER_UNAVAILABLE   | null                |
   * | caller cancel            | cancelled | CANCELLED             | null                |
   *
   * Conventions: `errorCode` is the canonical signal; `exitCode` is
   * informational and backend-real (never rewritten across backends).
   * `PRE_STAGE_FAILED` is action-side-only — the spawner never emits it.
   * Cancelled-payload richness is best-effort per backend: docker uploads
   * partial outputs/steps on cancel; the exec-free K8s backend structurally
   * cannot (the pod is deleted before harvest completes).
   */
  execute(
    cfg: SpawnerConfig,
    req: ExecuteRequest,
    opts: ExecuteOptions,
  ): Promise<ExecuteResponse>;
  /**
   * REMOTE cancel: best-effort kill of a runtime addressed by id, designed to
   * work from any replica (k8s deletes by deterministic name). The LOCALLY
   * owned path is abort-only — spawn.ts aborts the in-flight signal and
   * `execute()` performs its own cleanup after its final reads. Returns true
   * when a runtime was actually found and killed.
   */
  cancel(executionId: string): Promise<boolean>;

  /** Reap orphaned runtimes/dirs left by crashes or stale runs. */
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
}

export interface SessionBackend {
  readonly kind: 'docker' | 'kubernetes';
  /**
   * Launch the session container/Pod and wait until runnerd's /healthz
   * answers (budget: cfg.session.createHealthTimeoutMs). On failure the
   * backend cleans up whatever it created before throwing — a failed create
   * never leaks a container. Returns once the session is `ready`.
   */
  createSession(spec: SessionSpec): Promise<void>;
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
  /** List live session objects (label-selected), for boot re-adoption, the
   * GET /v1/sessions route, and the TTL/idle sweep. */
  listSessions(organizationId?: string): Promise<BackendSession[]>;
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
