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
  internalQuery,
  mutation,
  query,
  type QueryCtx,
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

/**
 * Whether a thread already has a live turn — the server-side at-most-one gate.
 * The start actions check this before appending anything, so a concurrent
 * second send (two tabs, a double-click, a direct API call) is refused instead
 * of overwriting the running turn's generation and orphaning its exec. The
 * client's send-disable is UX only; this is the authority.
 */
export const hasLiveGenerationInternal = internalQuery({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const normalized = ctx.db.normalizeId('threads', args.threadId);
    if (!normalized) return false;
    const generation = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', normalized))
      .first();
    return (
      generation !== null && generation.organizationId === args.organizationId
    );
  },
});

/** Load the generation row for a thread, if any. Read-only, so it takes a
 * query OR mutation ctx (a mutation ctx satisfies the read-capable shape). */
async function currentGeneration(
  ctx: QueryCtx,
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
const externalTurnStateValidator = v.object({
  execId: v.string(),
  lastSeq: v.number(),
  harness: v.string(),
  providerSlug: v.string(),
  gatewayModel: v.string(),
});

export const beginGenerationInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    /** The assistant message the turn streams into, when created up front (the
     * external lane writes a placeholder so a drainer window can append to it). */
    messageId: v.optional(v.string()),
    /** Present for a third-party external turn — the drainer's re-attach state. */
    external: v.optional(externalTurnStateValidator),
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
        messageId: args.messageId,
        external: args.external,
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
      ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
      ...(args.external !== undefined ? { external: args.external } : {}),
      startedAt: now,
      heartbeatAt: now,
    });
    return null;
  },
});

/**
 * Advance an external turn's reconnect cursor after a drain window, so the next
 * window re-attaches from exactly where this one stopped (no missed or
 * replayed output). Also bumps the heartbeat — a window that drained is proof
 * of life. A no-op if the turn already settled.
 */
export const advanceExternalTurnCursorInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    lastSeq: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await currentGeneration(
      ctx,
      args.organizationId,
      args.threadId,
    );
    if (!existing || existing.external === undefined) return null;
    await ctx.db.patch(existing._id, {
      status: 'streaming',
      heartbeatAt: Date.now(),
      external: { ...existing.external, lastSeq: args.lastSeq },
    });
    return null;
  },
});

/** Read a thread's live external-turn state for a drainer window. `messageId`
 * is normalized to an id (null when the turn has no streamable message or has
 * already settled) so the drainer can hand it straight to the message
 * mutations. */
export const getExternalTurnStateInternal = internalQuery({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      messageId: v.id('messages'),
      external: externalTurnStateValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const existing = await currentGeneration(
      ctx,
      args.organizationId,
      args.threadId,
    );
    if (!existing || existing.external === undefined) return null;
    if (existing.messageId === undefined) return null;
    const messageId = ctx.db.normalizeId('messages', existing.messageId);
    if (messageId === null) return null;
    return { messageId, external: existing.external };
  },
});

/**
 * Persist streaming progress: the full cleared text (and reasoning) so far,
 * plus proof of life. One write carries what used to be two — the text patch
 * and the heartbeat — and it lands on the generation row, not the message row,
 * so the message list's subscribers stay silent while the reply streams. A
 * write for a thread with no open generation is a no-op: the turn settled and
 * the finalize write already carried the authoritative text.
 */
export const streamProgressInternal = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    text: v.string(),
    reasoning: v.optional(v.string()),
  },
  // The write doubles as the turn's cancel poll: the answer carries the
  // row's cancel flag so the streaming loop can abort without a second read.
  returns: v.object({ cancelRequested: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await currentGeneration(
      ctx,
      args.organizationId,
      args.threadId,
    );
    if (!existing) return { cancelRequested: false };
    await ctx.db.patch(existing._id, {
      status: 'streaming',
      heartbeatAt: Date.now(),
      streamText: args.text,
      ...(args.reasoning !== undefined
        ? { streamReasoning: args.reasoning }
        : {}),
      ...(args.messageId ? { messageId: args.messageId } : {}),
    });
    return { cancelRequested: existing.cancelRequested === true };
  },
});

/**
 * The owner's stop button. Marks the thread's live generation as
 * cancel-requested; the direct lane's next streaming write reads the flag
 * back and aborts the model call, settling the message with what streamed.
 * A thread with no live turn is a no-op (`stopped: false`) — the turn
 * settled before the click landed, which is not an error.
 */
export const requestCancelGeneration = mutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.object({ stopped: v.boolean() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const threadId = ctx.db.normalizeId('threads', args.threadId);
    if (!threadId) return { stopped: false };
    const thread = await ctx.db.get(threadId);
    if (
      !thread ||
      thread.organizationId !== args.organizationId ||
      thread.userId !== authUser.userId
    ) {
      return { stopped: false };
    }
    const generation = await ctx.db
      .query('generations')
      .withIndex('by_thread', (q) => q.eq('threadId', thread._id))
      .first();
    if (!generation) return { stopped: false };
    if (generation.cancelRequested !== true) {
      await ctx.db.patch(generation._id, { cancelRequested: true });
    }
    return { stopped: true };
  },
});

/** The in-flight reply text for a thread, or null when it is idle. The ONLY
 * subscription that updates per streamed chunk — it is deliberately separate
 * from `getGeneration` so the slim status result stays byte-identical during
 * a stream and its subscribers stay quiet. Same ownership gating. */
export const getGenerationText = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(
    v.object({
      messageId: v.optional(v.string()),
      text: v.string(),
      reasoning: v.optional(v.string()),
    }),
    v.null(),
  ),
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
      messageId: generation.messageId,
      text: generation.streamText ?? '',
      reasoning: generation.streamReasoning,
    };
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

/** A DIRECT-lane generation is dead once its per-chunk heartbeat goes stale
 * this long. Well past the lane's total-stream cap (180s), so a live turn is
 * never swept. */
const DIRECT_GENERATION_STALE_MS = 5 * 60_000;
/** Rows cleared per sweep — bounds the mutation. */
const DIRECT_GENERATION_SWEEP_LIMIT = 50;

/**
 * Crash-recovery sweep for the DIRECT (platform-chat) lane. A direct turn runs
 * in a single action that heartbeats per streamed chunk; a hard kill (deploy,
 * action ceiling) strands its generation row `running`, leaving the thread
 * looking like it is generating forever with no drainer to settle it. This
 * deletes those stale rows so the composer unlocks.
 *
 * External-turn generations are SKIPPED (external !== undefined) — the
 * retired external-agent chat lane owned their settlement, and no new ones
 * are written since chat went plain-conversation-only (#2877).
 */
export const recoverStaleDirectGenerations = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const staleBefore = Date.now() - DIRECT_GENERATION_STALE_MS;
    let cleared = 0;
    for await (const row of ctx.db
      .query('generations')
      .withIndex('by_heartbeat', (q) => q.lt('heartbeatAt', staleBefore))) {
      if (row.external !== undefined) continue; // external lane → op-row recovery
      // The turn streamed into a placeholder message; a hard-killed turn never
      // finalized it. Rescue the streamed partial off the row being deleted
      // (streaming writes never touch the message) and stamp the failure so
      // the row does not read as a settled empty answer.
      if (row.messageId !== undefined) {
        const messageId = ctx.db.normalizeId('messages', row.messageId);
        const message = messageId ? await ctx.db.get(messageId) : null;
        if (
          message &&
          message.organizationId === row.organizationId &&
          message.error === undefined &&
          message.blockedReason === undefined &&
          message.usage === undefined
        ) {
          const partial = row.streamText ?? '';
          const partialReasoning = row.streamReasoning ?? '';
          const hasOwnText = message.parts.some(
            (part: unknown) =>
              part !== null &&
              typeof part === 'object' &&
              'type' in part &&
              part.type === 'text' &&
              'text' in part &&
              typeof part.text === 'string' &&
              part.text.length > 0,
          );
          // Rescue APPENDS to whatever parts already settled (a tool loop's
          // calls and results live on the row mid-turn) — replacing them
          // would erase the record of what the turn actually did.
          const settled = Array.isArray(message.parts) ? message.parts : [];
          await ctx.db.patch(message._id, {
            ...(partial !== '' && !hasOwnText
              ? {
                  parts: [
                    ...settled,
                    ...(partialReasoning !== ''
                      ? [{ type: 'reasoning', text: partialReasoning }]
                      : []),
                    { type: 'text', text: partial },
                  ],
                }
              : {}),
            error: 'The response was interrupted before it finished.',
          });
        }
      }
      await ctx.db.delete(row._id);
      cleared += 1;
      if (cleared >= DIRECT_GENERATION_SWEEP_LIMIT) break;
    }
    return cleared;
  },
});
