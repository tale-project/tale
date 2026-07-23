/**
 * Messages — the ordered record of one thread's turns.
 *
 * A message carries an ordered list of parts (text, attachments, tool calls
 * and their results, approval and human-input cards) exactly as authored,
 * because the context contract replays a conversation whole rather than
 * summarizing it. Reading a thread therefore reproduces precisely what the
 * model saw.
 *
 * `sequence` is the ordering key, and it is assigned INSIDE the append
 * transaction as one more than the current maximum for the thread. Convex
 * serializes mutations, so two turns that append at the same instant each see
 * the other's committed row and take the next number — the ordering never
 * depends on a wall-clock tie, and the sequence is gap-free and monotonic.
 *
 * The append is an internal mutation because it is the trusted lower half of a
 * turn: the node action that drives a turn authenticates the caller and
 * resolves the organization before it ever writes a message, so this function
 * takes the already-verified organization and thread and does not re-check
 * identity.
 */

import { v } from 'convex/values';

import { internalMutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const messageRoleValidator = v.union(
  v.literal('user'),
  v.literal('assistant'),
  v.literal('tool'),
  v.literal('system'),
);

/** One rendered message. Parts and usage are shaped by the chat layer rather
 * than re-declared here, so adding a part kind is not a schema change. */
const messageViewValidator = v.object({
  id: v.id('messages'),
  role: messageRoleValidator,
  parts: v.any(),
  sequence: v.number(),
  model: v.optional(v.string()),
  providerSlug: v.optional(v.string()),
  blockedReason: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
});

/**
 * A thread's messages in sequence order. Returns an empty list when the thread
 * is not the caller's — a member never reads another member's conversation,
 * and no organization reads another's, because the thread ownership is
 * asserted before a single message row is loaded.
 */
export const listMessages = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.array(messageViewValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return [];
    const thread = await ctx.db.get(threadId);
    if (
      !thread ||
      thread.organizationId !== args.organizationId ||
      thread.userId !== authUser.userId
    ) {
      return [];
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .collect();

    return messages.map((message) => ({
      id: message._id,
      role: message.role,
      parts: message.parts,
      sequence: message.sequence,
      model: message.model,
      providerSlug: message.providerSlug,
      blockedReason: message.blockedReason,
      error: message.error,
      createdAt: message.createdAt,
    }));
  },
});

/**
 * Append one message to a thread, assigning the next sequence within the
 * transaction. Returns the new id and the assigned sequence so the caller can
 * refer to the row it just wrote.
 */
export const appendMessageInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    role: messageRoleValidator,
    parts: v.any(),
    model: v.optional(v.string()),
    providerSlug: v.optional(v.string()),
    usage: v.optional(v.any()),
    blockedReason: v.optional(v.string()),
  },
  returns: v.object({ id: v.id('messages'), sequence: v.number() }),
  handler: async (ctx, args) => {
    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) {
      throw new Error(
        `[chat] cannot append to unknown thread ${args.threadId}`,
      );
    }
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.organizationId !== args.organizationId) {
      throw new Error(
        `[chat] thread ${args.threadId} is not in organization ${args.organizationId}`,
      );
    }

    // The highest existing sequence for this thread, read inside the same
    // transaction as the insert so the assignment is atomic.
    const last = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) => q.eq('threadId', thread._id))
      .order('desc')
      .first();
    const sequence = last ? last.sequence + 1 : 0;

    const id = await ctx.db.insert('messages', {
      organizationId: args.organizationId,
      threadId: thread._id,
      role: args.role,
      parts: args.parts,
      sequence,
      model: args.model,
      providerSlug: args.providerSlug,
      usage: args.usage,
      blockedReason: args.blockedReason,
      createdAt: Date.now(),
    });

    // A turn just wrote to the thread; keep its list ordering fresh.
    await ctx.db.patch(thread._id, { updatedAt: Date.now() });

    return { id, sequence };
  },
});
