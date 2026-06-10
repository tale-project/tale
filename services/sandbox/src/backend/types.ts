// Execution-backend abstraction.
//
// The spawner's HTTP/SSE/auth layer and the per-request orchestration in
// spawn.ts (staging, phase parsing, output harvest, response assembly) are
// backend-agnostic. Everything that is specific to HOW a runtime is launched
// — `docker run` against the host daemon today, a Kubernetes Pod tomorrow —
// lives behind `ExecutionBackend`. The backend is chosen once at boot from
// `SANDBOX_BACKEND` (see backend/index.ts) and threaded through
// `executeRequest`, the health probe, the orphan sweep, and the lifecycle
// hooks.
//
// Design note — the workspace seam: today the spawner stages inputs onto a
// host directory that is bind-mounted 1:1 into the runtime container and
// harvests outputs back from that same directory with node:fs. We keep that
// shape — `stageWorkspace`/`harvestOutputDir`/`readStepResults` still operate
// on a LOCAL directory (`Workspace.localRoot`) exactly as before — and make
// the backend responsible for getting those bytes to/from the real runtime.
// For DockerBackend that is a no-op (the dir is bind-mounted, so the daemon
// sees it directly). A future KubernetesBackend stages the same local dir
// into the Pod (and harvests it back) around the run via the exec API, so the
// host-path coupling never leaks past this interface.

import type { Language, SpawnerConfig } from '../types.ts';

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

  /** Create the per-execution staging workspace. */
  createWorkspace(executionId: string): Promise<Workspace>;
  /** Idempotently ensure the per-org dependency caches exist. */
  ensureCacheStore(organizationId: string): Promise<CacheStores>;
  /** Launch the runtime against the already-staged workspace. */
  launch(spec: LaunchSpec, cache: CacheStores): Promise<RunningExecution>;
  /** Best-effort cancel of an in-flight execution, addressed by id. */
  cancel(executionId: string): Promise<void>;

  /** Reap orphaned runtimes/dirs left by crashes or stale runs. */
  sweepOrphans(opts: SweepOptions): Promise<number>;
}

export type { SpawnerConfig };
