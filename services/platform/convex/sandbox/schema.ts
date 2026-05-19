import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

/**
 * Audit row for one `code_run` tool call.
 *
 * Lifecycle:
 *   queued    — inserted atomically inside reserveSlotAndInsert (concurrent
 *               cap + daily CPU budget both checked in the same mutation).
 *   running   — flipped after the spawner HTTP call begins; heartbeatAt
 *               refreshed every 60s by the Convex action so the watchdog
 *               can distinguish "Convex hard-killed the action" from
 *               "still working".
 *   completed — exitCode === 0 and the file harvest succeeded.
 *   failed    — any non-success outcome; `errorCode` carries the cause.
 *   cancelled — client aborted via /v1/cancel or LLM-side abort signal.
 *
 * Status is intentionally thin (5 values); every "why" lives in errorCode
 * so audit queries don't have to special-case ad-hoc kill modes.
 *
 * Indexes:
 *   by_organizationId_and_status      — quota counting (reserveSlot scan)
 *   by_organizationId                 — daily CPU-budget sum + general
 *                                       per-org history
 *   by_org_user                       — GDPR right-to-be-forgotten cascade
 *   by_status                         — watchdog sweep across all orgs
 *   by_threadId                       — chat-pane history (future UI)
 */
export const sandboxExecutionsTable = defineTable({
  organizationId: v.string(),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
  uploadedBy: v.string(),
  agentSlug: v.optional(v.string()),

  language: v.union(v.literal('python'), v.literal('node')),
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

  status: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('completed'),
    v.literal('failed'),
    v.literal('cancelled'),
  ),
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

  outputFiles: v.array(
    v.object({
      name: v.string(),
      fileMetadataId: v.id('fileMetadata'),
      size: v.number(),
      contentType: v.string(),
    }),
  ),
  // Spawner reports per-call caps were hit; the tool result mirrors these
  // so the LLM can react ("re-run with smaller scope").
  truncated: v.optional(
    v.object({
      stdout: v.boolean(),
      stderr: v.boolean(),
      files: v.number(),
    }),
  ),

  startedAt: v.number(),
  completedAt: v.optional(v.number()),

  errorCode: v.optional(
    v.union(
      v.literal('TIMEOUT'),
      v.literal('OOM'),
      v.literal('EGRESS_DENIED'),
      v.literal('INSTALL_FAILED'),
      v.literal('PACKAGE_NOT_FOUND'),
      v.literal('QUOTA_EXCEEDED'),
      v.literal('RUNTIME_ERROR'),
      v.literal('SPAWNER_UNAVAILABLE'),
      v.literal('CANCELLED'),
    ),
  ),
  errorMessage: v.optional(v.string()),

  lifecycleStatus: v.optional(lifecycleStatusValidator),
})
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId', ['organizationId'])
  .index('by_org_user', ['organizationId', 'uploadedBy'])
  .index('by_status', ['status'])
  .index('by_threadId', ['threadId']);

export const SANDBOX_MAX_CONCURRENT_PER_ORG = 4;
export const SANDBOX_DAILY_CPU_BUDGET_SECONDS = 1800;
export const SANDBOX_MAX_TIMEOUT_MS = 300_000;
export const SANDBOX_DEFAULT_TIMEOUT_MS = 30_000;
export const SANDBOX_WATCHDOG_CUTOFF_MS = 2 * SANDBOX_MAX_TIMEOUT_MS;

export const SANDBOX_CODE_PREVIEW_MAX = 8 * 1024;
export const SANDBOX_STDOUT_PREVIEW_MAX = 16 * 1024;
export const SANDBOX_STDERR_PREVIEW_MAX = 16 * 1024;
