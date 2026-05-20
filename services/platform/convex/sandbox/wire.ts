import { v } from 'convex/values';

/**
 * Single source of truth for the sandbox runtime's wire protocol on the
 * Convex side. Both the audit row (`sandboxExecutions`) and the artifact
 * runnable run-state (`artifacts.run*` fields) build their validators from
 * the literal arrays exported here — adding or removing a code never
 * requires touching multiple schema files. The spawner-side mirror lives
 * at `services/sandbox/src/wire.ts`; the satisfies-assertion below this
 * comment keeps them from drifting.
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

export const sandboxPhaseEventValidator = v.union(
  v.literal('preparing'),
  v.literal('installing'),
  v.literal('running'),
  v.literal('completed'),
);

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
