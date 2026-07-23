import { v } from 'convex/values';

import { discussionActivityAt } from '../../lib/shared/constants/discussions';
import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { getThreadMessages } from '../threads/get_thread_messages';

/**
 * Read side of Discussions. Summaries come from `threadMetadata`; the
 * transcript comes from `listDiscussionMessages`, which reads the agent
 * message-store by the discussion's threadId — `can_access_thread` grants
 * project members access, so both sides share one auth gate.
 */

const discussionSummaryValidator = v.object({
  threadId: v.string(),
  title: v.optional(v.string()),
  discussionCategory: v.optional(v.string()),
  discussionStatus: v.optional(
    v.union(v.literal('open'), v.literal('resolved'), v.literal('locked')),
  ),
  userId: v.string(),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  lastReplyAt: v.optional(v.number()),
  pinnedAt: v.optional(v.number()),
  linkedTaskId: v.optional(v.id('tasks')),
});

type DiscussionSummary = typeof discussionSummaryValidator.type;

/** Project a `threadMetadata` row into the user-facing discussion summary. */
function toDiscussionSummary(meta: Doc<'threadMetadata'>): DiscussionSummary {
  return {
    threadId: meta.threadId,
    title: meta.title,
    discussionCategory: meta.discussionCategory,
    discussionStatus: meta.discussionStatus,
    userId: meta.userId,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    lastReplyAt: meta.lastReplyAt,
    pinnedAt: meta.pinnedAt,
    linkedTaskId: meta.linkedTaskId,
  };
}

/** List a project's discussions (any org member), newest activity first. */
export const listProjectDiscussions = query({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    category: v.optional(v.string()),
  },
  returns: v.array(discussionSummaryValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (!member) return [];

    const rows: DiscussionSummary[] = [];
    for await (const meta of ctx.db
      .query('threadMetadata')
      .withIndex('by_kind_projectId', (q) =>
        q.eq('kind', 'project_discussion').eq('projectId', args.projectId),
      )) {
      if (meta.organizationId !== args.organizationId) continue;
      if (meta.status !== 'active') continue;
      if (args.category && meta.discussionCategory !== args.category) continue;
      rows.push(toDiscussionSummary(meta));
    }
    // Pinned first, then most-recent activity.
    rows.sort((a, b) => {
      if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
      return discussionActivityAt(b) - discussionActivityAt(a);
    });
    return rows;
  },
});

/**
 * The most recent messages a single transcript read returns. Discussions are
 * human-paced (task comments share the same 500 cap) — a thread long enough to
 * hit this keeps its newest tail, which is where the conversation lives.
 */
const DISCUSSION_MESSAGES_CAP = 500;

const discussionMessageValidator = v.object({
  /** Agent message-store id — an opaque string, not a Convex document id. */
  messageId: v.string(),
  /** Message role as stored. Alignment must key off `authorId`, not this —
   *  the opening post is stored `role:'assistant'` yet human-authored. */
  role: v.union(v.literal('user'), v.literal('assistant')),
  /** Better Auth userId, agent slug, or `'system'`; absent on legacy rows. */
  authorId: v.optional(v.string()),
  body: v.string(),
  createdAt: v.number(),
});

export type DiscussionMessage = typeof discussionMessageValidator.type;

/**
 * A discussion's transcript, oldest first (project member access via
 * canAccessThread). Returns [] rather than throwing for missing access so the
 * view degrades like the other discussion reads.
 */
export const listDiscussionMessages = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.array(discussionMessageValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const meta = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!meta) return [];

    const { messages } = await getThreadMessages(ctx, args.threadId);
    return messages.slice(-DISCUSSION_MESSAGES_CAP).map((msg) => {
      const row: DiscussionMessage = {
        messageId: msg._id,
        role: msg.role,
        body: msg.content,
        createdAt: msg._creationTime,
      };
      if (msg.userId !== undefined) row.authorId = msg.userId;
      return row;
    });
  },
});

/** Get one discussion's metadata (project member access via canAccessThread). */
export const getDiscussion = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(discussionSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;
    const meta = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!meta) return null;
    return toDiscussionSummary(meta);
  },
});
