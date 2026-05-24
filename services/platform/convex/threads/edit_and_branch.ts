/**
 * Edit and Branch — fork a thread from a specific message point.
 *
 * When a user edits a previously sent message, we:
 * 1. Create a new thread (branch) and copy messages up to the edit point
 * 2. Save the edited message content
 * 3. Trigger agent generation on the branch
 */

import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

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
    // Derive `organizationId` from the source thread server-side rather than
    // trusting the client. A multi-org user could otherwise pass their other
    // org's id and bill / store artifacts under the wrong org. The arg
    // remains on the wire for backward-compat but must match the source
    // thread's org or we reject.
    const sourceMetadata = await ctx.runQuery(
      internal.threads.internal_queries.getThreadMetadata,
      { threadId: args.sourceThreadId },
    );
    if (!sourceMetadata || !sourceMetadata.organizationId) {
      throw new ConvexError({
        code: 'THREAD_NOT_FOUND',
        message: 'Source thread not found or has no organization binding.',
      });
    }
    const organizationId = sourceMetadata.organizationId;
    if (args.organizationId !== organizationId) {
      throw new ConvexError({
        code: 'ORG_MISMATCH',
        message: 'organizationId does not match source thread org.',
      });
    }

    const { userId, email, name } = await requireOrgMembershipById(
      ctx,
      organizationId,
    );

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
        agentSlug: args.agentSlug,
        organizationId,
        modelId: args.modelId,
      },
    );

    // Create branch thread, copy messages up to edit point, save edited message
    const { branchThreadId, forkOrder } = await ctx.runMutation(
      internal.threads.create_branch_thread.createBranchThread,
      {
        userId,
        organizationId,
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
        organizationId,
        userId,
        userEmail: email,
        userName: name,
        message: args.newMessage,
        userContext: args.userContext,
        agentConfig,
        agentSlug: args.agentSlug,
      },
    );

    return { branchThreadId, streamId, forkOrder };
  },
});
