/**
 * Agent-on-demand job lifecycle (spawn_agent).
 *
 * The `agentJobs` row is the job's source of truth. Everything here follows
 * the task-run precedents:
 *
 * - Admission is a SINGLE transaction (`startJob`): policy read + running
 *   count + insert + counter increment — no advisory pre-check, no race
 *   (`task_metrics/internal_mutations.ts::startTaskAgentRun`).
 * - The `agentRunCounters` scope `'jobs:org'` tracks running jobs. Exactly
 *   one writer pair (`startJob` / `finalizeJob`), floor-at-0 discipline.
 * - Orphan recovery is CRON-FREE: the over-cap path of `startJob` and the
 *   opportunistic GC both flip `running` rows older than the policy's
 *   `jobStuckAfterMs` to `timed_out` — self-healing exactly when the leak
 *   would hurt (`recoverStuckTaskRuns` shape, without the cron).
 * - GC is opportunistic and rate-limiter-gated (`cleanup:agentJobs`), the
 *   `tts/mutations.ts::maybeCleanupChunks` pattern: terminal rows past the
 *   policy TTL are deleted together with their transcript threads.
 */

import { createThread } from '@convex-dev/agent';
import { v } from 'convex/values';

import {
  agentJobsConfigSchema,
  type AgentJobsConfig,
} from '../../lib/shared/schemas/governance';
import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { readPolicyRow } from '../governance/helpers';
import { rateLimiter } from '../lib/rate_limiter';
import { deleteJobThread } from './delete_job_thread';
import { applyJobProgressOps, trimOpIdRing } from './progress_ops';
import {
  agentJobFailureReasonValidator,
  agentJobProgressItemValidator,
  agentJobSpecValidator,
  agentJobStatusValidator,
} from './schema';

/** `agentRunCounters` scope for running spawned jobs (org-wide). */
export const JOBS_COUNTER_SCOPE = 'jobs:org';

/** Current shape version of `agentJobs.spec` (widened in M2/M3). */
export const AGENT_JOB_SPEC_VERSION = 1;

const DEFAULT_AGENT_JOBS_CONFIG = agentJobsConfigSchema.parse({});

async function readAgentJobsConfig(
  ctx: MutationCtx,
  organizationId: string,
): Promise<AgentJobsConfig> {
  const row = await readPolicyRow(ctx.db, organizationId, 'agent_jobs');
  if (!row) return DEFAULT_AGENT_JOBS_CONFIG;
  const parsed = agentJobsConfigSchema.safeParse(row.config);
  return parsed.success ? parsed.data : DEFAULT_AGENT_JOBS_CONFIG;
}

async function adjustJobCounter(
  ctx: MutationCtx,
  organizationId: string,
  delta: 1 | -1,
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query('agentRunCounters')
    .withIndex('by_org_scope', (q) =>
      q.eq('organizationId', organizationId).eq('scope', JOBS_COUNTER_SCOPE),
    )
    .first();
  if (!existing) {
    await ctx.db.insert('agentRunCounters', {
      organizationId,
      scope: JOBS_COUNTER_SCOPE,
      running: Math.max(0, delta),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(existing._id, {
    // Floor at 0: a late finalize for an already-recovered run must never
    // drive the counter negative (adjustRunCounter discipline).
    running: Math.max(0, existing.running + delta),
    updatedAt: now,
  });
}

/**
 * Flip `running` jobs whose action evidently died (older than
 * `jobStuckAfterMs`) to `timed_out`, decrementing the counter through the
 * same idempotent path as a normal finalize. Returns how many were healed.
 */
async function recoverOrphanedJobs(
  ctx: MutationCtx,
  organizationId: string,
  stuckAfterMs: number,
  limit: number,
): Promise<number> {
  const cutoff = Date.now() - stuckAfterMs;
  const running = await ctx.db
    .query('agentJobs')
    .withIndex('by_org_status_completed', (q) =>
      q.eq('organizationId', organizationId).eq('status', 'running'),
    )
    .take(limit);
  let healed = 0;
  for (const job of running) {
    if (job.startedAt > cutoff) continue;
    await finalizeJobRow(ctx, job._id, {
      status: 'timed_out',
      failureReason: 'orphaned',
    });
    healed += 1;
  }
  return healed;
}

interface FinalizePatch {
  status: 'completed' | 'failed' | 'timed_out' | 'cancelled';
  failureReason?:
    | 'generation_error'
    | 'deadline_exceeded'
    | 'budget_exhausted'
    | 'orphaned';
  resultText?: string;
  inputTokens?: number;
  outputTokens?: number;
  costCents?: number;
}

/** Idempotent terminal transition + counter decrement (shared core). */
async function finalizeJobRow(
  ctx: MutationCtx,
  jobId: Id<'agentJobs'>,
  patch: FinalizePatch,
): Promise<boolean> {
  const job = await ctx.db.get(jobId);
  if (!job || job.status !== 'running') return false;
  const now = Date.now();
  await ctx.db.patch(jobId, {
    status: patch.status,
    failureReason: patch.failureReason,
    resultText: patch.resultText,
    inputTokens: patch.inputTokens ?? job.inputTokens,
    outputTokens: patch.outputTokens ?? job.outputTokens,
    costCents: patch.costCents ?? job.costCents,
    completedAt: now,
    durationMs: now - job.startedAt,
  });
  await adjustJobCounter(ctx, job.organizationId, -1);
  return true;
}

export const startJob = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userId: v.optional(v.string()),
    parentAgentSlug: v.string(),
    name: v.string(),
    description: v.string(),
    spec: agentJobSpecValidator,
  },
  returns: v.union(
    v.object({
      started: v.literal(true),
      jobId: v.id('agentJobs'),
      jobThreadId: v.string(),
    }),
    v.object({
      started: v.literal(false),
      reason: v.literal('JOB_CONCURRENCY'),
      running: v.number(),
      cap: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const config = await readAgentJobsConfig(ctx, args.organizationId);

    const counter = await ctx.db
      .query('agentRunCounters')
      .withIndex('by_org_scope', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('scope', JOBS_COUNTER_SCOPE),
      )
      .first();
    let running = counter?.running ?? 0;

    if (running >= config.maxConcurrentJobs) {
      // Self-heal exactly when the leak would hurt: an orphaned `running`
      // row (action died before finalize) both occupies a slot and leaks
      // the counter. Recover, then re-check.
      const healed = await recoverOrphanedJobs(
        ctx,
        args.organizationId,
        config.jobStuckAfterMs,
        config.maxConcurrentJobs + 8,
      );
      running = Math.max(0, running - healed);
      if (running >= config.maxConcurrentJobs) {
        return {
          started: false as const,
          reason: 'JOB_CONCURRENCY' as const,
          running,
          cap: config.maxConcurrentJobs,
        };
      }
    }

    const now = Date.now();
    // Fresh transcript thread per job — never reused. The summary's
    // `parentThreadId` is load-bearing twice: `canAccessThreadOrSubThread`
    // authorizes the UI transcript subscription through it, and
    // `getApprovalThreadId` re-homes any approval a job tool creates onto
    // the parent chat thread.
    const jobThreadId = await createThread(ctx, components.agent, {
      userId: args.userId,
      title: `agent-job:${args.name}`,
      summary: JSON.stringify({
        kind: 'agent_job',
        parentThreadId: args.threadId,
        organizationId: args.organizationId,
      }),
    });

    const jobId = await ctx.db.insert('agentJobs', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      jobThreadId,
      userId: args.userId,
      parentAgentSlug: args.parentAgentSlug,
      name: args.name,
      description: args.description,
      status: 'running',
      specVersion: AGENT_JOB_SPEC_VERSION,
      spec: args.spec,
      progress: [],
      recentOpIds: [],
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      startedAt: now,
    });

    await adjustJobCounter(ctx, args.organizationId, 1);

    return { started: true as const, jobId, jobThreadId };
  },
});

const progressAddValidator = v.object({
  type: v.literal('add'),
  id: v.string(),
  content: v.string(),
});
const progressUpdateValidator = v.object({
  type: v.literal('update'),
  id: v.string(),
  content: v.optional(v.string()),
  status: v.optional(
    v.union(
      v.literal('pending'),
      v.literal('in_progress'),
      v.literal('done'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
  ),
  note: v.optional(v.string()),
});
const progressRemoveValidator = v.object({
  type: v.literal('remove'),
  id: v.string(),
});

type ApplyProgressResult =
  | {
      success: true;
      progress: import('./progress_ops').JobProgressItem[];
      activeProgressId?: string;
      deduplicated?: boolean;
    }
  | {
      success: false;
      error: string;
      code:
        | 'job_not_running'
        | 'unknown_item'
        | 'duplicate_add'
        | 'invalid_batch';
    };

export const applyProgressOperations = internalMutation({
  args: {
    jobThreadId: v.string(),
    opId: v.string(),
    operations: v.array(
      v.union(
        progressAddValidator,
        progressUpdateValidator,
        progressRemoveValidator,
      ),
    ),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      progress: v.array(agentJobProgressItemValidator),
      activeProgressId: v.optional(v.string()),
      deduplicated: v.optional(v.boolean()),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
      code: v.union(
        v.literal('job_not_running'),
        v.literal('unknown_item'),
        v.literal('duplicate_add'),
        v.literal('invalid_batch'),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<ApplyProgressResult> => {
    const job = await ctx.db
      .query('agentJobs')
      .withIndex('by_job_thread', (q) => q.eq('jobThreadId', args.jobThreadId))
      .first();
    if (!job || job.status !== 'running') {
      return {
        success: false,
        error: 'job is not running',
        code: 'job_not_running',
      };
    }

    if (job.recentOpIds.includes(args.opId)) {
      return {
        success: true,
        progress: job.progress,
        activeProgressId: job.activeProgressId,
        deduplicated: true,
      };
    }
    const applied = applyJobProgressOps(
      job.progress,
      args.operations,
      Date.now(),
    );
    if (!applied.success) return applied;

    const recentOpIds = trimOpIdRing(job.recentOpIds, args.opId);
    await ctx.db.patch(job._id, {
      progress: applied.progress,
      activeProgressId: applied.activeProgressId,
      recentOpIds,
    });

    return {
      success: true,
      progress: applied.progress,
      activeProgressId: applied.activeProgressId,
    };
  },
});

export const finalizeJob = internalMutation({
  args: {
    jobId: v.id('agentJobs'),
    status: agentJobStatusValidator,
    failureReason: v.optional(agentJobFailureReasonValidator),
    resultText: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costCents: v.optional(v.number()),
  },
  returns: v.object({ finalized: v.boolean() }),
  handler: async (ctx, args) => {
    if (args.status === 'running') return { finalized: false };
    const job = await ctx.db.get(args.jobId);
    if (!job) return { finalized: false };
    const finalized = await finalizeJobRow(ctx, args.jobId, {
      status: args.status,
      failureReason: args.failureReason,
      resultText: args.resultText,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costCents: args.costCents,
    });
    if (finalized) {
      await ctx.scheduler.runAfter(
        0,
        internal.agent_jobs.internal_mutations.maybeCleanupJobs,
        { organizationId: job.organizationId },
      );
    }
    return { finalized };
  },
});

/**
 * Anchor this turn's unlinked job cards to the assistant message so the chat
 * splicer can position them (approvals-link sibling; jobs cannot reuse
 * `linkApprovalsToMessage` — different table).
 */
export const linkJobsToMessage = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query('agentJobs')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .collect();
    for (const job of jobs) {
      if (job.messageId === undefined) {
        await ctx.db.patch(job._id, { messageId: args.messageId });
      }
    }
    return null;
  },
});

/**
 * Opportunistic TTL sweep: delete terminal jobs past the policy TTL together
 * with their transcript threads, and heal orphaned `running` rows. Gated by
 * the `cleanup:agentJobs` token bucket (per org); scheduled from
 * `finalizeJob` and the over-cap admission path — no cron.
 */
export const maybeCleanupJobs = internalMutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const gate = await rateLimiter.limit(ctx, 'cleanup:agentJobs', {
      key: args.organizationId,
      throws: false,
    });
    if (!gate.ok) return null;

    const config = await readAgentJobsConfig(ctx, args.organizationId);
    await recoverOrphanedJobs(
      ctx,
      args.organizationId,
      config.jobStuckAfterMs,
      32,
    );

    const cutoff = Date.now() - config.ttlMs;
    for (const status of [
      'completed',
      'failed',
      'timed_out',
      'cancelled',
    ] as const) {
      const expired = await ctx.db
        .query('agentJobs')
        .withIndex('by_org_status_completed', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('status', status)
            .lt('completedAt', cutoff),
        )
        .take(16);
      for (const job of expired) {
        await deleteJobThread(ctx, job.jobThreadId);
        await ctx.db.delete(job._id);
      }
    }
    return null;
  },
});
