import { v } from 'convex/values';

// Type-only import of the spawner's harvest output-file shape so the
// compile-time parity guard at the bottom of this file catches any drift
// between the bytes the spawner emits and the shape Convex consumes.
import type { OutputFile as SpawnerOutputFile } from '../../../sandbox/src/types';
// Type-only imports from the spawner's wire module — purely structural,
// nothing of this lands in the convex runtime bundle. We use these in the
// compile-time parity assertions at the bottom of the file so a literal
// drift on EITHER side fails CI typecheck. Audit finding R2-B3 caught
// that the docstring claimed this guard existed when it didn't.
import type {
  sandboxErrorCodeLiterals as SpawnerErrorCodes,
  sandboxSessionProfileLiterals as SpawnerSessionProfiles,
  sandboxSseEventLiterals as SpawnerSseEvents,
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
  // from "downloading torch". The audit-row lifecycle is
  // queued → installing → terminal — `running` is never persisted there;
  // see the comment on `setRunning` in `internal_mutations.ts`. The literal
  // below is retained for read-validation of legacy rows and for the
  // artifact-side `runStatus` field (which DOES use `running` to drive the
  // canvas spinner). Watchdog reaps queued, installing, and running.
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
  // 'running' retained for legacy audit rows pre-refactor and for the
  // artifact `runStatus` field; new audit-row writes emit 'installing' only.
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
  // Output-pipeline error codes (sandbox-wobbly-origami plan §5). Split out
  // of the legacy catch-all `HARVEST_FAILED` so the LLM-side recovery hint
  // can be specific. See artifact_run_tool.ts for the per-code recovery
  // table; the spawner-side mirror is in services/sandbox/src/wire.ts.
  'HARVEST_READ_FAILED',
  'UPLOAD_FAILED',
  'UPLOAD_QUOTA_EXCEEDED',
  'UPLOAD_REPORT_FAILED',
  // Pre-stage attestation failure: the spawner reported `priorStage.skipped`
  // entries for files the platform expected to inject into
  // `/agent/output/` before user code ran. Abort BEFORE the container
  // starts so the LLM cannot run against a corrupted workspace. The
  // `errorMessage` payload carries a JSON `{skipped: [{name, reason}], ...}`
  // breakdown so the LLM can decide whether to retry with
  // `inputs.from_run: <runId>` or surface the issue.
  'PRE_STAGE_FAILED',
  // Output-pipeline completeness gate: `uploadStats.failures` came back
  // non-empty (either an upload POST or the EP2 record-uploaded callback
  // dropped). The bytes that made it to `_storage` are cleaned via the
  // existing `uploadedStorageIds[]` rollback; the run is failed so the
  // LLM doesn't trust a partial workspace state. Distinct from the
  // per-failure codes above because this is the action-side decision
  // that "any failure → fatal", not a single transport-layer cause.
  'UPLOAD_INCOMPLETE',
  // Session-exec error codes (sessions plan, milestone A). SESSION_LOST: the
  // session container/Pod (or its runnerd) died mid-exec — the workspace may
  // survive, so the caller checks GET /v1/sessions/:id to decide retry vs
  // recreate. INVALID_CWD: an exec cwd failed runnerd's realpath-under-
  // /agent check. Spawner-side mirror in services/sandbox/src/wire.ts.
  'SESSION_LOST',
  'INVALID_CWD',
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
  v.literal('HARVEST_READ_FAILED'),
  v.literal('UPLOAD_FAILED'),
  v.literal('UPLOAD_QUOTA_EXCEEDED'),
  v.literal('UPLOAD_REPORT_FAILED'),
  v.literal('PRE_STAGE_FAILED'),
  v.literal('UPLOAD_INCOMPLETE'),
  v.literal('SESSION_LOST'),
  v.literal('INVALID_CWD'),
);

/**
 * SSE event-type vocabulary emitted by the spawner's `POST /v1/execute`.
 * Mirror of `services/sandbox/src/wire.ts:sandboxSseEventLiterals`. The
 * compile-time `Equal<>` parity check below catches drift in either
 * direction. Adding a new event type requires updating both wire files
 * AND the `spawner_client.ts` SSE-parser switch (the parser is the actual
 * consumer; this constant is the documentation contract).
 */
export const sandboxSseEventLiterals = [
  'phase',
  'stdout',
  'stderr',
  'result',
  'error',
] as const;

export type SandboxSseEvent = (typeof sandboxSseEventLiterals)[number];

/**
 * Session resource-profile validator (persistent sessions). Mirror of
 * `services/sandbox/src/wire.ts:sandboxSessionProfileLiterals`. `default`
 * mirrors the one-shot caps (uid 65534); `agent` is the external-agent shape
 * (uid 10001, larger caps). Used by the `sandboxSessions` table + the
 * platform-side session client.
 */
export const sandboxSessionProfileValidator = v.union(
  v.literal('default'),
  v.literal('agent'),
);

export type SandboxSessionProfile = 'default' | 'agent';

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
  // Optional so historical rows (and the audit-row projection that doesn't
  // need it) continue to validate. New harvests always populate sha256 —
  // it's set by the spawner during `harvestOutputDir` and used for the
  // cumulative manifest (artifactOutputs) + pre-stage attestation.
  sha256: v.optional(v.string()),
});

export interface SandboxOutputFile {
  name: string;
  size: number;
  contentType: string;
  fileMetadataId: string;
  storageId?: string;
  sha256?: string;
}

/**
 * Spawner-emitted harvest output-file shape. Always populated by the
 * spawner's `harvestOutputDir`; `storageId` and `sha256` are required here
 * because the spawner has just uploaded the bytes and computed the hash.
 * Convex transforms this into {@link SandboxOutputFile} when persisting to
 * the audit row (allocates `fileMetadataId`; `storageId` / `sha256` flow
 * through verbatim).
 *
 * The compile-time parity guard at the bottom of this file ensures this
 * stays byte-identical to `services/sandbox/src/types.ts:OutputFile`. If
 * spawner adds or removes a field on its `OutputFile`, the typecheck fails
 * here, forcing a coordinated update before merge.
 */
export interface HarvestOutputFile {
  name: string;
  storageId: string;
  size: number;
  contentType: string;
  sha256: string;
}

export const sandboxTruncatedValidator = v.object({
  stdout: v.boolean(),
  stderr: v.boolean(),
  files: v.number(),
});

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
const _sseEventParity: Equal<
  (typeof sandboxSseEventLiterals)[number],
  (typeof SpawnerSseEvents)[number]
> = true;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _sessionProfileParity: Equal<
  SandboxSessionProfile,
  (typeof SpawnerSessionProfiles)[number]
> = true;

// Harvest output-file shape parity. Both sides declare:
//   { name, storageId, size, contentType, sha256 }
// — all required, all primitive strings/numbers. If the spawner side adds
// or removes a field on its `OutputFile`, the Equal<> below fails here
// with a clear diagnostic, forcing a coordinated update before merge.
// (The audit-row validator `sandboxOutputFileValidator` keeps storageId/
// sha256 optional indefinitely so legacy rows pass — see plan §A.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _harvestOutputFileParity: Equal<HarvestOutputFile, SpawnerOutputFile> =
  true;
