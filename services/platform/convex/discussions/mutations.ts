import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import {
  DEFAULT_DISCUSSION_CATEGORY,
  isDiscussionKind,
} from '../../lib/shared/constants/discussions';
import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { notifyDiscussionMentions } from '../collab/notify';
import { resolveSurfaceMentions } from '../collab/resolve_surface_mentions';
import { emitEvent } from '../events/emit';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import type { AuthenticatedUser } from '../lib/rls/types';

const mentionResultValidator = v.object({
  mentionCount: v.number(),
  unresolvedMentionTokens: v.array(v.string()),
});

/**
 * Discussions = chat threads with `kind: 'project_discussion' | 'task_discussion'`.
 * They REUSE the @convex-dev/agent message store; the differences are (1)
 * project-member access instead of owner-only (see `can_access_thread`), (2) a
 * discussion lifecycle (open/resolved/locked), and (3) they are HUMAN-FIRST: a
 * post is always persisted, and an agent only replies when @mentioned in the
 * body (mirrors the GitHub-Discussions "bring an agent in" model).
 *
 * Agent replies are EVENT-DRIVEN, not inline-streamed: posting a message that
 * @mentions one or more agents emits a `discussion.mentioned` event, which
 * the automations rewrite will turn into one agent run PER mentioned agent —
 * so several agents can join one discussion off a single human post (a
 * board, not a 1:1 chat). The event seam is the single dispatch route (the
 * old workflow-engine direct-dispatch fallback died with its tables), and it
 * is a logged no-op until that rewrite lands. This is the exact same routing
 * agents themselves use (`discussions/internal_mutations.ts`), so human- and
 * agent-authored mentions behave identically; runaway agent→agent chains are
 * bounded by the `agentReplyDepth` loop guard (reset to 0 by any human reply).
 */

/**
 * Authorize a discussion write: the caller must be able to access the thread
 * (org membership / sharing, via `assertThreadAccess`) AND it must actually be
 * a discussion — never a private `chat` thread. Mirrors `loadDiscussionMeta` in
 * `internal_mutations.ts` so the user- and agent-authored write paths apply the
 * same gate (a holder of a chat-thread URL can't drive it through this API).
 */
async function assertDiscussionAccess(
  ctx: MutationCtx,
  threadId: string,
  authUser: AuthenticatedUser,
  organizationId: string,
) {
  const meta = await assertThreadAccess(
    ctx,
    threadId,
    authUser,
    organizationId,
  );
  if (!isDiscussionKind(meta.kind)) {
    throw new ConvexError({ code: 'not_a_discussion' });
  }
  return meta;
}

/**
 * Resolve @mentions in a discussion post, notify mentioned humans (in-app +
 * email), and emit `discussion.mentioned` for agent routing. Returns the count
 * of agent mentions (for callers that surface it).
 */
async function handleDiscussionMentions(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: Id<'projects'> | undefined;
    threadId: string;
    discussionTitle: string;
    body: string;
    actorType: 'user' | 'agent';
    actorId: string;
  },
): Promise<{ mentionCount: number; unresolvedMentionTokens: string[] }> {
  if (!args.projectId) {
    return { mentionCount: 0, unresolvedMentionTokens: [] };
  }
  const { mentions, unresolvedMentionTokens } = await resolveSurfaceMentions(
    ctx,
    {
      organizationId: args.organizationId,
      body: args.body,
      projectId: args.projectId,
    },
  );

  await notifyDiscussionMentions(ctx, {
    organizationId: args.organizationId,
    threadId: args.threadId,
    discussionTitle: args.discussionTitle,
    projectId: args.projectId,
    mentions,
    actorType: args.actorType,
    actorId: args.actorId,
  });

  const agentMentions = mentions.filter((m) => m.type === 'agent');
  if (agentMentions.length === 0) {
    return { mentionCount: 0, unresolvedMentionTokens };
  }
  await emitEvent(ctx, {
    organizationId: args.organizationId,
    eventType: 'discussion.mentioned',
    eventData: {
      threadId: args.threadId,
      projectId: String(args.projectId),
      mentions,
      actorType: args.actorType,
      actorId: args.actorId,
    },
  });
  return { mentionCount: agentMentions.length, unresolvedMentionTokens };
}

/** Open a new project discussion with an initial message (optionally @an agent). */
export const createDiscussion = mutation({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    message: v.string(),
    category: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    mentionCount: v.number(),
    unresolvedMentionTokens: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    threadId: string;
    mentionCount: number;
    unresolvedMentionTokens: string[];
  }> => {
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
    await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'user', content: args.message },
      userId: authUser.userId,
    });

    await ctx.db.insert('threadMetadata', {
      threadId,
      userId: authUser.userId,
      chatType: 'general',
      status: 'active',
      kind: 'project_discussion',
      projectId: args.projectId,
      discussionStatus: 'open',
      discussionCategory: args.category ?? DEFAULT_DISCUSSION_CATEGORY,
      organizationId: args.organizationId,
      title: args.title,
      createdAt,
      updatedAt: createdAt,
      lastReplyAt: createdAt,
      generationStatus: 'idle',
      agentReplyDepth: 0,
    });

    // Bring in every @mentioned agent (event-driven; see module header). A post
    // with no agent mention summons no one — discussions are human-first.
    const { mentionCount, unresolvedMentionTokens } =
      await handleDiscussionMentions(ctx, {
        organizationId: args.organizationId,
        projectId: args.projectId,
        threadId,
        discussionTitle: args.title,
        body: args.message,
        actorType: 'user',
        actorId: authUser.userId,
      });
    return { threadId, mentionCount, unresolvedMentionTokens };
  },
});

/** Post a reply into an existing discussion (any project member). */
export const postReply = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    message: v.string(),
  },
  returns: mentionResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<{
    mentionCount: number;
    unresolvedMentionTokens: string[];
  }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'forbidden' });
    const meta = await assertDiscussionAccess(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (meta.discussionStatus === 'locked') {
      throw new ConvexError({
        code: 'discussion_locked',
        message: 'This discussion is locked.',
      });
    }

    // Always persist the human reply first.
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'user', content: args.message },
      userId: authUser.userId,
    });

    const now = Date.now();
    await ctx.db.patch(meta._id, {
      generationStatus: 'idle',
      updatedAt: now,
      lastReplyAt: now,
      // A human reply resets the agent→agent reply-chain counter (loop guard),
      // giving every fresh human turn a clean budget of agent replies.
      agentReplyDepth: 0,
    });

    return handleDiscussionMentions(ctx, {
      organizationId: args.organizationId,
      projectId: meta.projectId ?? undefined,
      threadId: args.threadId,
      discussionTitle: meta.title ?? args.threadId,
      body: args.message,
      actorType: 'user',
      actorId: authUser.userId,
    });
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
    // A discussion converts to a task exactly once (GitHub "convert to issue"):
    // the bidirectional backlink below is 1:1, and a second conversion would
    // orphan the first task's link. The UI hides the convert action once
    // `linkedTaskId` is set; this guards the race / direct-call path.
    if (meta.linkedTaskId) {
      throw new ConvexError({
        code: 'already_converted',
        message: 'This discussion has already been converted to a task.',
      });
    }
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
