// Wire-protocol enums + literals shared between server.ts, spawn.ts, and
// the response builder. Mirrors `services/platform/convex/sandbox/wire.ts`
// on the Convex side — the spawner cannot import from Convex (different
// runtime, different package), so this is a parallel file. Both ends must
// stay in sync; the platform side carries a compile-time `satisfies`
// assertion (see `convex/node_only/sandbox/helpers/spawner_client.ts`)
// that asserts these literals are a subset of the Convex `sandboxRunStatusLiterals`
// / `sandboxErrorCodeLiterals` / `sandboxPhaseEventLiterals` arrays, so a
// drift on either side fails the CI typecheck.

// `sandboxRunStatusLiterals` lives only on the Convex side
// (`services/platform/convex/sandbox/wire.ts`) — the spawner never emits a
// run-status string, only phase events + a final result with one of three
// terminal `status` values (`completed | failed | cancelled`). Kept off
// this file deliberately so unused-export sweeps stay clean.

export const sandboxErrorCodeLiterals = [
  'TIMEOUT',
  'OOM',
  'EGRESS_DENIED',
  'INSTALL_FAILED',
  'PACKAGE_NOT_FOUND',
  'QUOTA_EXCEEDED',
  'RUNTIME_ERROR',
  'SPAWNER_UNAVAILABLE',
  'CANCELLED',
  'INPUT_REJECTED',
  // Output-pipeline error codes (sandbox-wobbly-origami plan §5). Split out
  // of the legacy catch-all so the LLM-side recovery hint can be specific:
  // a HARVEST_READ_FAILED means "check stderr / file write didn't happen",
  // an UPLOAD_FAILED means "transient, one retry is fine", an
  // UPLOAD_QUOTA_EXCEEDED means "consolidate or split into multi-step", and
  // an UPLOAD_REPORT_FAILED means "the storageId was uploaded but the
  // report-back mutation failed — audit row may need manual reconciliation".
  'HARVEST_READ_FAILED',
  'UPLOAD_FAILED',
  'UPLOAD_QUOTA_EXCEEDED',
  'UPLOAD_REPORT_FAILED',
  // Pre-stage attestation failure raised by the platform when
  // `ExecuteResponse.priorStage.skipped` shows files the platform expected
  // to inject didn't actually make it onto `/agent/output/`. The
  // spawner never emits this code itself — it's an action-side gate — but
  // the literal lives here so the parity guard on the Convex side stays
  // satisfied.
  'PRE_STAGE_FAILED',
  // Output-pipeline completeness gate: the action treats any non-empty
  // `uploadStats.failures` as fatal so a partially-harvested workspace
  // doesn't get reported as `success:true`. Same as PRE_STAGE_FAILED:
  // this is an action-side decision, not a spawner-emitted code.
  'UPLOAD_INCOMPLETE',
  // Session-exec error codes (sessions plan, milestone A). SESSION_LOST is
  // emitted when the session container/Pod died (or its runnerd stopped
  // answering) while an exec was in flight or being addressed — the
  // workspace may survive (Docker host dir / K8s emptyDir with
  // restartPolicy Always), so the caller distinguishes "retry against the
  // same session" from "session is gone, create a new one" via
  // GET /v1/sessions/:id state. INVALID_CWD rejects an exec whose cwd
  // fails the runnerd realpath-under-/agent check (no silent mkdir).
  'SESSION_LOST',
  'INVALID_CWD',
] as const;

export type SandboxErrorCode = (typeof sandboxErrorCodeLiterals)[number];

/**
 * SSE event types emitted by `POST /v1/execute`. The spawner emits:
 *  - `phase` — zero or more transitions (preparing → installing → running)
 *  - `stdout` / `stderr` — incremental output deltas while the container
 *    is alive (added so the canvas can tail output instead of waiting for
 *    the terminal `result` event with the whole base64'd buffer).
 *  - `result` — exactly one terminal event with the canonical
 *    ExecuteResponse shape.
 *  - `error` — zero or one SSE-side transport error (e.g. spawn aborted
 *    before a result was produced).
 *
 * The convex side has a compile-time parity guard
 * (services/platform/convex/sandbox/wire.ts) that fails CI typecheck if
 * either side drifts.
 */
export const sandboxSseEventLiterals = [
  'phase',
  'stdout',
  'stderr',
  'result',
  'error',
] as const;

// Stable id alphabet for executionId (Convex doc id + base32-ish dev ids).
// Used by both the server route regex and the spawn-time argv assertions.
// Centralized so widening one side doesn't drift from the other (commit
// e9211127d widened spawn.ts + docker-args.ts but missed the cancel route).
export const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const ORG_ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// ---------------------------------------------------------------------------
// Persistent sessions (sessions plan, milestone A). The `/v1/sessions` API is
// a sibling of the one-shot `/v1/execute` path; literals live here so the
// Convex-side mirror (`convex/sandbox/wire.ts`) can keep its compile-time
// parity guard over a single import surface.
// ---------------------------------------------------------------------------

/**
 * Session lifecycle states surfaced by GET /v1/sessions[/:id].
 *  - `creating`   — container/Pod launched, runnerd /healthz not yet green.
 *  - `ready`      — runnerd answering; execs accepted.
 *  - `degraded`   — backend object exists but runnerd is unreachable or the
 *                   container exited (workspace intact). v1 remedy is
 *                   destroy-and-recreate; an in-place restart endpoint is a
 *                   named v1.1 follow-up.
 *  - `terminating`— DELETE accepted, teardown in progress.
 *  - `terminated` — destroyed by request.
 *  - `expired`    — reaped by the TTL/idle sweep.
 */
export const sandboxSessionStateLiterals = [
  'creating',
  'ready',
  'degraded',
  'terminating',
  'terminated',
  'expired',
] as const;

export type SandboxSessionState = (typeof sandboxSessionStateLiterals)[number];

/**
 * Resource profile selecting the session container's caps + user. `default`
 * mirrors the one-shot limits (uid 65534); `agent` is the coding-agent shape
 * (uid 10001, 2 cpu / 4 GiB / 512 pids / no cpu-time ulimit / 512m shm —
 * see session/docker-session-args.ts).
 */
export const sandboxSessionProfileLiterals = ['default', 'agent'] as const;

export type SandboxSessionProfile =
  (typeof sandboxSessionProfileLiterals)[number];

/** Terminal payload of a session exec (the SSE `result` event). */
export interface SessionExecResponse {
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  /**
   * Execution wall-clock, forwarded VERBATIM from runnerd's terminal `exit`
   * line: measured inside the session container from immediately before
   * `spawn()` to the child's exit with all stdio drained. It excludes every
   * out-of-process phase — container/Pod scheduling, image pull, session
   * startup, endpoint resolution, input staging, output harvest — and is
   * therefore identical on the docker and kubernetes backends (the same
   * daemon measures on both). Exactly 0 when there is no measurement to
   * forward: a pre-spawn `fail` (the process never ran) or a lost terminal
   * line (`SESSION_LOST`) — 0 means "not measured", never "ran for 0ms".
   */
  durationMs: number;
  stdoutBase64: string;
  stderrBase64: string;
  truncated: { stdout: boolean; stderr: boolean };
  errorCode?: SandboxErrorCode;
  errorMessage?: string;
}

/** Wire shape of one session in GET/POST /v1/sessions responses. */
export interface SessionInfo {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  state: SandboxSessionState;
  backend: 'docker' | 'kubernetes';
  createdAtMs: number;
  /** Last exec/file/env activity as reported by runnerd's activity clock. */
  lastActivityAtMs: number;
  expiresAtMs: number;
  idleTimeoutMs: number;
}

/** execId shares the sessionId alphabet; unique within its session. */
export const EXEC_ID_RE = ID_ALPHABET_RE;
