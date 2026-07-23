/**
 * Generations — the live state of an in-flight turn.
 *
 * There is exactly one row per actively generating thread, and its PRESENCE is
 * the "is generating" signal: the row is created before the model call and
 * deleted when the turn settles, so no thread ever carries stale generation
 * state and a reader tells "generating" from "idle" by the row existing or
 * not. `heartbeatAt` is what makes an abandoned turn recoverable — a sweeper
 * can distinguish a live stream from a crashed one without guessing from
 * timestamps on the thread.
 *
 * The three write functions are internal because they are the trusted lower
 * half of a turn, driven by the node action after it has authenticated the
 * caller. `endGeneration` runs in the turn's `finally`, so the row is removed
 * whether the turn succeeded, refused, or threw.
 */

import { v } from 'convex/values';

import {
  internalMutation,
  query,
  type MutationCtx,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const generationStatusValidator = v.union(
  v.literal('queued'),
  v.literal('streaming'),
  v.literal('waiting-approval'),
  v.literal('waiting-input'),
);

/** The live turn, reduced to what the conversation view reads. Null means the
 * thread is idle. */
const generationViewValidator = v.union(
  v.object({
    status: generationStatusValidator,
    waitingOn: v.optional(v.string()),
    messageId: v.optional(v.string()),
  }),
  v.null(),
);

/**
 * The live generation for a thread, or null when it is idle. Scoped to the
 * caller's own thread: the ownership is asserted before the generations table
 * is touched, so no member reads another member's live turn and no
 * organization reads another's.
 */
export const getGeneration = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: generationViewValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return null;
    const thread = await ctx.db.get(threadId);
    if (
      !thread ||
      thread.organizationId !== args.organizationId ||
      thread.userId !== authUser.userId
    ) {
      return null;
    }

    const generation = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .first();
    if (!generation) return null;
    return {
      status: generation.status,
      waitingOn: generation.waitingOn,
      messageId: generation.messageId,
    };
  },
});

/** Load the generation row for a thread within a trusted write, if any. */
async function currentGeneration(
  ctx: MutationCtx,
  organizationId: string,
  threadId: string,
) {
  const normalized = ctx.db.normalizeId('threads', threadId);
  if (!normalized) return null;
  const generation = await ctx.db
    .query('generations')
    .withIndex('by_thread', (q) => q.eq('threadId', normalized))
    .first();
  if (!generation || generation.organizationId !== organizationId) return null;
  return generation;
}

/**
 * Open the generation for a thread. If one somehow already exists (a previous
 * turn that never settled), it is reset rather than duplicated, so the
 * one-row-per-thread invariant holds.
 */
export const beginGenerationInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    streamId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await currentGeneration(
      ctx,
      args.organizationId,
      args.threadId,
    );
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'queued',
        streamId: args.streamId,
        messageId: undefined,
        waitingOn: undefined,
        startedAt: now,
        heartbeatAt: now,
      });
      return null;
    }
    await ctx.db.insert('generations', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      status: 'queued',
      streamId: args.streamId,
      startedAt: now,
      heartbeatAt: now,
    });
    return null;
  },
});

/**
 * Prove the turn is alive: bump `heartbeatAt` and move the row to `streaming`.
 * A heartbeat for a thread with no open generation is a no-op — a settled turn
 * has nothing to keep alive.
 */
export const heartbeatInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await currentGeneration(
      ctx,
      args.organizationId,
      args.threadId,
    );
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      status: 'streaming',
      heartbeatAt: Date.now(),
      ...(args.messageId ? { messageId: args.messageId } : {}),
    });
    return null;
  },
});

/**
 * Settle the turn by deleting its row. Its absence is what tells every reader
 * the turn is done, so this runs in the turn's `finally` — success, refusal,
 * or throw.
 */
export const endGenerationInternal = internalMutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await currentGeneration(
      ctx,
      args.organizationId,
      args.threadId,
    );
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
