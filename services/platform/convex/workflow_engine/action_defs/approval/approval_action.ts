/**
 * Approval workflow actions
 *
 * These actions provide operations for managing approvals in workflows, enabling:
 * - Creating approval requests
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { toId } from '../../../lib/type_cast_helpers';
import {
  jsonRecordValidator,
  type ConvexJsonRecord,
} from '../../../lib/validators/json';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { createApproval } from './helpers/create_approval';

// Common field validators
const priorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

// Type for approval operation params (discriminated union)
type ApprovalActionParams =
  | {
      operation: 'create_approval';
      resourceType: string;
      resourceId: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
      executionId?: Id<'wfExecutions'>;
      requestedBy?: string;
      dueDate?: number;
      description?: string;
      stepSlug?: string;
      metadata?: ConvexJsonRecord;
    }
  | {
      operation: 'request_review';
      taskId: string;
      question?: string;
      agentSlug?: string;
    }
  | {
      operation: 'sweep_pending';
      resourceType: string;
      remindAfterHours: number;
      escalateAfterHours: number;
      limit?: number;
    };

export const approvalAction: ActionDefinition<ApprovalActionParams> = {
  type: 'approval',
  title: 'Approval Operation',
  description:
    'Execute approval operations: create_approval, request_review (the blocking task-ops review gate — pauses the execution until a human decides), sweep_pending (reminder/escalation pass over pending task_review / human_input_request approvals, one-shot per stage). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // create_approval: Create a new approval request
    v.object({
      operation: v.literal('create_approval'),
      resourceType: v.string(),
      resourceId: v.string(),
      priority: priorityValidator,
      executionId: v.optional(v.id('wfExecutions')),
      requestedBy: v.optional(v.string()),
      dueDate: v.optional(v.number()),
      description: v.optional(v.string()),
      stepSlug: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
    }),
    // request_review: the task-ops review gate. Creates (idempotently, keyed
    // by execution + step) a 'task_review' approval and PAUSES the execution
    // via the post-step approval scan; on resume the step re-executes, finds
    // the responded approval, and returns {responded: true, decision, ...}
    // so a condition step can branch on the human's decision.
    v.object({
      operation: v.literal('request_review'),
      taskId: v.id('tasks'),
      question: v.optional(v.string()),
      agentSlug: v.optional(v.string()),
    }),
    // sweep_pending: reminder/escalation pass over pending approvals of one
    // resource type. Atomic mark-and-return (metadata.remindedAt/escalatedAt
    // stamps) — each approval surfaces at most once per stage.
    v.object({
      operation: v.literal('sweep_pending'),
      resourceType: v.string(),
      remindAfterHours: v.number(),
      escalateAfterHours: v.number(),
      limit: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params, variables, extras) {
    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'approval requires a non-empty string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'create_approval': {
        return await createApproval(ctx, {
          organizationId,
          resourceType: params.resourceType, // Required by validator
          resourceId: params.resourceId, // Required by validator
          priority: params.priority, // Required by validator
          requestedBy: params.requestedBy,
          dueDate: params.dueDate,
          description: params.description,
          wfExecutionId: params.executionId,
          stepSlug: params.stepSlug,
          metadata: params.metadata,
        });
      }

      case 'request_review': {
        if (!extras?.executionId) {
          throw new Error(
            'request_review requires a workflow execution context',
          );
        }
        const result = await ctx.runMutation(
          internal.tasks.review_mutations.createTaskReviewRequest,
          {
            organizationId,
            taskId: toId<'tasks'>(params.taskId),
            wfExecutionId: toId<'wfExecutions'>(extras.executionId),
            stepSlug: extras.stepSlug ?? 'request_review',
            question: params.question,
            agentSlug: params.agentSlug,
          },
        );
        // `taskId` rides along for the run view: the `review` render kind
        // mounts the interactive TaskReviewCard only when the step output
        // carries it — without it the gate degrades to a raw JSON dump.
        return {
          operation: 'request_review',
          taskId: String(params.taskId),
          ...result,
        };
      }

      case 'sweep_pending': {
        // Only human-gate approval kinds may be swept from workflows — the
        // operational kinds (integration ops, erasure, …) have their own
        // lifecycles.
        const sweepable = ['task_review', 'human_input_request'];
        if (!sweepable.includes(params.resourceType)) {
          throw new Error(
            `sweep_pending supports resource types ${sweepable.join(', ')}; got "${params.resourceType}"`,
          );
        }
        const approvals = await ctx.runMutation(
          internal.approvals.internal_mutations.sweepPendingApprovals,
          {
            organizationId,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the allowlist above
            resourceType: params.resourceType as
              | 'task_review'
              | 'human_input_request',
            remindAfterHours: params.remindAfterHours,
            escalateAfterHours: params.escalateAfterHours,
            limit: params.limit,
          },
        );
        return { operation: 'sweep_pending', approvals };
      }

      default:
        throw new Error(
          `Unsupported approval operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
