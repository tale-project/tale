import { v } from 'convex/values';

import { discussionActivityAt } from '../../lib/shared/constants/discussions';
import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Read side of Discussions. The message transcript itself is fetched through
 * the existing `threads.getThreadMessagesStreaming` (the same streaming reader
 * chat uses) keyed by the discussion's threadId — `can_access_thread` now
 * grants project members access, so no discussion-specific transcript reader is
 * needed.
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
