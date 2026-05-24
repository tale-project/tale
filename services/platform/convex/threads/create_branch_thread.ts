import { createThread, saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { snapshotArtifactForBranch } from '../artifacts/snapshot_for_branch';
import { getThreadMessages } from './get_thread_messages';

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

    // Create threadMetadata for the branch (hidden from sidebar)
    await ctx.db.insert('threadMetadata', {
      threadId: branchThreadId,
      userId: args.userId,
      chatType: sourceMetadata.chatType,
      status: 'active',
      title: sourceMetadata.title,
      createdAt,
      updatedAt: createdAt,
      agentSlug: sourceMetadata.agentSlug,
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

    // Copy messages from source up to (but not including) the edited message,
    // then append the new edited message content.
    // Use getThreadMessages + saveMessage (same pattern as fork_thread.ts)
    // to guarantee correct chronological ordering. We also build a
    // parent → branch messageId map so artifact attribution can be rewritten
    // to the branch's message ids when we snapshot artifacts below.
    const { messages } = await getThreadMessages(ctx, args.sourceThreadId);
    const messageIdMap = new Map<string, string>();

    for (const msg of messages) {
      // Stop before the edited message
      if (msg._id === args.editedMessageId) break;
      const { messageId: branchMessageId } = await saveMessage(
        ctx,
        components.agent,
        {
          threadId: branchThreadId,
          userId: args.userId,
          message: {
            role: msg.role,
            content: msg.content,
          },
        },
      );
      messageIdMap.set(msg._id, branchMessageId);
    }

    // Save the edited user message and map the original edited messageId to
    // the new branch-side id (in case any artifact's createdByMessageId
    // happens to be it — unlikely, since artifacts are created by assistant
    // messages, but mapping it keeps the contract clean).
    const { messageId: editedBranchMessageId } = await saveMessage(
      ctx,
      components.agent,
      {
        threadId: branchThreadId,
        userId: args.userId,
        message: {
          role: 'user',
          content: args.newMessage,
        },
      },
    );
    messageIdMap.set(args.editedMessageId, editedBranchMessageId);

    // Snapshot artifacts whose `createdByMessageId` is in the copied set
    // into the branch thread. We capture each at its *latest in-scope
    // revision* — not the parent's current `content` — so post-fork edits
    // in the parent don't bleed into the branch.
    const parentArtifacts = await ctx.db
      .query('artifacts')
      .withIndex('by_organizationId_and_thread', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('threadId', args.sourceThreadId),
      )
      .collect();

    for (const source of parentArtifacts) {
      const mappedCreatedByMessageId = messageIdMap.get(
        source.createdByMessageId,
      );
      if (!mappedCreatedByMessageId) continue; // out of scope

      // Walk artifactRevisions oldest→newest, accept revisions whose editor
      // message is in scope (or 'user' edits, which carry no messageId but
      // by revision-order monotonicity must have happened between the
      // surrounding assistant edits). Stop at the first out-of-scope edit.
      // While walking, keep the most recent in-scope file/content snapshot
      // so we can branch at the revision the user actually forked at, not
      // the source row's current state (which may include later edits made
      // on the parent after the fork point).
      let snapshotRev:
        | {
            revision: number;
            editedByMessageId?: string;
          }
        | undefined;
      let snapshotFiles:
        | ReadonlyArray<{ path: string; content: string }>
        | undefined;
      let snapshotEntryFile: string | undefined;
      let snapshotContent: string | undefined;
      for await (const rev of ctx.db
        .query('artifactRevisions')
        .withIndex('by_artifact', (q) => q.eq('artifactId', source._id))
        .order('asc')) {
        const inScope =
          rev.editedByMessageId === undefined ||
          messageIdMap.has(rev.editedByMessageId);
        if (!inScope) break;
        snapshotRev = {
          revision: rev.revision,
          editedByMessageId: rev.editedByMessageId,
        };
        // Capture file/content state at this revision. `set_entry` rows
        // omit `files` AND `content` (only entryFile changes) — for those
        // we keep the previously-captured file state but update the entry
        // pointer. `files` and legacy `content` are mutually exclusive in
        // current writes (post-Phase A); legacy rows have only `content`.
        if (rev.files !== undefined) {
          snapshotFiles = rev.files;
          if (rev.entryFile !== undefined) snapshotEntryFile = rev.entryFile;
          // Don't carry a stale legacy `content` past a `files` revision.
          snapshotContent = undefined;
        } else if (rev.content !== undefined) {
          snapshotContent = rev.content;
          if (rev.entryFile !== undefined) snapshotEntryFile = rev.entryFile;
        } else if (rev.entryFile !== undefined) {
          // set_entry: only the entry pointer changed.
          snapshotEntryFile = rev.entryFile;
        }
      }

      const finalRevision = snapshotRev?.revision ?? source.revision;
      const mappedLastEditedByMessageId = snapshotRev?.editedByMessageId
        ? messageIdMap.get(snapshotRev.editedByMessageId)
        : undefined;

      await snapshotArtifactForBranch(ctx, {
        source,
        snapshotRevision: finalRevision,
        targetThreadId: branchThreadId,
        mappedCreatedByMessageId,
        ...(mappedLastEditedByMessageId !== undefined && {
          mappedLastEditedByMessageId,
        }),
        ...(snapshotFiles !== undefined && { revisionFiles: snapshotFiles }),
        ...(snapshotEntryFile !== undefined && {
          revisionEntryFile: snapshotEntryFile,
        }),
        ...(snapshotContent !== undefined && {
          revisionContent: snapshotContent,
        }),
      });
    }

    return { branchThreadId, forkOrder: args.editedMessageOrder };
  },
});
