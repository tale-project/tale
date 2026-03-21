import { v } from 'convex/values';

import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';

import { internalMutation } from '../../_generated/server';
import {
  createApproval,
  listPendingApprovalsForExecution,
} from '../../approvals/helpers';
import { toId } from '../../lib/type_cast_helpers';

export const createHumanInputRequest = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    question: v.string(),
    format: v.union(
      v.literal('single_select'),
      v.literal('multi_select'),
      v.literal('text_input'),
      v.literal('yes_no'),
    ),
    context: v.optional(v.string()),
    options: v.optional(
      v.array(
        v.object({
          label: v.string(),
          description: v.optional(v.string()),
          value: v.optional(v.string()),
        }),
      ),
    ),
    messageId: v.optional(v.string()),
    wfExecutionId: v.optional(v.string()),
    stepSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotency guard for workflow context: if a pending human_input_request
    // already exists for this execution+step, return it instead of creating a duplicate
    if (args.wfExecutionId && args.stepSlug) {
      const existing = await listPendingApprovalsForExecution(
        ctx,
        toId<'wfExecutions'>(args.wfExecutionId),
      );
      const duplicate = existing.find(
        (a) =>
          a.resourceType === 'human_input_request' &&
          a.stepSlug === args.stepSlug,
      );
      if (duplicate) {
        return duplicate._id;
      }
    }

    const options =
      args.options ??
      (args.format === 'yes_no'
        ? [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ]
        : undefined);

    if (
      (args.format === 'single_select' ||
        args.format === 'multi_select' ||
        args.format === 'yes_no') &&
      (!options || options.length === 0)
    ) {
      throw new Error(`options are required for ${args.format} format`);
    }

    const metadata: HumanInputRequestMetadata = {
      question: args.question,
      format: args.format,
      context: args.context,
      options,
      requestedAt: Date.now(),
    };

    const resourceId = `human_input:${args.threadId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'human_input_request',
      resourceId,
      priority: 'medium',
      description: args.question,
      threadId: args.threadId,
      messageId: args.messageId,
      wfExecutionId: args.wfExecutionId
        ? toId<'wfExecutions'>(args.wfExecutionId)
        : undefined,
      stepSlug: args.stepSlug,
      metadata,
    });

    return approvalId;
  },
});
