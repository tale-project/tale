import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { persistentStreaming } from '../streaming/helpers';
import { buildMentionDirectory } from '../tasks/directory';
import { extractMentions } from '../tasks/mentions';
import { cancelGeneration } from '../threads/cancel_generation';

/**
 * Discussions = chat threads with `kind: 'project_discussion' | 'task_discussion'`.
 * They REUSE the @convex-dev/agent message store and the chat generation action
 * (`runChatTurnGeneration`); the differences are (1) project-member access
 * instead of owner-only (see `can_access_thread`), (2) a discussion lifecycle
 * (open/resolved/locked), and (3) they are HUMAN-FIRST: a post is always
 * persisted, and an agent only replies when one is explicitly chosen or
 * @mentioned in the body (mirrors the GitHub-Discussions "bring an agent in"
 * model). Generation, when triggered, reuses the chat turn with
 * `queuedPromptMessageId` so it never re-saves the already-persisted message.
 */

const DEFAULT_CATEGORY = 'general';

/**
 * Which agent (if any) should reply to a discussion post: an explicit
 * `agentSlug` wins, otherwise the first agent @mentioned in the body. Returns
 * `undefined` for a pure human post (no generation). Mention resolution reuses
 * the project mention directory (members + agents).
 */
async function resolveDiscussionAgent(
  ctx: MutationCtx,
  organizationId: string,
  projectId: Id<'projects'> | undefined,
  message: string,
  explicitAgentSlug: string | undefined,
): Promise<string | undefined> {
  if (explicitAgentSlug) return explicitAgentSlug;
  if (!projectId) return undefined;
  const project = await ctx.db.get(projectId);
  if (!project) return undefined;
  const directory = await buildMentionDirectory(ctx, {
    organizationId,
    project,
  });
  const mentions = extractMentions(
    message,
    directory.entries,
    directory.permissiveAgents,
  );
  return mentions.find((m) => m.type === 'agent')?.id;
}

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
    const createdAt = Date.now();

    // Always persist the human's opening post — independent of whether an agent
    // replies — so a discussion never loses the message it was started with.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: args.message },
      userId: authUser.userId,
    });

    const agentSlug = await resolveDiscussionAgent(
      ctx,
      args.organizationId,
      args.projectId,
      args.message,
      args.agentSlug,
    );
    const streamId = agentSlug
      ? await persistentStreaming.createStream(ctx)
      : '';

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
      lastReplyAt: createdAt,
      generationStatus: agentSlug ? 'generating' : 'idle',
      ...(agentSlug ? { streamId, generationStartTime: createdAt } : {}),
      agentReplyDepth: 0,
    });

    // An agent only replies when one was @mentioned / explicitly chosen. The
    // message is already saved, so generation drains it via queuedPromptMessageId
    // instead of re-saving.
    if (agentSlug) {
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
          queuedPromptMessageId: messageId,
        },
      );
    }
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

    // Always persist the human reply first.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'user', content: args.message },
      userId: authUser.userId,
    });

    const agentSlug = await resolveDiscussionAgent(
      ctx,
      args.organizationId,
      meta.projectId ?? undefined,
      args.message,
      args.agentSlug,
    );
    const now = Date.now();
    const streamId = agentSlug
      ? await persistentStreaming.createStream(ctx)
      : '';

    await ctx.db.patch(meta._id, {
      generationStatus: agentSlug ? 'generating' : 'idle',
      ...(agentSlug ? { streamId, generationStartTime: now } : {}),
      updatedAt: now,
      lastReplyAt: now,
      // A human reply resets the agent→agent reply-chain counter (loop guard).
      agentReplyDepth: 0,
    });

    if (agentSlug) {
      await ctx.scheduler.runAfter(
        0,
        internal.agents.chat_turn_generate.runChatTurnGeneration,
        {
          agentSlug,
          organizationId: args.organizationId,
          message: args.message,
          projectId: meta.projectId ?? undefined,
          threadId: args.threadId,
          streamId,
          userId: authUser.userId,
          userEmail: authUser.email ?? '',
          userName: authUser.name ?? '',
          requestStartMs: Date.now(),
          queuedPromptMessageId: messageId,
        },
      );
    }
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
