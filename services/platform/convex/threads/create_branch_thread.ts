import {
  createThread,
  listMessages,
  saveMessage,
  type MessageDoc,
} from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

export const createBranchThread = internalMutation({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    sourceThreadId: v.string(),
    rootThreadId: v.string(),
    editedMessageId: v.string(),
    editedMessageOrder: v.number(),
    newMessage: v.string(),
  },
  returns: v.object({
    branchThreadId: v.string(),
    forkOrder: v.number(),
  }),
  handler: async (ctx, args) => {
    const sourceMetadata = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.sourceThreadId))
      .first();

    if (!sourceMetadata) {
      throw new Error('Source thread not found');
    }

    if (sourceMetadata.userId !== args.userId) {
      throw new Error('Not authorized to branch this thread');
    }

    // Count existing branches at this fork point for branchIndex
    let branchCount = 0;
    const existingBranches = ctx.db
      .query('threadBranches')
      .withIndex('by_parentThreadId_forkAfterMessageId', (q) =>
        q
          .eq('parentThreadId', args.sourceThreadId)
          .eq('forkAfterMessageId', args.editedMessageId),
      );
    for await (const _ of existingBranches) {
      branchCount++;
    }

    // Create new SDK thread
    const branchThreadId = await createThread(ctx, components.agent, {
      userId: args.userId,
      title: sourceMetadata.title ?? 'New Chat',
      summary: JSON.stringify({ chatType: sourceMetadata.chatType }),
    });

    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: branchThreadId,
    });
    const createdAt = thread?._creationTime ?? Date.now();

    // Create threadMetadata for the branch (hidden from sidebar). Persist
    // `organizationId` so the branch is correctly org-scoped for retention,
    // listing, and cross-tenant filtering — without it `getThreadMetadata`
    // returns null on every callerOrgId check and the branch orphans.
    await ctx.db.insert('threadMetadata', {
      threadId: branchThreadId,
      userId: args.userId,
      chatType: sourceMetadata.chatType,
      status: 'active',
      title: sourceMetadata.title,
      createdAt,
      updatedAt: createdAt,
      agentSlug: sourceMetadata.agentSlug,
      organizationId: args.organizationId,
      isBranch: true,
      forkedFrom: args.sourceThreadId,
      ...(sourceMetadata.teamId && { teamId: sourceMetadata.teamId }),
    });

    // Create threadBranches record
    await ctx.db.insert('threadBranches', {
      rootThreadId: args.rootThreadId,
      branchThreadId,
      parentThreadId: args.sourceThreadId,
      forkAfterMessageId: args.editedMessageId,
      forkOrder: args.editedMessageOrder,
      branchIndex: branchCount + 1,
      createdAt,
    });

    // Copy every source message strictly before the edited message's turn,
    // preserving the FULL model content (reasoning blocks + tool calls/results),
    // then append the new edited user message.
    //
    // We iterate the RAW agent messages (not the flattened text from
    // getThreadMessages): the previous copy saved only `{ role, content: text }`,
    // which dropped each turn's reasoning/tool parts. After a mid-thread edit
    // that left every prior assistant turn on the branch with no thought-process
    // timeline. Copying the raw model messages (tool messages included, in
    // (order, stepOrder) sequence so tool-call/tool-result pairs stay adjacent)
    // also hands the regeneration a faithful, non-lossy history.
    const sourceMessages: MessageDoc[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page = await listMessages(ctx, components.agent, {
        threadId: args.sourceThreadId,
        paginationOpts: { cursor, numItems: 100 },
      });
      sourceMessages.push(...page.page);
      cursor = page.continueCursor;
      isDone = page.isDone;
    }
    // listMessages returns newest-first; copy oldest-first.
    const ordered = [...sourceMessages].sort((a, b) =>
      a.order === b.order ? a.stepOrder - b.stepOrder : a.order - b.order,
    );
    for (const doc of ordered) {
      // Everything from the edited turn onward is dropped (the branch
      // regenerates from the edit point).
      if (doc.order >= args.editedMessageOrder) break;
      if (!doc.message) continue;
      await saveMessage(ctx, components.agent, {
        threadId: branchThreadId,
        userId: args.userId,
        message: doc.message,
      });
    }

    // Save the edited user message — the new fork point the branch regenerates
    // off.
    await saveMessage(ctx, components.agent, {
      threadId: branchThreadId,
      userId: args.userId,
      message: {
        role: 'user',
        content: args.newMessage,
      },
    });

    return { branchThreadId, forkOrder: args.editedMessageOrder };
  },
});
