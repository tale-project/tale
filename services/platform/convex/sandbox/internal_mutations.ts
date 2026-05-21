import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { applyFinalizeArtifactRun } from '../artifacts/internal_mutations';
import { rateLimiter } from '../lib/rate_limiter';
import {
  SANDBOX_DAILY_CPU_BUDGET_SECONDS,
  SANDBOX_MAX_CONCURRENT_PER_ORG,
  SANDBOX_WATCHDOG_CUTOFF_MS,
} from './schema';
import {
  sandboxErrorCodeValidator,
  sandboxLanguageValidator,
  sandboxOutputFileValidator,
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
    artifactId: v.optional(v.id('artifacts')),
    language: sandboxLanguageValidator,
    purpose: v.optional(v.string()),
    codePreview: v.string(),
    codeStorageId: v.optional(v.id('_storage')),
    packages: v.array(v.string()),
    installOptions: v.optional(
      v.object({
        allowSdist: v.optional(v.boolean()),
        allowInstallScripts: v.optional(v.boolean()),
      }),
    ),
    estimatedSeconds: v.number(),
  },
  returns: v.id('sandboxExecutions'),
  handler: async (ctx, args) => {
    const now = Date.now();

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
        if (inFlight >= SANDBOX_MAX_CONCURRENT_PER_ORG) {
          throw new ConvexError({
            code: 'QUOTA_EXCEEDED',
            message: `At most ${SANDBOX_MAX_CONCURRENT_PER_ORG} sandboxes can run concurrently for this organization.`,
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
      ...(args.artifactId !== undefined && { artifactId: args.artifactId }),
      // Normalize the audit field: always store an object with explicit
      // booleans (default false) so a future read-side default-divergence
      // can't quietly invert the meaning. The legacy conditional-spread
      // stored either `undefined` or a partial object, depending on the
      // caller's args shape.
      installOptions: {
        allowSdist: args.installOptions?.allowSdist ?? false,
        allowInstallScripts: args.installOptions?.allowInstallScripts ?? false,
      },
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
        // Cascade to the artifact row if this execution was bound to one,
        // so the canvas spinner terminates as soon as the watchdog runs
        // (otherwise the runnable card spins until the audit row TTLs out).
        if (row.artifactId) {
          await applyFinalizeArtifactRun(ctx, {
            artifactId: row.artifactId,
            runStatus: 'failed',
            runErrorCode: 'SPAWNER_UNAVAILABLE',
            runErrorMessage: `Watchdog reaped a stuck ${status} sandbox execution`,
            runOutputFiles: [],
            runExecutionId: row._id,
          });
        }
        recovered += 1;
      }
    }
    return recovered;
  },
});
