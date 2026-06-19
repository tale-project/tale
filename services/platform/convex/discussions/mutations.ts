import { createThread } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { AUTO_AGENT_SLUG } from '../../lib/shared/constants/agents';
import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { persistentStreaming } from '../streaming/helpers';
import { cancelGeneration } from '../threads/cancel_generation';

/**
 * Discussions = chat threads with `kind: 'project_discussion' | 'task_discussion'`.
 * They REUSE the @convex-dev/agent message store and the chat generation action
 * (`runChatTurnGeneration`); the only differences are (1) project-member access
 * instead of owner-only (see `can_access_thread`), and (2) a discussion
 * lifecycle (open/resolved/locked). Posting a reply that @mentions an agent
 * drives the same routing + generation as chat.
 */

const DEFAULT_CATEGORY = 'general';

/** Open a new project discussion with an initial message (optionally @an agent). */
export const createDiscussion = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    message: v.string(),
    category: v.optional(v.string()),
    /** Agent to route the opening message to; defaults to Auto. */
    agentSlug: v.optional(v.string()),
  },
  returns: v.object({ threadId: v.string(), streamId: v.string() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'forbidden' });
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = await createThread(ctx, components.agent, {
      userId: authUser.userId,
      title: args.title,
      summary: JSON.stringify({ kind: 'project_discussion' }),
    });
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });
    const createdAt = thread?._creationTime ?? Date.now();
    const streamId = await persistentStreaming.createStream(ctx);
    const agentSlug = args.agentSlug ?? AUTO_AGENT_SLUG;

    await ctx.db.insert('threadMetadata', {
      threadId,
      userId: authUser.userId,
      chatType: 'general',
      status: 'active',
      kind: 'project_discussion',
      projectId: args.projectId,
      discussionStatus: 'open',
      discussionCategory: args.category ?? DEFAULT_CATEGORY,
      organizationId: args.organizationId,
      title: args.title,
      createdAt,
      updatedAt: createdAt,
      generationStatus: 'generating',
      streamId,
      generationStartTime: Date.now(),
      agentReplyDepth: 0,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.agents.chat_turn_generate.runChatTurnGeneration,
      {
        agentSlug,
        organizationId: args.organizationId,
        message: args.message,
        projectId: args.projectId,
        threadId,
        streamId,
        userId: authUser.userId,
        userEmail: authUser.email ?? '',
        userName: authUser.name ?? '',
        requestStartMs: Date.now(),
      },
    );
    return { threadId, streamId };
  },
});

/** Post a reply into an existing discussion (any project member). */
export const postReply = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    message: v.string(),
    agentSlug: v.optional(v.string()),
  },
  returns: v.object({ streamId: v.string() }),
  handler: async (ctx, args): Promise<{ streamId: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'forbidden' });
    const meta = await assertThreadAccess(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (meta.kind !== 'project_discussion' && meta.kind !== 'task_discussion') {
      throw new ConvexError({ code: 'not_a_discussion' });
    }
    if (meta.discussionStatus === 'locked') {
      throw new ConvexError({
        code: 'discussion_locked',
        message: 'This discussion is locked.',
      });
    }

    if (meta.generationStatus === 'generating' && meta.streamId) {
      await cancelGeneration(ctx, meta.userId, args.threadId);
    }
    const streamId = await persistentStreaming.createStream(ctx);
    await ctx.db.patch(meta._id, {
      generationStatus: 'generating',
      streamId,
      generationStartTime: Date.now(),
      updatedAt: Date.now(),
      // A human reply resets the agent→agent reply-chain counter (loop guard).
      agentReplyDepth: 0,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.agents.chat_turn_generate.runChatTurnGeneration,
      {
        agentSlug: args.agentSlug ?? AUTO_AGENT_SLUG,
        organizationId: args.organizationId,
        message: args.message,
        projectId: meta.projectId ?? undefined,
        threadId: args.threadId,
        streamId,
        userId: authUser.userId,
        userEmail: authUser.email ?? '',
        userName: authUser.name ?? '',
        requestStartMs: Date.now(),
      },
    );
    return { streamId };
  },
});

/** Set discussion lifecycle: resolve / reopen / lock / unlock. */
export const setDiscussionStatus = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    status: v.union(
      v.literal('open'),
      v.literal('resolved'),
      v.literal('locked'),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'forbidden' });
    const meta = await assertThreadAccess(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    await ctx.db.patch(meta._id, {
      discussionStatus: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Spawn a task from a discussion, with a bidirectional backlink. */
export const createTaskFromDiscussion = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.object({ taskId: v.id('tasks') }),
  handler: async (ctx, args): Promise<{ taskId: Id<'tasks'> }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'forbidden' });
    const meta = await assertThreadAccess(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    const { taskId } = await ctx.runMutation(
      internal.tasks.internal_mutations.agentCreateTask,
      {
        organizationId: args.organizationId,
        actorId: authUser.userId,
        projectId: args.projectId,
        title: args.title,
        description: args.description,
      },
    );
    // Bidirectional backlink: task → source discussion, discussion → task.
    await ctx.db.patch(taskId, { sourceDiscussionThreadId: args.threadId });
    await ctx.db.patch(meta._id, {
      linkedTaskId: taskId,
      updatedAt: Date.now(),
    });
    return { taskId };
  },
});
