import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  sandboxOutputFileValidator,
  sandboxRunStatusValidator,
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
  // Back-link to the runnable artifact this execution belongs to. Optional
  // because not every sandbox execution is artifact-bound (future free-form
  // sandbox callers would leave this unset). Watchdog uses this to cascade
  // failure to the artifact row when it reaps a stuck execution — otherwise
  // the canvas spinner stays spinning until the audit row is GC'd.
  artifactId: v.optional(v.id('artifacts')),

  language: sandboxLanguageValidator,
  purpose: v.optional(v.string()),

  // Preview kept inline so the chat-pane card can render without an extra
  // round-trip; full code persists in `_storage` when over ~8 KB.
  codePreview: v.string(),
  codeStorageId: v.optional(v.id('_storage')),
  packages: v.array(v.string()),
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

  startedAt: v.number(),
  completedAt: v.optional(v.number()),

  errorCode: v.optional(sandboxErrorCodeValidator),
  errorMessage: v.optional(v.string()),
})
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId', ['organizationId'])
  .index('by_status', ['status'])
  .index('by_artifactId', ['artifactId']);

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
