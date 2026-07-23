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
 * which the `react-to-discussion-mention` workflow turns into that agent's
 * reply — the same event-driven routing task comments use — with a direct
 * fallback dispatch when no such automation is live (`mention_dispatch.ts`,
 * #2637). The `agentReplyDepth` loop guard bounds runaway agent→agent chatter
 * (reset by any human reply in the user-facing `postReply`).
 */

import { createThread, saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import {
  DEFAULT_DISCUSSION_CATEGORY,
  DISCUSSION_MESSAGE_MAX,
  DISCUSSION_TITLE_MAX,
  isDiscussionKind,
  MAX_AGENT_REPLY_CHAIN_DEPTH,
} from '../../lib/shared/constants/discussions';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import { notifyDiscussionMentions } from '../collab/notify';
import { emitEvent } from '../events/emit';
import { buildMentionDirectory } from '../tasks/directory';
import { extractMentions, type ResolvedMention } from '../tasks/mentions';
import { dispatchAgentMentionRuns } from './mention_dispatch';

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

/** Trim + bound-check a discussion title; throws on empty/over-length. */
function assertValidTitle(raw: string): string {
  const title = raw.trim();
  if (title.length === 0 || title.length > DISCUSSION_TITLE_MAX) {
    throw new ConvexError({ code: 'DISCUSSION_TITLE_INVALID' });
  }
  return title;
}

/** Trim + bound-check a discussion message body; throws on empty/over-length. */
function assertValidBody(raw: string): string {
  const body = raw.trim();
  if (body.length === 0 || body.length > DISCUSSION_MESSAGE_MAX) {
    throw new ConvexError({ code: 'DISCUSSION_MESSAGE_INVALID' });
  }
  return body;
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
  if (!isDiscussionKind(meta.kind)) {
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

/**
 * Emit `discussion.mentioned` for an agent/workflow-authored post when it
 * @mentions anyone. No-op for an empty mention set, keeping the two write paths
 * (`agentOpenDiscussion` / `agentReplyToDiscussion`) free of repeated emit code.
 */
async function emitMentionedEvent(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    actorId: string;
    threadId: string;
    projectId: Id<'projects'> | undefined;
    mentions: ResolvedMention[];
  },
): Promise<void> {
  if (args.mentions.length === 0) return;
  const actor = eventActor(args.actorId);
  await emitEvent(ctx, {
    organizationId: args.organizationId,
    eventType: 'discussion.mentioned',
    eventData: {
      threadId: args.threadId,
      projectId: args.projectId ? String(args.projectId) : undefined,
      mentions: args.mentions,
      ...actor,
    },
  });
  // Core fallback: when no discussion-mention automation is live (fresh org
  // mid-provision — the SEEDED starter discussion posts seconds after org
  // creation — or a pack-less catalog), schedule the runs directly (#2637).
  await dispatchAgentMentionRuns(ctx, {
    organizationId: args.organizationId,
    threadId: args.threadId,
    mentions: args.mentions,
    actorType: actor.actorType,
    actorId: actor.actorId,
  });
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
    const title = assertValidTitle(args.title);
    const body = assertValidBody(args.message);

    const threadId = await createThread(ctx, components.agent, {
      userId: args.actorId,
      title,
      summary: JSON.stringify({ kind: 'project_discussion' }),
    });
    const now = Date.now();
    await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: 'assistant', content: body },
      // Attribute the opening post to its agent author so the discussion view
      // can resolve a name and align it (humans open via discussions/mutations).
      userId: args.actorId,
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
    await notifyDiscussionMentions(ctx, {
      organizationId: args.organizationId,
      threadId,
      discussionTitle: title,
      projectId: args.projectId,
      mentions,
      actorType: 'agent',
      actorId: args.actorId,
    });
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
    await emitMentionedEvent(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      threadId,
      projectId: args.projectId,
      mentions,
    });
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
    const body = assertValidBody(args.message);

    const now = Date.now();
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'assistant', content: body },
      // Attribute the reply to its agent author (slug) so the discussion view
      // resolves the agent name and left-aligns it.
      userId: args.actorId,
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
    if (meta.projectId) {
      await notifyDiscussionMentions(ctx, {
        organizationId: args.organizationId,
        threadId: args.threadId,
        discussionTitle: meta.title ?? args.threadId,
        projectId: meta.projectId,
        mentions,
        actorType: 'agent',
        actorId: args.actorId,
      });
    }
    await emitEvent(ctx, {
      organizationId: args.organizationId,
      eventType: 'discussion.reply',
      eventData: {
        threadId: args.threadId,
        projectId: meta.projectId ? String(meta.projectId) : undefined,
        ...eventActor(args.actorId),
      },
    });
    await emitMentionedEvent(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      threadId: args.threadId,
      projectId: meta.projectId,
      mentions,
    });
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
    // A discussion converts to exactly one task (the backlink is 1:1). For the
    // automation/agent path, be idempotent: a re-run returns the existing task
    // instead of creating a duplicate. (The human UI path throws instead, since
    // its convert action is already hidden once converted.)
    if (meta.linkedTaskId) {
      return { taskId: meta.linkedTaskId };
    }
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

/**
 * Post a SYSTEM-authored notice into a discussion — the visible trace of an
 * agent run that could not produce a reply (provider error, budget pause,
 * disabled agent …), so a @mention never fails silently (#2637). A notice is
 * NOT an agent turn: no mention parsing, no notifications, no events, and no
 * `agentReplyDepth` advance — it can never trigger or budget-charge anything.
 * Best-effort by design: returns `{posted:false, reason}` instead of throwing
 * so the caller's original failure result is never masked.
 */
export async function postDiscussionSystemNotice(
  ctx: MutationCtx,
  args: { organizationId: string; threadId: string; message: string },
): Promise<{ posted: boolean; reason?: string }> {
  const meta = await ctx.db
    .query('threadMetadata')
    .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
    .first();
  if (
    !meta ||
    meta.organizationId !== args.organizationId ||
    !isDiscussionKind(meta.kind)
  ) {
    return { posted: false, reason: 'discussion_not_found' };
  }
  if (meta.discussionStatus === 'locked') {
    return { posted: false, reason: 'discussion_locked' };
  }
  const body = assertValidBody(args.message);
  const now = Date.now();
  await saveMessage(ctx, components.agent, {
    threadId: args.threadId,
    message: { role: 'assistant', content: body },
    // 'system' renders left-aligned with the "System" author label — the same
    // attribution the seeded opener uses.
    userId: 'system',
  });
  await ctx.db.patch(meta._id, { updatedAt: now, lastReplyAt: now });
  return { posted: true };
}

export const systemPostDiscussionNotice = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    message: v.string(),
  },
  returns: v.object({ posted: v.boolean(), reason: v.optional(v.string()) }),
  handler: (ctx, args): Promise<{ posted: boolean; reason?: string }> =>
    postDiscussionSystemNotice(ctx, args),
});

/**
 * Create a throwaway agent thread for an isolated agent generation. Used by
 * `run_agent_on_discussion`: the agent drafts its reply in this private thread
 * (so the internal prompt never lands in the user-visible discussion), and only
 * the final text is posted to the real discussion via `agentReplyToDiscussion`.
 * The thread carries no `threadMetadata` row — it is not a discussion or chat.
 */
export const createDiscussionRunThread = internalMutation({
  args: { actorId: v.string() },
  returns: v.object({ threadId: v.string() }),
  handler: async (ctx, args): Promise<{ threadId: string }> => {
    const threadId = await createThread(ctx, components.agent, {
      userId: args.actorId,
      title: 'discussion-run (ephemeral)',
    });
    return { threadId };
  },
});
