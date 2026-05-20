import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
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
      if (row.status === 'completed' || row.status === 'failed') {
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

    return await ctx.db.insert('sandboxExecutions', {
      organizationId: args.organizationId,
      uploadedBy: args.uploadedBy,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      ...(args.messageId !== undefined && { messageId: args.messageId }),
      ...(args.toolCallId !== undefined && { toolCallId: args.toolCallId }),
      ...(args.agentSlug !== undefined && { agentSlug: args.agentSlug }),
      language: args.language,
      ...(args.purpose !== undefined && { purpose: args.purpose }),
      codePreview: args.codePreview,
      ...(args.codeStorageId !== undefined && {
        codeStorageId: args.codeStorageId,
      }),
      packages: args.packages,
      ...(args.installOptions !== undefined && {
        installOptions: args.installOptions,
      }),
      status: 'queued',
      statusChangedAt: now,
      heartbeatAt: now,
      estimatedSeconds: args.estimatedSeconds,
      outputFiles: [],
      startedAt: now,
    });
  },
});

export const setRunning = internalMutation({
  args: {
    executionId: v.id('sandboxExecutions'),
    // Allow the action to record the install phase as a distinct status
    // (the spawner emits a separate `installing` SSE event before user code
    // starts running). Defaults to `running` if omitted.
    status: v.optional(v.union(v.literal('installing'), v.literal('running'))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row) return null;
    // Monotonic: queued → installing → running. Don't roll back from a
    // later state. Terminal states are also rejected (no resurrection).
    const next = args.status ?? 'running';
    const allowed =
      (row.status === 'queued' && next === 'installing') ||
      (row.status === 'queued' && next === 'running') ||
      (row.status === 'installing' && next === 'running');
    if (!allowed) return null;
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
export const recoverStuckSandboxes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - SANDBOX_WATCHDOG_CUTOFF_MS;
    let recovered = 0;
    for (const status of ['running', 'installing', 'queued'] as const) {
      for await (const row of ctx.db
        .query('sandboxExecutions')
        .withIndex('by_status', (q) => q.eq('status', status))) {
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
        recovered += 1;
      }
    }
    return recovered;
  },
});
