import { v } from 'convex/values';

// Type-only imports from the spawner's wire module — purely structural,
// nothing of this lands in the convex runtime bundle. We use these in the
// compile-time parity assertions at the bottom of the file so a literal
// drift on EITHER side fails CI typecheck. Audit finding R2-B3 caught
// that the docstring claimed this guard existed when it didn't.
import type {
  sandboxErrorCodeLiterals as SpawnerErrorCodes,
  sandboxLanguageLiterals as SpawnerLanguages,
  sandboxPhaseEventLiterals as SpawnerPhases,
  sandboxStepStatusLiterals as SpawnerStepStatuses,
} from '../../../sandbox/src/wire';

/**
 * Single source of truth for the sandbox runtime's wire protocol on the
 * Convex side. Both the audit row (`sandboxExecutions`) and the artifact
 * runnable run-state (`artifacts.run*` fields) build their validators from
 * the literal arrays exported here — adding or removing a code never
 * requires touching multiple schema files. The spawner-side mirror lives
 * at `services/sandbox/src/wire.ts`; the bidirectional `extends` checks
 * at the bottom of this file keep them from drifting.
 *
 * Pattern mirrors `services/platform/convex/tts/error_codes.ts`.
 */

export const sandboxRunStatusLiterals = [
  'queued',
  // Set while pip / npm install is fetching deps. The audit row stays in
  // `queued` until the spawner reports a phase event; the artifact row
  // mirrors `installing` so the canvas can distinguish "waiting for slot"
  // from "downloading torch". A live execution moves queued → installing →
  // running → terminal in that order; the watchdog reaps both queued and
  // running stragglers.
  'installing',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type SandboxRunStatus = (typeof sandboxRunStatusLiterals)[number];

export const sandboxRunStatusValidator = v.union(
  v.literal('queued'),
  v.literal('installing'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('cancelled'),
);

export const sandboxTerminalStatuses: ReadonlySet<SandboxRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

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
  // The action validated the input but rejected it (file missing,
  // not in the requested thread, IDOR check failed). Distinct from
  // SPAWNER_UNAVAILABLE so the agent's recovery hint is "fix the args",
  // not "retry the transient infra".
  'INPUT_REJECTED',
] as const;

export type SandboxErrorCode = (typeof sandboxErrorCodeLiterals)[number];

export const sandboxErrorCodeValidator = v.union(
  v.literal('TIMEOUT'),
  v.literal('OOM'),
  v.literal('EGRESS_DENIED'),
  v.literal('INSTALL_FAILED'),
  v.literal('PACKAGE_NOT_FOUND'),
  v.literal('QUOTA_EXCEEDED'),
  v.literal('RUNTIME_ERROR'),
  v.literal('SPAWNER_UNAVAILABLE'),
  v.literal('CANCELLED'),
  v.literal('INPUT_REJECTED'),
);

/**
 * Wire-level phase events emitted by the spawner SSE stream. The Convex
 * action translates these into `runStatus` and `runPhase` patches on the
 * artifact row. `preparing` corresponds to docker-pull / workspace setup;
 * `installing` to dependency install; `running` to user-code execution;
 * `completed` to terminal (success or failure — the result body carries
 * the outcome).
 */
export const sandboxPhaseEventLiterals = [
  'preparing',
  'installing',
  'running',
  'completed',
] as const;

export type SandboxPhaseEvent = (typeof sandboxPhaseEventLiterals)[number];

/**
 * Structured progress payload persisted on the artifact row alongside the
 * phase. Replaces the legacy `runProgress` string field — keys come from
 * a stable enum and locale-specific text is composed in the UI via the
 * `chat.runnable.progress.*` message keys, so the server never writes
 * English literals that the UI cannot translate.
 */
export const sandboxRunProgressLiterals = [
  'queued',
  'preparing',
  'installingPackage',
  'installing',
  'running',
] as const;

export type SandboxRunProgressKind =
  (typeof sandboxRunProgressLiterals)[number];

export const sandboxRunProgressValidator = v.object({
  kind: v.union(
    v.literal('queued'),
    v.literal('preparing'),
    v.literal('installingPackage'),
    v.literal('installing'),
    v.literal('running'),
  ),
  // Populated only for `installingPackage` — `{ package: 'python-pptx',
  // version: '1.0.2' }`. Empty / omitted for the other kinds.
  package: v.optional(v.string()),
  version: v.optional(v.string()),
});

/**
 * Output-file shape used by both `sandboxExecutions.outputFiles` (audit
 * row, no denormalized storageId) and `artifacts.runOutputFiles` (canvas
 * fast-path, denormalized storageId). `storageId` is optional so the same
 * validator covers both call sites; callers that need it must check.
 */
export const sandboxOutputFileValidator = v.object({
  name: v.string(),
  size: v.number(),
  contentType: v.string(),
  fileMetadataId: v.id('fileMetadata'),
  storageId: v.optional(v.id('_storage')),
});

export interface SandboxOutputFile {
  name: string;
  size: number;
  contentType: string;
  fileMetadataId: string;
  storageId?: string;
}

export const sandboxTruncatedValidator = v.object({
  stdout: v.boolean(),
  stderr: v.boolean(),
  files: v.number(),
});

export const sandboxLanguageLiterals = ['python', 'node'] as const;
export type SandboxLanguage = (typeof sandboxLanguageLiterals)[number];

export const sandboxLanguageValidator = v.union(
  v.literal('python'),
  v.literal('node'),
);

/**
 * Per-step outcome populated only for multi-step runs (where
 * `artifact_run` was invoked with `steps: [{path}]`). One row per
 * requested step, in the requested order. `status` is:
 *   `completed` — exit 0
 *   `failed`    — exit ≠ 0; the wrapper aborts subsequent steps
 *   `skipped`   — a prior step failed or the wrapper never reached this one
 *
 * `exitCode` is `null` for `skipped` (no process was started).
 */
export const sandboxStepStatusLiterals = [
  'completed',
  'failed',
  'skipped',
] as const;

export type SandboxStepStatus = (typeof sandboxStepStatusLiterals)[number];

export const sandboxStepStatusValidator = v.union(
  v.literal('completed'),
  v.literal('failed'),
  v.literal('skipped'),
);

export const sandboxStepResultValidator = v.object({
  path: v.string(),
  status: sandboxStepStatusValidator,
  exitCode: v.union(v.number(), v.null()),
  durationMs: v.number(),
});

export type SandboxStepResult = {
  path: string;
  status: SandboxStepStatus;
  exitCode: number | null;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Spawner ↔ Convex literal parity (audit finding R2-B3)
// ---------------------------------------------------------------------------
// Compile-time double-extension checks: each literal-set on this side
// must be both a superset AND a subset of the spawner-side set (i.e.
// equal). Adding a literal on only one side fails CI typecheck with a
// clear error pointing at the assigning line, before the divergence
// ever ships. Purely type-level — no runtime cost.
//
// `Equal<ConvexSide, SpawnerSide>` returns `true` iff the two unions
// match. If the spawner has an extra literal, ConvexSide ⊊ SpawnerSide
// breaks the second clause. If Convex has an extra, the first clause
// breaks. The error object is a fake type whose key surfaces a
// readable diagnostic next to the failing literal-array name.
type Equal<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : {
        __wireDrift: 'Spawner has literal(s) missing from Convex side — add them here too';
      }
  : {
      __wireDrift: 'Convex has literal(s) missing from spawner side — add them in services/sandbox/src/wire.ts';
    };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _errorCodeParity: Equal<
  (typeof sandboxErrorCodeLiterals)[number],
  (typeof SpawnerErrorCodes)[number]
> = true;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _phaseEventParity: Equal<
  (typeof sandboxPhaseEventLiterals)[number],
  (typeof SpawnerPhases)[number]
> = true;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _languageParity: Equal<
  (typeof sandboxLanguageLiterals)[number],
  (typeof SpawnerLanguages)[number]
> = true;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _stepStatusParity: Equal<
  (typeof sandboxStepStatusLiterals)[number],
  (typeof SpawnerStepStatuses)[number]
> = true;
