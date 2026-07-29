/**
 * Memories — durable facts about a person, gated behind approval.
 *
 * A memory is a TOOL result, never an ambient injection: the model writes one
 * by calling `memory.save`, and it lands `pending`. It becomes usable only
 * once the user approves it, so a model can never give itself durable state
 * about someone by writing it down. Nothing here is ever added to a prompt
 * automatically — `searchMemories` returns approved rows for the model to read
 * when it asks, and that is the only way a memory reaches a turn.
 *
 * Every function scopes by BOTH organization and user. A memory is
 * user-private: one member never sees another's, and no organization ever sees
 * another's. `searchMemories` additionally filters to `approved`, so a pending
 * proposal is invisible to retrieval until a human accepts it.
 *
 * Proposing a memory is an auditable act even before anyone approves it, so
 * `saveMemory` writes an audit row alongside the pending memory — a memory is
 * state about a person, and the record of who proposed it and when must not
 * depend on the approval ever happening.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/** The shape the capability surface reads a memory as. */
const memoryRecordValidator = v.object({
  id: v.id('memories'),
  organizationId: v.string(),
  userId: v.string(),
  content: v.string(),
  status: v.union(
    v.literal('pending'),
    v.literal('approved'),
    v.literal('rejected'),
  ),
  createdAt: v.number(),
});

const memoryReviewDecisionValidator = v.union(
  v.literal('approved'),
  v.literal('rejected'),
);

/** Insert a pending memory. Shared by the authenticated mutation and the
 * capability surface's internal path so both write the identical row. */
async function insertPendingMemory(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    userId: string;
    content: string;
    sourceThreadId?: string;
    sourceMessageId?: string;
  },
): Promise<{ id: Id<'memories'>; createdAt: number }> {
  const createdAt = Date.now();
  const id = await ctx.db.insert('memories', {
    organizationId: args.organizationId,
    userId: args.userId,
    content: args.content,
    status: 'pending',
    sourceThreadId: args.sourceThreadId,
    sourceMessageId: args.sourceMessageId,
    createdAt,
  });
  return { id, createdAt };
}

/** Record that a memory was proposed. Proposing is auditable independently of
 * any later approval. */
async function auditMemorySave(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    memoryId: string;
    threadId?: string;
  },
): Promise<void> {
  await ctx.runMutation(internal.audit_logs.internal_mutations.createAuditLog, {
    organizationId: args.organizationId,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    actorType: 'user',
    action: 'memory.save',
    category: 'ai',
    resourceType: 'chat_memory',
    resourceId: args.memoryId,
    status: 'success',
    ...(args.threadId ? { metadata: { threadId: args.threadId } } : {}),
  });
}

/**
 * Save a memory as pending and record the proposal in the audit trail. The
 * authenticated entry point: the caller must be a member of the organization,
 * and the memory is owned by them.
 */
export const saveMemory = mutation({
  args: {
    organizationId: v.string(),
    content: v.string(),
    sourceThreadId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
  },
  returns: v.id('memories'),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const content = args.content.trim();
    if (content.length === 0) {
      throw new Error('A memory cannot be empty.');
    }

    const { id } = await insertPendingMemory(ctx, {
      organizationId: args.organizationId,
      userId: authUser.userId,
      content,
      sourceThreadId: args.sourceThreadId,
      sourceMessageId: args.sourceMessageId,
    });
    await auditMemorySave(ctx, {
      organizationId: args.organizationId,
      actorId: authUser.userId,
      actorEmail: authUser.email,
      memoryId: id,
      threadId: args.sourceThreadId,
    });
    return id;
  },
});

/**
 * Save a pending memory on behalf of the model's `memory.save` tool call. The
 * organization and user are already resolved by the node action that drives
 * the turn, so this trusted path takes them as arguments. The audit entry for
 * the proposal is written by the capability surface's audit sink, keeping the
 * "write the row" and "record the act" steps as the two ports the surface
 * declares.
 */
export const saveMemoryInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    content: v.string(),
    sourceThreadId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
  },
  returns: v.object({ id: v.id('memories'), createdAt: v.number() }),
  handler: async (ctx, args) => {
    const content = args.content.trim();
    if (content.length === 0) {
      throw new Error('A memory cannot be empty.');
    }
    return insertPendingMemory(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      content,
      sourceThreadId: args.sourceThreadId,
      sourceMessageId: args.sourceMessageId,
    });
  },
});

/** Approved memories matching a query, for the caller's own set. Never returns
 * a pending or rejected row — retrieval only ever sees what a human accepted. */
function matchesQuery(content: string, queryText: string | undefined): boolean {
  if (!queryText) return true;
  return content.toLowerCase().includes(queryText.toLowerCase());
}

/**
 * The approved memories the model may read. Approved-only and scoped to the
 * caller's (org, user) pair, both asserted here so retrieval can never surface
 * a proposal or another person's memory.
 */
export const searchMemories = query({
  args: {
    organizationId: v.string(),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.id('memories'),
      content: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const approved = await ctx.db
      .query('memories')
      .withIndex('by_org_user_status', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', authUser.userId)
          .eq('status', 'approved'),
      )
      .order('desc')
      .collect();

    return approved
      .filter((memory) => matchesQuery(memory.content, args.query))
      .slice(0, args.limit ?? 20)
      .map((memory) => ({
        id: memory._id,
        content: memory.content,
        createdAt: memory.createdAt,
      }));
  },
});

/**
 * The approved memories for a resolved (org, user) pair, in the record shape
 * the capability surface reads. The trusted path behind the model's
 * `memory.search`; the node action has already authenticated the caller.
 */
export const searchApprovedMemoriesInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(memoryRecordValidator),
  handler: async (ctx, args) => {
    const approved = await ctx.db
      .query('memories')
      .withIndex('by_org_user_status', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('status', 'approved'),
      )
      .order('desc')
      .collect();

    return approved
      .filter((memory) => matchesQuery(memory.content, args.query))
      .slice(0, args.limit ?? 20)
      .map((memory) => ({
        id: memory._id,
        organizationId: memory.organizationId,
        userId: memory.userId,
        content: memory.content,
        status: memory.status,
        createdAt: memory.createdAt,
      }));
  },
});

/**
 * The pending proposals and approved memories the preferences page reviews.
 * Pending are what the model proposed via `memory.save`; approved are what the
 * user has accepted. Both scoped to the caller's own set.
 */
export const listMemories = query({
  args: { organizationId: v.string() },
  returns: v.object({
    pending: v.array(v.object({ id: v.id('memories'), content: v.string() })),
    approved: v.array(v.object({ id: v.id('memories'), content: v.string() })),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const rows = await ctx.db
      .query('memories')
      .withIndex('by_org_user', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', authUser.userId),
      )
      .order('desc')
      .collect();

    const pending: Array<{
      id: (typeof rows)[number]['_id'];
      content: string;
    }> = [];
    const approved: Array<{
      id: (typeof rows)[number]['_id'];
      content: string;
    }> = [];
    for (const memory of rows) {
      if (memory.status === 'pending') {
        pending.push({ id: memory._id, content: memory.content });
      } else if (memory.status === 'approved') {
        approved.push({ id: memory._id, content: memory.content });
      }
    }
    return { pending, approved };
  },
});

/**
 * Approve or reject a pending memory. A separate, authenticated act from
 * saving one: the model proposes, the person decides. Returns false when the
 * memory is not the caller's, so an approval can never cross users or orgs.
 */
export const reviewMemory = mutation({
  args: {
    organizationId: v.string(),
    memoryId: v.string(),
    decision: memoryReviewDecisionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const memoryId = ctx.db.normalizeId('memories', args.memoryId);
    if (!memoryId) return false;
    const memory = await ctx.db.get(memoryId);
    if (
      !memory ||
      memory.organizationId !== args.organizationId ||
      memory.userId !== authUser.userId
    ) {
      return false;
    }

    await ctx.db.patch(memory._id, {
      status: args.decision,
      reviewedBy: authUser.userId,
      reviewedAt: Date.now(),
    });
    return true;
  },
});
