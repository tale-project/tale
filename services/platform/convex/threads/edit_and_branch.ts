/**
 * Edit and Branch — fork a thread from a specific message point.
 *
 * When a user edits a previously sent message, we:
 * 1. Create a new thread (branch) and copy messages up to the edit point
 * 2. Save the edited message content
 * 3. Trigger agent generation on the branch
 */

import { v } from 'convex/values';

import { components, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { authComponent } from '../auth';

/**
 * Find the order of the edited message in the source thread.
 */
async function getEditedMessageOrder(
  ctx: Pick<ActionCtx, 'runQuery'>,
  sourceThreadId: string,
  editedMessageId: string,
): Promise<number> {
  const result = await ctx.runQuery(
    components.agent.messages.listMessagesByThreadId,
    {
      threadId: sourceThreadId,
      order: 'asc',
      paginationOpts: { cursor: null, numItems: 500 },
      excludeToolMessages: true,
      statuses: ['success'],
    },
  );

  for (const msg of result.page) {
    if (msg._id === editedMessageId) {
      return msg.order;
    }
  }

  throw new Error('Edited message not found in thread');
}

/**
 * Public action: edit a message and create a new branch.
 *
 * Accepts the editedMessageId (the user message being changed).
 * The mutation handles message copying and saving the edited message.
 * This action orchestrates: resolve config → create branch (with messages) → start generation.
 */
export const editAndBranch = action({
  args: {
    sourceThreadId: v.string(),
    rootThreadId: v.string(),
    editedMessageId: v.string(),
    newMessage: v.string(),
    organizationId: v.string(),
    orgSlug: v.string(),
    agentSlug: v.string(),
    modelId: v.optional(v.string()),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
  },
  returns: v.object({
    branchThreadId: v.string(),
    streamId: v.string(),
    forkOrder: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    branchThreadId: string;
    streamId: string;
    forkOrder: number;
  }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const userId = String(authUser._id);

    // Get the order of the edited message (needed for branch record + frontend matching)
    const editedMessageOrder = await getEditedMessageOrder(
      ctx,
      args.sourceThreadId,
      args.editedMessageId,
    );

    // Resolve agent config (requires Node runtime)
    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug: args.orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        modelId: args.modelId,
      },
    );

    // Create branch thread, copy messages up to edit point, save edited message
    const { branchThreadId, forkOrder } = await ctx.runMutation(
      internal.threads.create_branch_thread.createBranchThread,
      {
        userId,
        sourceThreadId: args.sourceThreadId,
        rootThreadId: args.rootThreadId,
        editedMessageId: args.editedMessageId,
        editedMessageOrder,
        newMessage: args.newMessage,
      },
    );

    // Start agent generation on the branch thread
    const { streamId } = await ctx.runMutation(
      internal.agents.start_chat.startChat,
      {
        threadId: branchThreadId,
        organizationId: args.organizationId,
        userId,
        userEmail: authUser.email,
        userName: authUser.name,
        message: args.newMessage,
        userContext: args.userContext,
        agentConfig,
        agentSlug: args.agentSlug,
      },
    );

    return { branchThreadId, streamId, forkOrder };
  },
});
