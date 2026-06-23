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

    // Load the source messages first — we need them both to copy the pre-fork
    // history AND to stamp the fork-point timestamp on the branch record.
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

    // The fork point as a TIMESTAMP — the `_creationTime` of the message at
    // `editedMessageOrder`. The pane queries cut each ancestor's artifacts at
    // this instant so files the parent wrote AFTER the branch split off don't
    // leak onto the branch. Fall back to the highest pre-fork message time (or
    // the branch's own `createdAt`) if the exact boundary message isn't found —
    // a missing value just means "no cut" downstream, never a crash.
    const forkOrderCreatedAt =
      ordered.find((m) => m.order === args.editedMessageOrder)?._creationTime ??
      ordered
        .filter((m) => m.order < args.editedMessageOrder)
        .reduce<number | undefined>(
          (max, m) =>
            max === undefined || m._creationTime > max ? m._creationTime : max,
          undefined,
        ) ??
      createdAt;

    // Create threadBranches record
    await ctx.db.insert('threadBranches', {
      rootThreadId: args.rootThreadId,
      branchThreadId,
      parentThreadId: args.sourceThreadId,
      forkAfterMessageId: args.editedMessageId,
      forkOrder: args.editedMessageOrder,
      forkOrderCreatedAt,
      branchIndex: branchCount + 1,
      createdAt,
    });

    // Copy every source message strictly before the edited message's turn,
    // preserving the FULL model content, then append the new edited user message.
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
