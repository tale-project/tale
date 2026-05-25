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
  // to inject didn't actually make it onto `/workspace/output/`. The
  // spawner never emits this code itself — it's an action-side gate — but
  // the literal lives here so the parity guard on the Convex side stays
  // satisfied.
  'PRE_STAGE_FAILED',
  // Output-pipeline completeness gate: the action treats any non-empty
  // `uploadStats.failures` as fatal so a partially-harvested workspace
  // doesn't get reported as `success:true`. Same as PRE_STAGE_FAILED:
  // this is an action-side decision, not a spawner-emitted code.
  'UPLOAD_INCOMPLETE',
] as const;

export type SandboxErrorCode = (typeof sandboxErrorCodeLiterals)[number];

export const sandboxPhaseEventLiterals = [
  'preparing',
  'installing',
  'running',
  'completed',
] as const;

export type SandboxPhaseEvent = (typeof sandboxPhaseEventLiterals)[number];

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

export const sandboxLanguageLiterals = [
  'python',
  'node',
  'bash',
  'polyglot',
] as const;
export type SandboxLanguage = (typeof sandboxLanguageLiterals)[number];

// Stable id alphabet for executionId (Convex doc id + base32-ish dev ids).
// Used by both the server route regex and the spawn-time argv assertions.
// Centralized so widening one side doesn't drift from the other (commit
// e9211127d widened spawn.ts + docker-args.ts but missed the cancel route).
export const ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const ORG_ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Per-segment allowlist for sandbox-staged file paths. Mirrors the strict
 * ASCII allowlist enforced by the platform's `validatePath` (see
 * `services/platform/convex/agent_tools/artifacts/shared.ts`). The platform
 * runs the full 16-rule NFC + traversal + BiDi pipeline; this spawner-side
 * regex is defense-in-depth — even if the platform side regresses, the
 * spawner refuses to stage anything outside the safe alphabet.
 */
export const FILE_PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Per-file caps for sandbox-staged `files[]`. Each entry carries a URL
 * the spawner fetches; no content travels through the request body, so
 * the aggregate-byte cap from the inline-content era is gone — per-file
 * fetch size is bounded inside `spawn.ts` instead (WORKSPACE_FETCH_MAX_BYTES).
 */
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_FILE_PATH_LENGTH = 200;

/**
 * Maximum number of `steps[]` per multi-step `/v1/execute` request. Each
 * step launches one subprocess inside the same container so the cap
 * doubles as a guard against pathological `steps.length === 1000`
 * payloads. The spawner-generated wrapper script's size scales with this.
 */
export const MAX_STEPS_PER_REQUEST = 10;

/**
 * Polyglot file-extension dispatch. The spawner's multi-step wrapper
 * looks at each step path's extension and runs the matching interpreter
 * — `.py` → python3, `.js`/`.cjs`/`.mjs` → node, `.sh` → bash. All three
 * runtimes live in the runtime image (Dockerfile layers Node 24 onto
 * python:3.12-slim and apt-installs bash), so polyglot mode is purely a
 * wrapper / install dispatch change, not an image change. Mirrored on
 * the platform side by `inferStepLanguage()` in agent_tools/files/_shared.ts.
 */
export const POLYGLOT_PYTHON_EXT_RE = /\.py$/i;
export const POLYGLOT_NODE_EXT_RE = /\.(?:c?js|mjs)$/i;
export const POLYGLOT_BASH_EXT_RE = /\.sh$/i;

/**
 * Per-step outcome reported back inside `ExecuteResponse.steps[]` when
 * the request used multi-step mode. `path` mirrors the requested step
 * path; `status` is `'completed'` (exit 0), `'failed'` (exit ≠ 0), or
 * `'skipped'` (a prior step failed and fail-fast aborted the rest).
 */
export const sandboxStepStatusLiterals = [
  'completed',
  'failed',
  'skipped',
] as const;

export type SandboxStepStatus = (typeof sandboxStepStatusLiterals)[number];

export interface SandboxStepResult {
  path: string;
  status: SandboxStepStatus;
  exitCode: number | null;
  durationMs: number;
}
