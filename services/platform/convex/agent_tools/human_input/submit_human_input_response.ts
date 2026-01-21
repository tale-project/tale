/**
 * Internal Mutation: Submit Human Input Response
 *
 * Updates the approval record with the user's response and resumes agent execution.
 * The response is stored in the metadata and will be picked up
 * by the structured context builder when the agent resumes.
 */

import { internalMutation, mutation } from '../../_generated/server';
import { v } from 'convex/values';
import { components, internal } from '../../_generated/api';
import { saveMessage } from '@convex-dev/agent';
import { persistentStreaming } from '../../streaming/helpers';
import { getUserTeamIds } from '../../lib/get_user_teams';
import type { HumanInputRequestMetadata } from '../../../lib/shared/schemas/approvals';

export const submitHumanInputResponseInternal = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
    respondedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error('Human input request has already been responded to');
    }

    if (approval.resourceType !== 'human_input_request') {
      throw new Error('Invalid approval type');
    }

    const existingMetadata = (approval.metadata || {}) as HumanInputRequestMetadata;

    const updatedMetadata: HumanInputRequestMetadata = {
      ...existingMetadata,
      response: {
        value: args.response,
        respondedBy: args.respondedBy,
        timestamp: Date.now(),
      },
    };

    await ctx.db.patch(args.approvalId, {
      status: 'approved',
      approvedBy: args.respondedBy,
      reviewedAt: Date.now(),
      metadata: updatedMetadata,
    });

    return { success: true };
  },
});

export const submitHumanInputResponse = mutation({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Unauthorized');
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'pending') {
      throw new Error('Human input request has already been responded to');
    }

    if (approval.resourceType !== 'human_input_request') {
      throw new Error('Invalid approval type');
    }

    const threadId = approval.threadId;
    const organizationId = approval.organizationId;

    if (!threadId) {
      throw new Error('Human input request is not associated with a thread');
    }

    const existingMetadata = (approval.metadata || {}) as HumanInputRequestMetadata;
    const responseValue = args.response;
    const respondedBy = identity.email ?? identity.subject;

    const updatedMetadata: HumanInputRequestMetadata = {
      ...existingMetadata,
      response: {
        value: responseValue,
        respondedBy,
        timestamp: Date.now(),
      },
    };

    await ctx.db.patch(args.approvalId, {
      status: 'approved',
      approvedBy: identity.subject,
      reviewedAt: Date.now(),
      metadata: updatedMetadata,
    });

    // Resume agent execution by saving a system notification and scheduling the agent
    // The system message notifies the AI that a human response is available
    const responseDisplay = Array.isArray(responseValue)
      ? responseValue.join(', ')
      : responseValue;
    const systemNotification = `User responded to question "${existingMetadata.question}": ${responseDisplay}`;

    const { messageId: promptMessageId } = await saveMessage(
      ctx,
      components.agent,
      {
        threadId,
        message: { role: 'system', content: systemNotification },
      },
    );

    // Create a persistent text stream for the AI response
    const streamId = await persistentStreaming.createStream(ctx);

    // Get thread to retrieve userId and user's team IDs
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });
    const userTeamIds = thread?.userId
      ? await getUserTeamIds(ctx, thread.userId)
      : [];

    // Schedule the agent to continue processing
    await ctx.scheduler.runAfter(
      0,
      internal.chat_agent.actions.generateAgentResponse,
      {
        threadId,
        organizationId,
        maxSteps: 500,
        promptMessageId,
        messageText: systemNotification,
        streamId,
        userId: thread?.userId,
        userTeamIds,
      },
    );

    return {
      success: true,
      threadId,
      streamId,
    };
  },
});
