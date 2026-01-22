/**
 * Internal Mutation: Create Human Input Request
 *
 * Creates an approval record for a human input request.
 * This displays as an input card in the chat UI.
 */

import { internalMutation } from '../../_generated/server';
import { v } from 'convex/values';
import { createApproval } from '../../approvals/helpers';
import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';

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
    placeholder: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate options are provided for select formats
    if (
      (args.format === 'single_select' || args.format === 'multi_select') &&
      (!args.options || args.options.length === 0)
    ) {
      throw new Error(`options are required for ${args.format} format`);
    }

    const metadata: HumanInputRequestMetadata = {
      question: args.question,
      format: args.format,
      context: args.context,
      options: args.options,
      placeholder: args.placeholder,
      requestedAt: Date.now(),
    };

    // Create a unique resourceId for this request with random suffix to prevent collisions
    const resourceId = `human_input:${args.threadId}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const approvalId = await createApproval(ctx, {
      organizationId: args.organizationId,
      resourceType: 'human_input_request',
      resourceId,
      priority: 'medium',
      description: args.question,
      threadId: args.threadId,
      messageId: args.messageId,
      metadata,
    });

    return approvalId;
  },
});
