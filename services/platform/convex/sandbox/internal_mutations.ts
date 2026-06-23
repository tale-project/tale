import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../_generated/server';
import { rateLimiter } from '../lib/rate_limiter';
import { readSandboxQuotaPolicy } from './quota_policy';
import {
  SANDBOX_DAILY_CPU_BUDGET_SECONDS,
  SANDBOX_WATCHDOG_CUTOFF_MS,
} from './schema';
import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  sandboxOutputFileValidator,
  sandboxStepResultValidator,
  sandboxTerminalStatuses,
  sandboxTruncatedValidator,
} from './wire';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const AUDIT_RETENTION_MS = 90 * ONE_DAY_MS;
const AUDIT_GC_PER_SWEEP = 100;

/**
 * Opportunistic per-org GC for sandboxExecutions audit rows. Rate-limited
 * to at most once per hour per org so a busy org doesn't pay the scan
 * cost on every insert. Caps the per-sweep delete count to keep the
 * mutation runtime bounded — leftover rows are reclaimed by the next
 * sweep an hour later.
 */
async function maybeRunSandboxAuditCleanup(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  // Best-effort gate. If the rate limiter component is unreachable (e.g.
  // the unit-test ctx mock that doesn't ship `runMutation`), skip the
  // sweep rather than crash the parent reservation — cleanup is
  // opportunistic and a missed window costs nothing.
  let result: { ok: boolean };
  try {
    result = await rateLimiter.limit(ctx, 'cleanup:sandbox', {
      key: organizationId,
      throws: false,
    });
  } catch (err) {
    console.warn('[sandbox.cleanup] rate-limiter gate failed:', err);
    return;
  }
  if (!result.ok) return;
  const cutoff = Date.now() - AUDIT_RETENTION_MS;
  let deleted = 0;
  for await (const row of ctx.db
    .query('sandboxExecutions')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .order('asc')) {
    if (row._creationTime >= cutoff) break;
    if (!sandboxTerminalStatuses.has(row.status)) continue;
    // Cascade-delete the storage blobs owned by this audit row before
    // dropping it. Without this, every GC cycle orphaned three `_storage`
    // rows per audit row (code/stdout/stderr) and never released the
    // bytes — audit finding R2-B7 #2.
    //
    // outputFiles[*].storageId is intentionally NOT deleted here: that
    // ownership lives on the sibling `fileMetadata` rows; their own
    // lifecycle (referenced by chat messages) governs blob lifetime.
    await deleteSandboxRowStorage(ctx, row);
    await ctx.db.delete(row._id);
    deleted += 1;
    if (deleted >= AUDIT_GC_PER_SWEEP) break;
  }
}

/**
 * Best-effort `_storage` cleanup for an audit row about to be deleted (90-day
 * retention sweep) or reaped (watchdog). Each delete is independently
 * try/catch'd so a single missing blob doesn't abort the parent mutation.
 *
 * Output-file blobs are deliberately excluded — their ownership lives on
 * `fileMetadata` rows whose own lifecycle handles cleanup.
 */
async function deleteSandboxRowStorage(
  ctx: MutationCtx,
  row: {
    codeStorageId?: Id<'_storage'>;
    stdoutStorageId?: Id<'_storage'>;
    stderrStorageId?: Id<'_storage'>;
  },
): Promise<void> {
  for (const id of [
    row.codeStorageId,
    row.stdoutStorageId,
    row.stderrStorageId,
  ]) {
    if (id === undefined) continue;
    try {
      await ctx.storage.delete(id);
    } catch (err) {
      console.warn(`[sandbox.cleanup] storage.delete ${id} failed:`, err);
    }
  }
}

/**
 * Sweep the orphan blobs reported via EP2 (`applyRecordUploaded`) when the
 * watchdog reaps a stuck row, OR when `failExecution` rolls back a failed
 * run. Mirrors the existing `uploadedStorageIds` rollback in the action's
 * fail path — see plan §3.
 */
async function deleteReportedUploadedBlobs(
  ctx: MutationCtx,
  uploaded: ReadonlyArray<Id<'_storage'>> | undefined,
): Promise<void> {
  if (!uploaded || uploaded.length === 0) return;
  for (const id of uploaded) {
    try {
      await ctx.storage.delete(id);
    } catch (err) {
      console.warn(
        `[sandbox.cleanup] uploadedStorageIds delete ${id} failed:`,
        err,
      );
    }
  }
}

/**
 * Atomic concurrency-cap + daily-CPU-budget reservation.
 *
 * Convex mutations are serializable with OCC: the by_organizationId_and_status
 * index range read here is recorded in the read set, so two parallel
 * reservations that both see "3/4 in flight" cannot both insert — one
 * retries. This closes the TOCTOU race R1.8/R1.10 flagged.
 *
 * Daily CPU budget = sum(actualSeconds of completed-today) + sum(estimatedSeconds
 * of currently-running) + this call's estimate. Pre-debit so 4 concurrent
 * 300s calls cannot collectively overshoot (post-debit would allow a 20-min
 * burst per wave).
 */
export const reserveSlotAndInsert = internalMutation({
  args: {
    organizationId: v.string(),
    uploadedBy: v.string(),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    /** Which file in the project was executed. */
    path: v.optional(v.string()),
    /** For skill_run invocations: the skill slug. */
    skillSlug: v.optional(v.string()),
    /** SHA-256 of SKILL.md at execution time, for skill_run forensics. */
    skillVersionHash: v.optional(v.string()),
    language: sandboxLanguageValidator,
    purpose: v.optional(v.string()),
    codePreview: v.string(),
    codeStorageId: v.optional(v.id('_storage')),
    packages: v.array(v.string()),
    estimatedSeconds: v.number(),
  },
  returns: v.id('sandboxExecutions'),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Per-org one-shot concurrency cap from the `sandbox_quota` governance
    // policy (missing row → schema default). The deployment-wide host cap is
    // the spawner's `SANDBOX_MAX_CONCURRENT` env; this is the per-tenant slice.
    const { maxConcurrentPerOrg } = await readSandboxQuotaPolicy(
      ctx.db,
      args.organizationId,
    );

    // Concurrent cap. Short-circuit at the cap; never materialise the full set.
    // Both `queued` and `running` rows count: the cap is "in-flight", not
    // "actively executing". This must agree with the watchdog (below) which
    // also sweeps both states — otherwise a leaked queued row would shrink
    // the effective cap until the next watchdog run.
    let inFlight = 0;
    let runningSecondsProjected = 0;
    for (const status of ['running', 'queued', 'installing'] as const) {
      for await (const row of ctx.db
        .query('sandboxExecutions')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )) {
        inFlight += 1;
        runningSecondsProjected += row.estimatedSeconds;
        if (inFlight >= maxConcurrentPerOrg) {
          throw new ConvexError({
            code: 'QUOTA_EXCEEDED',
            message: `At most ${maxConcurrentPerOrg} sandboxes can run concurrently for this organization.`,
          });
        }
      }
    }

    // Daily CPU-second budget. Today = last 24h sliding window keyed by
    // `_creationTime`. Reusing `by_organizationId` index (per `videoLinkJobs`
    // convention) keeps the scan bounded for typical orgs (≤dozens/day).
    const dayCutoff = now - ONE_DAY_MS;
    let completedToday = 0;
    for await (const row of ctx.db
      .query('sandboxExecutions')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      if (row._creationTime < dayCutoff) break;
      // Cancelled rows count too: the spawner still spent CPU bringing the
      // container up before the cancel landed, and treating cancels as
      // "free" would let an abusive caller burst spawn/abort the same
      // execution to bypass the budget. If we ever want to refund early
      // cancels (e.g. cancelled in the queued state with no work done),
      // do it explicitly on the cancel path, not implicitly here.
      if (
        row.status === 'completed' ||
        row.status === 'failed' ||
        row.status === 'cancelled'
      ) {
        completedToday += row.actualSeconds ?? row.estimatedSeconds;
      }
    }
    if (
      completedToday + runningSecondsProjected + args.estimatedSeconds >
      SANDBOX_DAILY_CPU_BUDGET_SECONDS
    ) {
      throw new ConvexError({
        code: 'QUOTA_EXCEEDED',
        message: `Daily CPU-second budget exceeded (${SANDBOX_DAILY_CPU_BUDGET_SECONDS}s/org). Try again tomorrow or split the work.`,
      });
    }

    const executionId = await ctx.db.insert('sandboxExecutions', {
      organizationId: args.organizationId,
      uploadedBy: args.uploadedBy,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      ...(args.messageId !== undefined && { messageId: args.messageId }),
      ...(args.toolCallId !== undefined && { toolCallId: args.toolCallId }),
      ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
      ...(args.path !== undefined && { path: args.path }),
      ...(args.skillSlug !== undefined && { skillSlug: args.skillSlug }),
      ...(args.skillVersionHash !== undefined && {
        skillVersionHash: args.skillVersionHash,
      }),
      language: args.language,
      ...(args.purpose !== undefined && { purpose: args.purpose }),
      codePreview: args.codePreview,
      ...(args.codeStorageId !== undefined && {
        codeStorageId: args.codeStorageId,
      }),
      packages: args.packages,
      status: 'queued',
      statusChangedAt: now,
      heartbeatAt: now,
      estimatedSeconds: args.estimatedSeconds,
      outputFiles: [],
      startedAt: now,
    });
    // Opportunistic per-org GC of audit rows older than 90 days. Gated by
    // a 1/hour rate limiter so we don't scan on every insert. Done AFTER
    // the insert (vs. before) so a quota-rejected insert doesn't waste
    // the GC window.
    await maybeRunSandboxAuditCleanup(ctx, args.organizationId);
    return executionId;
  },
});

export const setRunning = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    // Only `installing` is flipped here. The spawner emits a separate
    // `running` SSE event later, but we don't patch the audit row for it —
    // the lifecycle is queued → installing → terminal. The literal `running`
    // existed in earlier drafts but no caller emits it; keep the validator
    // tight so a future regression can't silently introduce it.
    status: v.optional(v.literal('installing')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    // Monotonic: queued → installing. Don't roll back; terminal states are
    // also rejected (no resurrection).
    const next = args.status ?? 'installing';
    if (row.status !== 'queued') return null;
    const now = Date.now();
    await ctx.db.patch(args.executionId, {
      status: next,
      statusChangedAt: now,
      heartbeatAt: now,
    });
    return null;
  },
});

export const heartbeat = internalMutation({
  args: { executionId: v.id('sandboxExecutions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    if (row.status !== 'running' && row.status !== 'installing') return null;
    await ctx.db.patch(args.executionId, { heartbeatAt: Date.now() });
    return null;
  },
});

/**
 * Persist the blue-green spawner colour the execution landed on (self-reported
 * by the spawner via X-Sandbox-Color at execute start). Lets the user-Stop /
 * cancel path route to the SAME colour after a deploy flip. No-op for a null
 * colour (single-colour mode) or a vanished row.
 */
export const setSpawnerColor = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    spawnerColor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.spawnerColor === null) return null;
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    await ctx.db.patch(args.executionId, { spawnerColor: args.spawnerColor });
    return null;
  },
});

/**
 * Settles an audit row into a terminal state. Idempotent w.r.t. duplicate
 * Convex retries AND races with the watchdog: if the row is already in a
 * terminal state we leave it alone (no-op + warn). The watchdog reaping a
 * stuck row claims authority; a late-arriving result from the action must
 * not clobber the `SPAWNER_UNAVAILABLE` audit data the watchdog wrote.
 */
export const finalize = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    status: v.union(
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    exitCode: v.optional(v.number()),
    errorCode: v.optional(sandboxErrorCodeValidator),
    errorMessage: v.optional(v.string()),
    stdoutPreview: v.optional(v.string()),
    stderrPreview: v.optional(v.string()),
    stdoutStorageId: v.optional(v.id('_storage')),
    stderrStorageId: v.optional(v.id('_storage')),
    outputFiles: v.array(sandboxOutputFileValidator),
    truncated: v.optional(sandboxTruncatedValidator),
    durationMs: v.number(),
    actualSeconds: v.number(),
    /**
     * Per-step results when the underlying run was multi-step. Single-step
     * runs leave this undefined; the column is sparse and only patched
     * when present.
     */
    steps: v.optional(v.array(sandboxStepResultValidator)),
    /**
     * Presigned-URL upload telemetry from the spawner (sandbox-wobbly-
     * origami plan §5). Optional + sparse — older spawner builds don't
     * emit these fields; new builds populate them with per-file outcome
     * + per-phase timing.
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
    timing: v.optional(
      v.object({
        stageMs: v.number(),
        executeMs: v.number(),
        harvestMs: v.number(),
        uploadMs: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    if (sandboxTerminalStatuses.has(row.status)) {
      // Late-arriving result vs. watchdog reap. Authority belongs to
      // whoever wrote first — preserve their data, drop ours.
      console.warn(
        `[sandbox.finalize] no-op: row ${row._id} already terminal as ${row.status}; dropping incoming ${args.status}`,
      );
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(args.executionId, {
      status: args.status,
      statusChangedAt: now,
      completedAt: now,
      durationMs: args.durationMs,
      actualSeconds: args.actualSeconds,
      ...(args.exitCode !== undefined && { exitCode: args.exitCode }),
      ...(args.errorCode !== undefined && { errorCode: args.errorCode }),
      ...(args.errorMessage !== undefined && {
        errorMessage: args.errorMessage,
      }),
      ...(args.stdoutPreview !== undefined && {
        stdoutPreview: args.stdoutPreview,
      }),
      ...(args.stderrPreview !== undefined && {
        stderrPreview: args.stderrPreview,
      }),
      ...(args.stdoutStorageId !== undefined && {
        stdoutStorageId: args.stdoutStorageId,
      }),
      ...(args.stderrStorageId !== undefined && {
        stderrStorageId: args.stderrStorageId,
      }),
      outputFiles: args.outputFiles,
      ...(args.truncated !== undefined && { truncated: args.truncated }),
      ...(args.steps !== undefined && { steps: args.steps }),
      ...(args.uploadStats !== undefined && { uploadStats: args.uploadStats }),
      ...(args.timing !== undefined && { timing: args.timing }),
    });
    return null;
  },
});

/**
 * Watchdog cron — flips long-stuck rows to failed/SPAWNER_UNAVAILABLE.
 *
 * Convex 30-min hard-kill skips action `try/finally`, so without this the
 * audit row stays in a non-terminal state forever and the slot it holds
 * permanently shrinks the org's concurrent cap. Heartbeat from the action
 * keeps `heartbeatAt` fresh; we declare a row stuck when it's been
 * 2×max_timeout without an update.
 *
 * Sweeps `queued`, `installing`, AND `running` — a throw between
 * `reserveSlotAndInsert` and `setRunning` leaves the row in `queued`
 * indefinitely and would leak a quota slot otherwise.
 */
// Per-status cap on rows reaped in a single mutation. Convex mutations
// have a doc-read/-write budget — an unbounded full-table scan can hit
// it and abort mid-sweep, leaving the trailing rows stuck (audit finding
// R2-B6 #1). Cron re-runs every 5 min so leftover rows get picked up.
const WATCHDOG_REAP_PER_STATUS = 200;

export const recoverStuckSandboxes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SANDBOX_WATCHDOG_CUTOFF_MS;
    let recovered = 0;
    for (const status of ['running', 'installing', 'queued'] as const) {
      const candidates = await ctx.db
        .query('sandboxExecutions')
        .withIndex('by_status', (q) => q.eq('status', status))
        .take(WATCHDOG_REAP_PER_STATUS);
      for (const row of candidates) {
        if (row.heartbeatAt >= cutoff) continue;
        const now = Date.now();
        await ctx.db.patch(row._id, {
          status: 'failed',
          statusChangedAt: now,
          completedAt: now,
          errorCode: 'SPAWNER_UNAVAILABLE',
          errorMessage: `Watchdog reaped a stuck ${status} row`,
          actualSeconds: row.estimatedSeconds,
        });
        // Best-effort storage cleanup so a watchdog reap doesn't leave
        // code/stdout/stderr blobs orphaned for the full 90-day audit
        // retention window (audit finding R2-B7 #2 follow-up).
        await deleteSandboxRowStorage(ctx, row);
        // Sandbox-wobbly-origami: also reclaim any output blobs the
        // spawner reported via EP2 (`applyRecordUploaded`) before
        // crashing. They never made it into a `fileMetadata` row, so
        // their ownership is purely on this audit row's
        // `uploadedStorageIds` set.
        await deleteReportedUploadedBlobs(ctx, row.uploadedStorageIds);
        // Cascade to the artifact row if this execution was bound to one,
        // so the canvas spinner terminates as soon as the watchdog runs
        // (otherwise the runnable card spins until the audit row TTLs out).
        // Artifact cascade removed — artifacts module deleted in the
        // thread-workspace refactor.
        recovered += 1;
      }
    }
    return recovered;
  },
});

/**
 * Locates every non-terminal `sandboxExecutions` row tied to a thread.
 * Used by the user-Stop cascade: when `cancel_generation` fires, the new
 * `cancelExecutionsForThread` action calls this to find what to kill, then
 * issues `spawnerCancel` + `cancelExecutionRecord` for each. Returns a
 * trimmed projection (id only) because the caller doesn't need the full
 * doc — keeps the query cheap.
 */
export const listNonTerminalByThread = internalQuery({
  // `threadId` is stored as `v.string()` on `sandboxExecutions` (the
  // upstream `threads` table is provided by `@convex-dev/agent`, so the
  // platform schema never sees its branded `Id<'threads'>` directly);
  // accept the same `v.string()` here to match.
  args: { threadId: v.string() },
  returns: v.array(
    v.object({
      _id: v.id('sandboxExecutions'),
      // Blue-green colour for cancel-routing (undefined in single-colour mode).
      spawnerColor: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('sandboxExecutions')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .collect();
    const out: Array<{
      _id: Id<'sandboxExecutions'>;
      spawnerColor?: string;
    }> = [];
    for (const row of rows) {
      if (sandboxTerminalStatuses.has(row.status)) continue;
      out.push({ _id: row._id, spawnerColor: row.spawnerColor });
    }
    return out;
  },
});

/**
 * Initialize the presigned-URL upload slots + quota counter on the audit
 * row, called by the action right after `reserveSlotAndInsert` and
 * before dispatching the request to the spawner. Idempotent: writing the
 * same slots twice is harmless, but mid-flight slot rotation isn't
 * supported (the spawner already holds the URLs in memory).
 *
 * `quotaRemaining` is the number of additional URLs EP1 can still grant
 * after subtracting the pre-allocated slots: e.g. with
 * SANDBOX_MAX_OUTPUT_FILES_PER_RUN=16 and 2 slots pre-allocated, we
 * persist quotaRemaining=14.
 */
export const applyInitOutputSlots = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    slots: v.array(v.string()),
    quotaRemaining: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    if (sandboxTerminalStatuses.has(row.status)) return null;
    await ctx.db.patch(args.executionId, {
      outputUploadSlots: args.slots,
      outputUrlQuotaRemaining: args.quotaRemaining,
    });
    return null;
  },
});

/**
 * Server-side per-run quota counter. Spawner POSTs to EP1
 * (`/api/sandbox/output_upload_url`) when its local slot pool runs dry;
 * the httpAction calls this mutation to atomically decrement and reports
 * how many URLs were granted. Returns `granted: 0` if the row is already
 * terminal or the quota is exhausted — caller responds with 412 in that
 * case so the spawner stops asking.
 */
export const applyConsumeUrlQuota = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    count: v.number(),
  },
  returns: v.object({
    granted: v.number(),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return { granted: 0, remaining: 0 };
    if (sandboxTerminalStatuses.has(row.status)) {
      // Row is already terminal — refuse further uploads.
      return { granted: 0, remaining: row.outputUrlQuotaRemaining ?? 0 };
    }
    const remaining = row.outputUrlQuotaRemaining ?? 0;
    const granted = Math.max(0, Math.min(args.count, remaining));
    if (granted === 0) {
      return { granted: 0, remaining };
    }
    const nextRemaining = remaining - granted;
    await ctx.db.patch(args.executionId, {
      outputUrlQuotaRemaining: nextRemaining,
    });
    return { granted, remaining: nextRemaining };
  },
});

/**
 * Append a storage id to the audit row's `uploadedStorageIds` rollback
 * set. Spawner POSTs to EP2 (`/api/sandbox/record_uploaded`) after each
 * successful per-file upload; the httpAction calls this. Terminal-state
 * rows are refused (the run is over, no point recording new uploads).
 *
 * Note: we DON'T also write an `outputFiles` entry here — those are
 * written transactionally by `output_mutations.insertOutputFiles` when
 * the spawner result event lands. EP2 only feeds the rollback set so
 * a spawner crash between successful EP2 and the final SSE result
 * doesn't orphan the blob.
 */
export const applyRecordUploaded = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    fileName: v.string(),
    storageId: v.id('_storage'),
    size: v.number(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    if (sandboxTerminalStatuses.has(row.status)) {
      // Run is already terminal — caller is too late. Don't append to
      // the rollback set; the final state may have already been
      // computed and persisting more ids could trigger a stale
      // `failExecution` to delete a blob we now expect to keep.
      console.warn(
        `[sandbox.applyRecordUploaded] late EP2 for terminal row ${row._id} (status=${row.status}); ignoring ${args.fileName}`,
      );
      return null;
    }
    const existing = row.uploadedStorageIds ?? [];
    // Idempotency: dedupe in case the spawner retried EP2 after a
    // network blip. The set is small (cap = MAX_OUTPUT_FILES_PER_RUN)
    // so the linear scan is fine.
    if (existing.some((id) => id === args.storageId)) return null;
    await ctx.db.patch(args.executionId, {
      uploadedStorageIds: [...existing, args.storageId],
      heartbeatAt: Date.now(),
    });
    return null;
  },
});

/**
 * Terminal-state transition driven by user-Stop. Distinct from `finalize`
 * because there's no spawner result to merge — we just mark the row
 * `cancelled` with the canonical error code, and cascade to the artifact
 * so the canvas spinner clears in the same Convex tick. Idempotent: a
 * row already in a terminal state is left alone (watchdog/spawner result
 * may have raced ahead).
 */
export const cancelExecutionRecord = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    if (sandboxTerminalStatuses.has(row.status)) return null;
    const now = Date.now();
    const message = args.reason ?? 'Execution cancelled by user';
    await ctx.db.patch(args.executionId, {
      status: 'cancelled',
      statusChangedAt: now,
      completedAt: now,
      errorCode: 'CANCELLED',
      errorMessage: message,
      actualSeconds: Math.max(
        (now - row.startedAt) / 1000,
        row.estimatedSeconds,
      ),
    });
    // Artifact cascade removed — artifacts module deleted.
    return null;
  },
});
