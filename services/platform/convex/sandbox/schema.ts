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
 *                phase the spawner emits an SSE event for.
 *   running    — flipped after the spawner HTTP call begins; heartbeatAt
 *                refreshed every 60s by the Convex action so the watchdog
 *                can distinguish "Convex hard-killed the action" from
 *                "still working".
 *   completed  — exitCode === 0 and the file harvest succeeded.
 *   failed     — any non-success outcome; `errorCode` carries the cause.
 *   cancelled  — client aborted via /v1/cancel or LLM-side abort signal.
 *
 * The watchdog (see `internal_mutations.ts:recoverStuckSandboxes`) sweeps
 * BOTH `queued` and `running` rows past `SANDBOX_WATCHDOG_CUTOFF_MS` so a
 * throw between `reserveSlotAndInsert` and `setRunning` cannot leak a
 * quota slot forever.
 *
 * Indexes:
 *   by_organizationId_and_status — quota counting (reserveSlot scan)
 *   by_organizationId            — daily CPU-budget sum + per-org history
 *   by_status                    — watchdog sweep across all orgs
 *
 * This is an audit table; user-facing soft-delete / trash UI is intentionally
 * NOT wired up for v1 (audit retention is handled by the watchdog cron's
 * TTL pass, not a user-deletable lifecycle).
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
export const SANDBOX_WATCHDOG_CUTOFF_MS = 2 * SANDBOX_MAX_TIMEOUT_MS;

export const SANDBOX_CODE_PREVIEW_MAX = 8 * 1024;
export const SANDBOX_STDOUT_PREVIEW_MAX = 16 * 1024;
export const SANDBOX_STDERR_PREVIEW_MAX = 16 * 1024;
