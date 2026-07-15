/**
 * Fork and Chat — fork a shared thread and send the first message.
 *
 * When a receiver of a shared chat sends their first message, we:
 * 1. Fork the shared thread (snapshot messages only)
 * 2. Resolve agent config
 * 3. Start chat on the forked thread with the user's message
 */

import { ConvexError, v } from 'convex/values';

import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { validateChatAttachmentCaps } from '../agents/chat_turn';
import { userContextValidator } from '../lib/agent_response/validators';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { blobRefValidator } from '../lib/storage/blob_ref';

export const forkAndChat = action({
  args: {
    shareToken: v.string(),
    message: v.string(),
    agentSlug: v.string(),
    organizationId: v.string(),
    modelId: v.optional(v.string()),
    userContext: v.optional(userContextValidator),
    /**
     * Attachments staged in the shared-view composer before the first send
     * forks the thread. Validated with the same caps `chatWithAgentTurn`
     * re-enforces (count/total-size/per-file-size/MIME allowlist) — this is
     * a public action, so a scripted client could otherwise attach an
     * unbounded array on the very first turn of a forked thread.
     */
    attachments: v.optional(
      v.array(
        v.object({
          // Blob reference (`_storage` id or `s3:` ref) — see lib/storage/blob_ref.
          fileId: blobRefValidator,
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    validateChatAttachmentCaps(args.attachments);

    // Fork the shared thread first. `forkThread` already verifies the
    // caller is a member of the source thread's org and writes the new
    // thread under that same org. We then derive `organizationId` from the
    // new thread's metadata rather than trusting `args.organizationId` — a
    // multi-org user could otherwise pass a different (own) org id and
    // split billing/agent-config from thread storage.
    const newThreadId = await ctx.runMutation(
      api.threads.mutations.forkThread,
      { shareToken: args.shareToken },
    );

    const forkedMetadata = await ctx.runQuery(
      internal.threads.internal_queries.getThreadMetadata,
      { threadId: newThreadId },
    );
    if (!forkedMetadata || !forkedMetadata.organizationId) {
      throw new ConvexError({
        code: 'THREAD_NOT_FOUND',
        message: 'Forked thread is missing organization binding.',
      });
    }
    const organizationId = forkedMetadata.organizationId;
    if (args.organizationId !== organizationId) {
      throw new ConvexError({
        code: 'ORG_MISMATCH',
        message: 'organizationId does not match forked-thread org.',
      });
    }

    const { userId, email, name } = await requireOrgMembershipById(
      ctx,
      organizationId,
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

    // Start agent generation on the forked thread with the user's first message
    const { streamId } = await ctx.runMutation(
      internal.agents.start_chat.startChat,
      {
        threadId: newThreadId,
        organizationId,
        userId,
        userEmail: email,
        userName: name,
        message: args.message,
        userContext: args.userContext,
        agentConfig,
        agentSlug: args.agentSlug,
        attachments: args.attachments,
      },
    );

    return { threadId: newThreadId, streamId };
  },
});
