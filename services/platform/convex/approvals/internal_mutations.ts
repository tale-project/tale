import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
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
