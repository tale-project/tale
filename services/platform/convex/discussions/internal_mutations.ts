/**
 * Discussions — agent/workflow-actor internal mutations.
 *
 * The public `discussions/mutations.ts` are USER-authenticated (a human posts).
 * These internal variants attribute the write to an AGENT (or the `workflow`
 * actor), so the `discussion` workflow action and the `discussion_write` agent
 * tool can open discussions, post replies, resolve/lock them, and spawn tasks —
 * exactly mirroring the `agent*` task mutations in `tasks/internal_mutations.ts`.
 *
 * Posting a reply that @mentions another agent emits `discussion.mentioned`,
 * which the `react-to-mention-in-discussion` workflow turns into that agent's
 * reply — the same event-driven routing task comments use. The `agentReplyDepth`
 * loop guard bounds runaway agent→agent chatter (reset by any human reply in
 * the user-facing `postReply`).
 */

import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import {
  DEFAULT_DISCUSSION_CATEGORY,
  DISCUSSION_MESSAGE_MAX,
  DISCUSSION_TITLE_MAX,
  MAX_AGENT_REPLY_CHAIN_DEPTH,
} from '../../lib/shared/constants/discussions';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import { buildMentionDirectory } from '../tasks/directory';
import { extractMentions, type ResolvedMention } from '../tasks/mentions';
import { emitEvent } from '../workflows/triggers/emit_event';

/** Actor attribution for emitted events (agent slug, or the `workflow` sentinel). */
function eventActor(actorId: string): {
  actorType: 'agent' | 'workflow';
  actorId: string;
} {
  return {
    actorType: actorId === 'workflow' ? 'workflow' : 'agent',
    actorId,
  };
}

async function loadDiscussionMeta(
  ctx: MutationCtx,
  threadId: string,
  organizationId: string,
): Promise<Doc<'threadMetadata'>> {
  const meta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
    .first();
  if (!meta || meta.organizationId !== organizationId) {
    throw new ConvexError({ code: 'DISCUSSION_NOT_FOUND' });
  }
  if (meta.kind !== 'project_discussion' && meta.kind !== 'task_discussion') {
    throw new ConvexError({ code: 'NOT_A_DISCUSSION' });
  }
  return meta;
}

/** Resolve @mentions in a discussion body against its project directory. */
async function resolveDiscussionMentions(
  ctx: MutationCtx,
  organizationId: string,
  projectId: Id<'projects'> | undefined,
  body: string,
): Promise<ResolvedMention[]> {
  if (!projectId) return [];
  const project = await ctx.db.get(projectId);
  if (!project) return [];
  const directory = await buildMentionDirectory(ctx, {
    organizationId,
    project,
  });
  return extractMentions(body, directory.entries, directory.permissiveAgents);
}

/** Open a new project discussion authored by an agent (no human owner). */
export const agentOpenDiscussion = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    message: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; mentionCount: number }> => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== args.organizationId) {
      throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
    }
    const title = args.title.trim();
    const body = args.message.trim();
    if (title.length === 0 || title.length > DISCUSSION_TITLE_MAX) {
      throw new ConvexError({ code: 'DISCUSSION_TITLE_INVALID' });
    }
    if (body.length === 0 || body.length > DISCUSSION_MESSAGE_MAX) {
      throw new ConvexError({ code: 'DISCUSSION_MESSAGE_INVALID' });
    }

    const threadId = await createThread(ctx, components.agent, {
      userId: args.actorId,
      title,
      summary: JSON.stringify({ kind: 'project_discussion' }),
    });
    const now = Date.now();
    await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'assistant', content: body },
    });
    await ctx.db.insert('threadMetadata', {
      threadId,
      userId: args.actorId,
      chatType: 'general',
      status: 'active',
      kind: 'project_discussion',
      projectId: args.projectId,
      discussionStatus: 'open',
      discussionCategory: args.category ?? DEFAULT_DISCUSSION_CATEGORY,
      organizationId: args.organizationId,
      title,
      createdAt: now,
      updatedAt: now,
      lastReplyAt: now,
      agentReplyDepth: 0,
    });

    const mentions = await resolveDiscussionMentions(
      ctx,
      args.organizationId,
      args.projectId,
      body,
    );
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'discussion.created',
      eventData: {
        threadId,
        projectId: String(args.projectId),
        category: args.category ?? DEFAULT_DISCUSSION_CATEGORY,
        ...eventActor(args.actorId),
      },
    });
    if (mentions.length > 0) {
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'discussion.mentioned',
        eventData: {
          threadId,
          projectId: String(args.projectId),
          mentions,
          ...eventActor(args.actorId),
        },
      });
    }
    return { threadId, mentionCount: mentions.length };
  },
});

/**
 * Post an agent-authored reply into an existing discussion. Loop-guarded by
 * `agentReplyDepth` so an agent→agent mention chain can't run away. Returns
 * `{ posted: false, reason }` (not a throw) when locked or depth-capped so the
 * caller can stop gracefully.
 */
export const agentReplyToDiscussion = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    threadId: v.string(),
    message: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ posted: boolean; reason?: string; mentionCount: number }> => {
    const meta = await loadDiscussionMeta(
      ctx,
      args.threadId,
      args.organizationId,
    );
    if (meta.discussionStatus === 'locked') {
      return { posted: false, reason: 'discussion_locked', mentionCount: 0 };
    }
    const depth = meta.agentReplyDepth ?? 0;
    if (depth >= MAX_AGENT_REPLY_CHAIN_DEPTH) {
      return {
        posted: false,
        reason: 'reply_chain_depth_exceeded',
        mentionCount: 0,
      };
    }
    const body = args.message.trim();
    if (body.length === 0 || body.length > DISCUSSION_MESSAGE_MAX) {
      throw new ConvexError({ code: 'DISCUSSION_MESSAGE_INVALID' });
    }

    const now = Date.now();
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'assistant', content: body },
    });
    await ctx.db.patch(meta._id, {
      updatedAt: now,
      lastReplyAt: now,
      // An agent-authored reply advances the loop-guard counter; a human reply
      // resets it back to 0 in the user-facing `postReply` mutation.
      agentReplyDepth: depth + 1,
    });

    const mentions = await resolveDiscussionMentions(
      ctx,
      args.organizationId,
      meta.projectId,
      body,
    );
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'discussion.reply',
      eventData: {
        threadId: args.threadId,
        projectId: meta.projectId ? String(meta.projectId) : undefined,
        ...eventActor(args.actorId),
      },
    });
    if (mentions.length > 0) {
      await emitEvent(ctx, {
        organizationId: args.organizationId,
        eventType: 'discussion.mentioned',
        eventData: {
          threadId: args.threadId,
          projectId: meta.projectId ? String(meta.projectId) : undefined,
          mentions,
          ...eventActor(args.actorId),
        },
      });
    }
    return { posted: true, mentionCount: mentions.length };
  },
});

/** Set discussion lifecycle (resolve / reopen / lock) as an agent/workflow. */
export const agentSetDiscussionStatus = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    threadId: v.string(),
    status: v.union(
      v.literal('open'),
      v.literal('resolved'),
      v.literal('locked'),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const meta = await loadDiscussionMeta(
      ctx,
      args.threadId,
      args.organizationId,
    );
    await ctx.db.patch(meta._id, {
      discussionStatus: args.status,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Spawn a task from a discussion with a bidirectional backlink. */
export const agentSpawnTaskFromDiscussion = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    threadId: v.string(),
    projectId: v.id('projects'),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ taskId: Id<'tasks'> }> => {
    const meta = await loadDiscussionMeta(
      ctx,
      args.threadId,
      args.organizationId,
    );
    const { taskId } = await ctx.runMutation(
      internal.tasks.internal_mutations.agentCreateTask,
      {
        organizationId: args.organizationId,
        actorId: args.actorId,
        projectId: args.projectId,
        title: args.title,
        description: args.description,
      },
    );
    await ctx.db.patch(taskId, { sourceDiscussionThreadId: args.threadId });
    await ctx.db.patch(meta._id, {
      linkedTaskId: taskId,
      updatedAt: Date.now(),
    });
    return { taskId };
  },
});
