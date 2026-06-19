import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mutation } from '../_generated/server';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { buildMentionDirectory } from '../tasks/directory';
import { extractMentions } from '../tasks/mentions';
import { emitEvent } from '../workflows/triggers/emit_event';

/**
 * Discussions = chat threads with `kind: 'project_discussion' | 'task_discussion'`.
 * They REUSE the @convex-dev/agent message store; the differences are (1)
 * project-member access instead of owner-only (see `can_access_thread`), (2) a
 * discussion lifecycle (open/resolved/locked), and (3) they are HUMAN-FIRST: a
 * post is always persisted, and an agent only replies when @mentioned in the
 * body (mirrors the GitHub-Discussions "bring an agent in" model).
 *
 * Agent replies are EVENT-DRIVEN, not inline-streamed: posting a message that
 * @mentions one or more agents emits a `discussion.mentioned` event, which the
 * `react-to-mention-in-discussion` workflow turns into a `run_on_discussion`
 * run PER mentioned agent — so several agents can join one discussion off a
 * single human post (a board, not a 1:1 chat). This is the exact same routing
 * agents themselves use (`discussions/internal_mutations.ts`), so human- and
 * agent-authored mentions behave identically; runaway agent→agent chains are
 * bounded by the `agentReplyDepth` loop guard (reset to 0 by any human reply).
 */

const DEFAULT_CATEGORY = 'general';

/**
 * Bring every @mentioned agent into a discussion post by emitting a single
 * `discussion.mentioned` event (the `react-to-mention-in-discussion` workflow
 * fans it out to a `run_on_discussion` run per agent mention). A post with no
 * agent mention stays a pure human message — no event, no agent summoned —
 * keeping discussions human-first. Returns the count of agent mentions.
 */
async function emitDiscussionMentions(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: Id<'projects'> | undefined;
    threadId: string;
    body: string;
    actorId: string;
  },
): Promise<number> {
  if (!args.projectId) return 0;
  const project = await ctx.db.get(args.projectId);
  if (!project) return 0;
  const directory = await buildMentionDirectory(ctx, {
    organizationId: args.organizationId,
    project,
  });
  const mentions = extractMentions(
    args.body,
    directory.entries,
    directory.permissiveAgents,
  );
  const agentMentions = mentions.filter((m) => m.type === 'agent');
  if (agentMentions.length === 0) return 0;
  await emitEvent(ctx, {
    organizationId: args.organizationId,
    eventType: 'discussion.mentioned',
    eventData: {
      threadId: args.threadId,
      projectId: String(args.projectId),
      // Pass the full mention set; the workflow filters to agent mentions and
      // skips self-mentions. `actorType: 'user'` clears the workflow-actor
      // guard (only automation-authored writes are inert).
      mentions,
      actorType: 'user',
      actorId: args.actorId,
    },
  });
  return agentMentions.length;
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
  returns: v.object({ threadId: v.string(), mentionCount: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; mentionCount: number }> => {
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
      discussionCategory: args.category ?? DEFAULT_CATEGORY,
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
    const mentionCount = await emitDiscussionMentions(ctx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      threadId,
      body: args.message,
      actorId: authUser.userId,
    });
    return { threadId, mentionCount };
  },
});

/** Post a reply into an existing discussion (any project member). */
export const postReply = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    message: v.string(),
  },
  returns: v.object({ mentionCount: v.number() }),
  handler: async (ctx, args): Promise<{ mentionCount: number }> => {
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

    const mentionCount = await emitDiscussionMentions(ctx, {
      organizationId: args.organizationId,
      projectId: meta.projectId ?? undefined,
      threadId: args.threadId,
      body: args.message,
      actorId: authUser.userId,
    });
    return { mentionCount };
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
