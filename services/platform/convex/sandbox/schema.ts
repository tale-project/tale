import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  sandboxOutputFileValidator,
  sandboxRunStatusValidator,
  sandboxStepResultValidator,
  sandboxTruncatedValidator,
} from './wire';

/**
 * Audit row for one `artifact_run` invocation (one tool call → one row,
 * append-only).
 *
 * Lifecycle (validator union = `sandboxRunStatusValidator`):
 *   queued     — inserted atomically inside reserveSlotAndInsert (concurrent
 *                cap + daily CPU budget both checked in the same mutation).
 *   installing — pip / npm install is fetching dependencies; this is a real
 *                phase the spawner emits an SSE event for. The audit row
 *                stays in `installing` for the entire spawner round-trip;
 *                the artifact row mirrors a finer `installing → running`
 *                progression for the canvas UI, but the audit row only
 *                tracks the coarse `installing → terminal` transition.
 *   completed  — exitCode === 0 and the file harvest succeeded.
 *   failed     — any non-success outcome; `errorCode` carries the cause.
 *   cancelled  — client aborted via /v1/cancel or LLM-side abort signal.
 *
 * The schema validator still accepts `running` as a historical literal so
 * legacy rows from earlier deploys read cleanly; new writes never use it.
 *
 * The watchdog (see `internal_mutations.ts:recoverStuckSandboxes`) sweeps
 * `queued`, `installing`, AND any legacy `running` rows past
 * `SANDBOX_WATCHDOG_CUTOFF_MS` so a throw between `reserveSlotAndInsert`
 * and any subsequent patch cannot leak a quota slot forever. When the
 * watchdog reaps a row that's bound to a runnable artifact (artifactId
 * non-null), it cascades the failure to the artifact row so the canvas
 * spinner terminates immediately.
 *
 * Indexes:
 *   by_organizationId_and_status — quota counting (reserveSlot scan)
 *   by_organizationId            — daily CPU-budget sum + per-org history
 *                                  + opportunistic 90-day GC sweep
 *   by_status                    — watchdog sweep across all orgs
 *   by_artifactId                — watchdog cascade lookup
 *
 * This is an audit table; user-facing soft-delete / trash UI is intentionally
 * NOT wired up. Retention is 90 days; cleanup runs opportunistically
 * inside `reserveSlotAndInsert` via the `cleanup:sandbox` rate limiter
 * (1/hour/org), not via a `crons.ts` entry.
 */
export const sandboxExecutionsTable = defineTable({
  organizationId: v.string(),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
  uploadedBy: v.string(),
  agentSlug: v.optional(v.string()),
  // @deprecated — artifacts module removed. Field kept (typed loosely) so
  // existing rows pass the read validator after schema deploy.
  artifactId: v.optional(v.string()),
  // For artifact-bound runs: which file path the LLM asked the sandbox to
  // execute (`main.js`, `verify.py`, …). Lets the canvas render the
  // latest-run-per-file panel so a verify run no longer clobbers the
  // generator's output chip. Optional for back-compat with rows written
  // before the column existed.
  path: v.optional(v.string()),
  // For `skill_run` invocations: the skill slug (mutually exclusive with
  // artifactId — a row is either artifact-bound or skill-bound). Lets
  // forensics enumerate "all runs of skill X" without substring-grepping
  // `purpose`. Populated by `skill_run_tool.ts`.
  skillSlug: v.optional(v.string()),
  // sha256 of SKILL.md at execution time. Detects whether the skill was
  // edited between bind-time snapshot and runtime — important for
  // reproducing failures after an SKILL.md update.
  skillVersionHash: v.optional(v.string()),

  language: sandboxLanguageValidator,
  purpose: v.optional(v.string()),

  // Preview kept inline so the chat-pane card can render without an extra
  // round-trip; full code persists in `_storage` when over ~8 KB.
  codePreview: v.string(),
  codeStorageId: v.optional(v.id('_storage')),
  packages: v.array(v.string()),
  // @deprecated — install-time guards (--only-binary, --ignore-scripts) were
  // dropped; the ephemeral container is the security boundary and install-time
  // flags added nothing on top. Field retained as optional for read-validation
  // on legacy rows; new writes never set it.
  installOptions: v.optional(
    v.object({
      allowSdist: v.optional(v.boolean()),
      allowInstallScripts: v.optional(v.boolean()),
    }),
  ),

  status: sandboxRunStatusValidator,
  // Every status patch must update this. Watchdog reads
  // `now - heartbeatAt` (not statusChangedAt) so a long-running but
  // healthy job isn't reaped.
  statusChangedAt: v.number(),
  heartbeatAt: v.number(),

  // For daily CPU-second budget enforcement we pre-debit with this
  // estimate at reservation time; finalize replaces it with actualSeconds.
  estimatedSeconds: v.number(),
  actualSeconds: v.optional(v.number()),

  exitCode: v.optional(v.number()),
  durationMs: v.optional(v.number()),

  stdoutPreview: v.optional(v.string()), // ≤16 KB
  stderrPreview: v.optional(v.string()),
  stdoutStorageId: v.optional(v.id('_storage')),
  stderrStorageId: v.optional(v.id('_storage')),

  outputFiles: v.array(sandboxOutputFileValidator),
  // Spawner reports per-call caps were hit; the tool result mirrors these
  // so the LLM can react ("re-run with smaller scope").
  truncated: v.optional(sandboxTruncatedValidator),

  // Populated only for multi-step runs (`artifact_run({steps:[...]})`),
  // one entry per requested step in submission order. Single-step runs
  // leave this undefined — the existing `path` / `exitCode` columns
  // already carry the outcome. Optional per the
  // [feedback_deprecate_dont_delete_schema_fields] rule so existing rows
  // read cleanly through the validator after schema deploy.
  steps: v.optional(v.array(sandboxStepResultValidator)),

  // -----------------------------------------------------------------
  // Presigned-URL upload telemetry (sandbox-wobbly-origami plan §5).
  // All optional + sparse — old audit rows read cleanly through the
  // validator. New writes from the rewritten `internal_actions.ts`
  // populate these fields.
  // -----------------------------------------------------------------
  /**
   * Pre-allocated upload-slot URLs handed to the spawner at request time.
   * Plain strings (URLs already contain the 1h Convex upload token), kept
   * for forensic grep when investigating partial-upload failures.
   */
  outputUploadSlots: v.optional(v.array(v.string())),
  /**
   * Server-side per-run quota counter for incremental URL allocation.
   * Initialized to `MAX_OUTPUT_FILES_PER_RUN - <pre-alloc N>`; decremented
   * by `applyConsumeUrlQuota`. Reaches 0 → EP1 returns 412 and the spawner
   * stops trying to harvest more files.
   */
  outputUrlQuotaRemaining: v.optional(v.number()),
  /**
   * Storage ids reported back by the spawner via EP2 after a successful
   * upload. Used as the rollback set in `failExecution` — anything in this
   * list gets `ctx.storage.delete()` if the run fails. Watchdog also reads
   * this on stuck-row reap.
   */
  uploadedStorageIds: v.optional(v.array(v.id('_storage'))),
  /**
   * Spawner-side upload outcomes (per-file). Populated by the harvest
   * pipeline; surfaced through the audit row so a partial-upload run is
   * forensically debuggable without trawling SSE event logs.
   */
  uploadStats: v.optional(
    v.object({
      attempted: v.number(),
      succeeded: v.number(),
      failures: v.array(
        v.object({
          slotIndex: v.number(),
          fileName: v.string(),
          httpStatus: v.number(),
          errorSnippet: v.string(),
        }),
      ),
    }),
  ),
  /**
   * Per-phase timing breakdown (ms) — `stageMs` covers prior-output
   * download + file write; `executeMs` the inner docker run; `harvestMs`
   * the post-run directory walk; `uploadMs` the bytes-out pipeline. Used
   * to track TTL pressure against the 1h `generateUploadUrl` window.
   */
  timing: v.optional(
    v.object({
      stageMs: v.number(),
      executeMs: v.number(),
      harvestMs: v.number(),
      uploadMs: v.number(),
    }),
  ),

  startedAt: v.number(),
  completedAt: v.optional(v.number()),

  errorCode: v.optional(sandboxErrorCodeValidator),
  errorMessage: v.optional(v.string()),
})
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId', ['organizationId'])
  .index('by_status', ['status'])
  .index('by_artifactId', ['artifactId'])
  // For skill_run forensics: "all runs of skill X" without substring grep.
  .index('by_organizationId_and_skillSlug', ['organizationId', 'skillSlug'])
  // For the user-Stop cascade in `cancel_generation.ts` — locates every
  // non-terminal execution on the cancelled thread so the action can call
  // `spawnerCancel` on each before the SDK abort would leave them running
  // until their own SANDBOX_MAX_TIMEOUT_MS. `threadId` is already on the
  // row; this just lets the query be O(k) instead of org-wide scan.
  .index('by_threadId', ['threadId']);

export const SANDBOX_MAX_CONCURRENT_PER_ORG = 4;
export const SANDBOX_DAILY_CPU_BUDGET_SECONDS = 1800;
export const SANDBOX_MAX_TIMEOUT_MS = 300_000;
export const SANDBOX_DEFAULT_TIMEOUT_MS = 30_000;
// Watchdog cutoff = execution wall-clock max + 10 minute tail for storage
// uploads and finalize mutations. The previous `2 × max_timeout` formula
// only covered execution time; multi-MB output blob uploads after the
// spawner returned could push heartbeats past the cutoff and trigger a
// false-positive watchdog reap (audit finding R2-B6 #3).
export const SANDBOX_WATCHDOG_CUTOFF_MS = SANDBOX_MAX_TIMEOUT_MS + 600_000;

export const SANDBOX_CODE_PREVIEW_MAX = 8 * 1024;
export const SANDBOX_STDOUT_PREVIEW_MAX = 16 * 1024;
export const SANDBOX_STDERR_PREVIEW_MAX = 16 * 1024;

/**
 * Maximum number of output files a single sandbox execution can publish to
 * `_storage` via the presigned-upload pipeline. Combined cap across the
 * pre-allocated slots AND any lazy EP1 requests. Migrated from
 * `services/sandbox/src/config.ts` to keep the policy single-source on the
 * Convex side (the spawner is stateless w.r.t. quotas — see plan §3).
 */
export const SANDBOX_MAX_OUTPUT_FILES_PER_RUN = 16;
/**
 * Number of upload slots pre-allocated at request dispatch time. Set so
 * the median run (1 file) and p90 run (2 files) avoid the EP1 round-trip
 * entirely; only the long-tail "many small outputs" path pays the lazy
 * cost. See plan decision table § "Upload slot count".
 */
export const SANDBOX_OUTPUT_UPLOAD_SLOTS_PREALLOC = 2;
