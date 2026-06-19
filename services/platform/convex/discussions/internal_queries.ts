/**
 * Discussions — internal read queries for the agent tool / workflow action.
 *
 * The user-facing reads live in `discussions/queries.ts`; these org-scoped
 * variants skip the per-request auth handshake (the caller — a workflow action
 * or an agent tool already bound to an organization — has been authorized
 * upstream) and are shaped for machine consumption.
 */

import { v } from 'convex/values';

import {
  discussionActivityAt,
  isDiscussionKind,
} from '../../lib/shared/constants/discussions';
import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';

interface DiscussionSummary {
  threadId: string;
  title?: string;
  discussionCategory?: string;
  discussionStatus?: 'open' | 'resolved' | 'locked';
  createdAt: number;
  updatedAt?: number;
  lastReplyAt?: number;
  linkedTaskId?: string;
  /** Agent→agent reply-chain depth (loop guard). Lets callers pre-check the
   *  cap before spending a generation on a reply that would be refused. */
  agentReplyDepth?: number;
}

function toSummary(meta: Doc<'threadMetadata'>): DiscussionSummary {
  return {
    threadId: meta.threadId,
    title: meta.title,
    discussionCategory: meta.discussionCategory,
    discussionStatus: meta.discussionStatus,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    lastReplyAt: meta.lastReplyAt,
    linkedTaskId: meta.linkedTaskId ? String(meta.linkedTaskId) : undefined,
    agentReplyDepth: meta.agentReplyDepth,
  };
}

/** List a project's discussions (newest activity first), org-scoped. */
export const listProjectDiscussionsInternal = internalQuery({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    category: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal('open'), v.literal('resolved'), v.literal('locked')),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DiscussionSummary[]> => {
    const rows: DiscussionSummary[] = [];
    for await (const meta of ctx.db
      .query('threadMetadata')
      .withIndex('by_kind_projectId', (q) =>
        q.eq('kind', 'project_discussion').eq('projectId', args.projectId),
      )) {
      if (meta.organizationId !== args.organizationId) continue;
      if (meta.status !== 'active') continue;
      if (args.category && meta.discussionCategory !== args.category) continue;
      if (args.status && meta.discussionStatus !== args.status) continue;
      rows.push(toSummary(meta));
    }
    rows.sort((a, b) => discussionActivityAt(b) - discussionActivityAt(a));
    return typeof args.limit === 'number' ? rows.slice(0, args.limit) : rows;
  },
});

/** Get one discussion's metadata (org-scoped). */
export const getDiscussionInternal = internalQuery({
  args: { organizationId: v.string(), threadId: v.string() },
  handler: async (ctx, args): Promise<DiscussionSummary | null> => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!meta || meta.organizationId !== args.organizationId) return null;
    if (!isDiscussionKind(meta.kind)) return null;
    return toSummary(meta);
  },
});
