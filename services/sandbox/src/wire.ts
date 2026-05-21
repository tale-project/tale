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
] as const;

export type SandboxErrorCode = (typeof sandboxErrorCodeLiterals)[number];

export const sandboxPhaseEventLiterals = [
  'preparing',
  'installing',
  'running',
  'completed',
] as const;

export type SandboxPhaseEvent = (typeof sandboxPhaseEventLiterals)[number];

export const sandboxLanguageLiterals = ['python', 'node'] as const;
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
 * Per-file caps for sandbox-staged `files[]`. Aggregate cap is enforced
 * separately from the existing `code` cap because each file's content is
 * accounted for independently.
 */
export const MAX_FILES_PER_REQUEST = 50;
export const MAX_FILE_PATH_LENGTH = 200;
export const MAX_FILES_BYTES = 800_000;

/**
 * Maximum number of `steps[]` per multi-step `/v1/execute` request. Each
 * step launches one subprocess inside the same container so the cap
 * doubles as a guard against pathological `steps.length === 1000`
 * payloads. The spawner-generated wrapper script's size scales with this.
 */
export const MAX_STEPS_PER_REQUEST = 10;

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
