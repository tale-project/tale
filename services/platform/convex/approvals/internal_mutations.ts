import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import * as ApprovalsHelpers from './helpers';
import {
  approvalResourceTypeValidator,
  approvalPriorityValidator,
} from './validators';

export const createApproval = internalMutation({
  args: {
    organizationId: v.string(),
    resourceType: approvalResourceTypeValidator,
    resourceId: v.string(),
    priority: approvalPriorityValidator,
    requestedBy: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    description: v.optional(v.string()),
    wfExecutionId: v.optional(v.id('wfExecutions')),
    stepSlug: v.optional(v.string()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    return await ApprovalsHelpers.createApproval(ctx, args);
  },
});

export const linkApprovalsToMessage = internalMutation({
  args: {
    threadId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args): Promise<number> => {
    return await ApprovalsHelpers.linkApprovalsToMessage(ctx, args);
  },
});

/**
 * Reminder/escalation sweep over PENDING approvals of one resource type —
 * the review-reminders workflow's atomic mark-and-return read. Stage stamps
 * (`metadata.remindedAt` / `metadata.escalatedAt`) are written in this
 * mutation, so each approval is returned AT MOST ONCE per stage no matter
 * how often the cron re-runs. An approval old enough for escalation that
 * was never reminded skips straight to `escalate` (one action, not two).
 *
 * Rows surface the task-review metadata fields (`requestedFor`, `taskId`,
 * `projectId`, `agentSlug`) when present so the workflow can target the
 * designated reviewer without a second read.
 */
export const sweepPendingApprovals = internalMutation({
  args: {
    organizationId: v.string(),
    resourceType: approvalResourceTypeValidator,
    remindAfterHours: v.number(),
    escalateAfterHours: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      approvalId: v.id('approvals'),
      resourceType: v.string(),
      resourceId: v.string(),
      stage: v.union(v.literal('remind'), v.literal('escalate')),
      ageHours: v.number(),
      requestedFor: v.optional(v.string()),
      taskId: v.optional(v.string()),
      taskTitle: v.optional(v.string()),
      projectId: v.optional(v.string()),
      agentSlug: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const now = Date.now();
    const remindMs = args.remindAfterHours * 60 * 60 * 1000;
    const escalateMs = args.escalateAfterHours * 60 * 60 * 1000;

    const metaString = (
      metadata: Record<string, unknown> | undefined,
      key: string,
    ): string | undefined => {
      const value = metadata?.[key];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    };

    const rows: Array<{
      approvalId: Id<'approvals'>;
      resourceType: string;
      resourceId: string;
      stage: 'remind' | 'escalate';
      ageHours: number;
      requestedFor?: string;
      taskId?: string;
      taskTitle?: string;
      projectId?: string;
      agentSlug?: string;
    }> = [];

    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_org_status_resourceType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending')
          .eq('resourceType', args.resourceType),
      )) {
      const age = now - approval._creationTime;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is a jsonRecord
      const metadata = (approval.metadata ?? {}) as Record<string, unknown>;

      let stage: 'remind' | 'escalate' | undefined;
      if (age >= escalateMs && metadata.escalatedAt === undefined) {
        stage = 'escalate';
      } else if (
        age >= remindMs &&
        age < escalateMs &&
        metadata.remindedAt === undefined
      ) {
        stage = 'remind';
      }
      if (!stage) continue;

      await ctx.db.patch(approval._id, {
        metadata: {
          ...metadata,
          ...(stage === 'escalate'
            ? { escalatedAt: now }
            : { remindedAt: now }),
        },
      });
      // Task title for notification params (best-effort; PII-lean).
      const taskIdRaw = metaString(metadata, 'taskId');
      let taskTitle: string | undefined;
      const normalizedTaskId = taskIdRaw
        ? ctx.db.normalizeId('tasks', taskIdRaw)
        : null;
      if (normalizedTaskId) {
        const task = await ctx.db.get(normalizedTaskId);
        if (task && task.organizationId === args.organizationId) {
          taskTitle = task.title;
        }
      }
      rows.push({
        approvalId: approval._id,
        resourceType: approval.resourceType,
        resourceId: approval.resourceId,
        stage,
        ageHours: Math.round(age / (60 * 60 * 1000)),
        requestedFor: metaString(metadata, 'requestedFor'),
        taskId: taskIdRaw,
        taskTitle,
        projectId: metaString(metadata, 'projectId'),
        agentSlug: metaString(metadata, 'agentSlug'),
      });
      if (rows.length >= limit) break;
    }
    return rows;
  },
});

/**
 * Create an `external_agent_plan` approval for a plan the agent just proposed
 * (plan/act workflow). Unlike the generic createApproval upsert, a newer plan
 * SUPERSEDES any older pending plan on the thread (auto-rejected + stamped
 * `supersededBy`) — only the latest plan is ever actionable. Also flips the
 * thread's plan/act toggle to `plan`, so an agent-initiated plan leaves the
 * composer reflecting reality (idempotent for turns that already ran in plan
 * mode). One atomic mutation.
 */
export const createPlanApproval = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** Assistant message of the turn that proposed the plan (card anchor). */
    messageId: v.string(),
    agentSlug: v.string(),
    modelRef: v.string(),
    plan: v.string(),
    planSource: v.union(v.literal('exit_plan_mode'), v.literal('final_text')),
    requestedBy: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    const approvalId = await ctx.db.insert('approvals', {
      organizationId: args.organizationId,
      status: 'pending',
      resourceType: 'external_agent_plan',
      resourceId: args.threadId,
      priority: 'medium',
      threadId: args.threadId,
      messageId: args.messageId,
      metadata: {
        plan: args.plan,
        planSource: args.planSource,
        agentSlug: args.agentSlug,
        modelRef: args.modelRef,
        requestedAt: Date.now(),
        ...(args.requestedBy !== undefined && {
          requestedBy: args.requestedBy,
        }),
      },
    });

    // Supersede older pending plans on this thread (skip the row just added).
    for await (const existing of ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', 'external_agent_plan'),
      )) {
      if (existing._id === approvalId) continue;
      await ctx.db.patch(existing._id, {
        status: 'rejected',
        reviewedAt: Date.now(),
        metadata: {
          ...(isRecord(existing.metadata) ? existing.metadata : {}),
          supersededBy: approvalId,
        },
      });
    }

    // Reflect the awaiting-approval state on the composer toggle.
    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (threadMeta && threadMeta.externalAgentMode !== 'plan') {
      await ctx.db.patch(threadMeta._id, { externalAgentMode: 'plan' });
    }

    return approvalId;
  },
});

/**
 * Create the browser-handoff approval when the agent calls
 * request_human_control and its turn parks. Mirrors createPlanApproval: an
 * inline card anchored to the turn's assistant message, superseding any older
 * pending handoff on the thread. Unlike plan it does NOT toggle
 * externalAgentMode — the composer stays in its current mode; the card itself
 * signals "agent paused, waiting for you". A no-human auto-return is scheduled
 * here so an unattended (scheduled/async) run can't park forever.
 */
export const createHumanControlRequest = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** Assistant message of the turn that requested control. Only stored for
     * provenance — the card renders in the composer slot, NOT anchored to a
     * message (so a long thread that paginated the message out still shows it). */
    messageId: v.string(),
    agentSlug: v.string(),
    modelRef: v.string(),
    reason: v.string(),
    /** Park deadline before the no-human auto-return. Defaults via
     * EXTERNAL_AGENT_HUMAN_CONTROL_PARK_MS (15 min) when omitted. */
    parkTimeoutMs: v.optional(v.number()),
    requestedBy: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<Id<'approvals'>> => {
    // Idempotent: this fires MID-TURN (the moment the agent calls
    // request_human_control) — and the turn-end path may fire it again — so if
    // a pending handoff already exists for this thread, refresh it in place
    // rather than stacking duplicates. At most one pending handoff per thread.
    const existing = await ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', 'external_agent_human_control'),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        messageId: args.messageId,
        metadata: {
          ...(isRecord(existing.metadata) ? existing.metadata : {}),
          reason: args.reason,
          agentSlug: args.agentSlug,
          modelRef: args.modelRef,
        },
      });
      return existing._id;
    }

    const parkTimeoutMs =
      args.parkTimeoutMs ??
      Number(
        process.env.EXTERNAL_AGENT_HUMAN_CONTROL_PARK_MS ??
          String(15 * 60 * 1000),
      );
    const approvalId = await ctx.db.insert('approvals', {
      organizationId: args.organizationId,
      status: 'pending',
      resourceType: 'external_agent_human_control',
      resourceId: args.threadId,
      priority: 'high',
      threadId: args.threadId,
      messageId: args.messageId,
      metadata: {
        reason: args.reason,
        agentSlug: args.agentSlug,
        modelRef: args.modelRef,
        requestedAt: Date.now(),
        parkTimeoutMs,
        ...(args.requestedBy !== undefined && {
          requestedBy: args.requestedBy,
        }),
      },
    });

    // No-human fallback: if nobody takes control within parkTimeoutMs, the
    // scheduled mutation resumes the agent with a "no human available" steer.
    await ctx.scheduler.runAfter(
      parkTimeoutMs,
      internal.approvals.human_control_mutations.autoReturnHumanControl,
      { approvalId, organizationId: args.organizationId },
    );

    return approvalId;
  },
});
