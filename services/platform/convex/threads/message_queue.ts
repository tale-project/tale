import { saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { components, internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { persistentStreaming } from '../streaming/helpers';

/**
 * Queue for messages sent while a turn is already running ("keep typing while
 * it works"). The timeline user message is saved at enqueue so it renders
 * immediately; the queue row tracks delivery. Drained as ONE combined turn at
 * the next terminal turn boundary via `settleQueueOnTurnEnd`, which every
 * `generating → idle` writer calls. External-agent turns additionally get
 * mid-turn steering delivery (see node_only/sandbox/steer_delivery.ts), which
 * flips rows queued → delivered → consumed without waiting for the boundary.
 */
export const MAX_QUEUED_PER_THREAD = 10;

type QueueRow = Doc<'chatMessageQueue'>;

async function listByStatus(
  ctx: MutationCtx,
  threadId: string,
  status: QueueRow['status'],
): Promise<QueueRow[]> {
  return await ctx.db
    .query('chatMessageQueue')
    .withIndex('by_threadId_status', (q) =>
      q.eq('threadId', threadId).eq('status', status),
    )
    .collect();
}

/**
 * Claim every queued row and schedule the drain turn. The caller has already
 * decided the thread should (re-)enter the generating state; this commits the
 * claim + the threadMetadata patch + the schedule atomically, so subscribers
 * never observe an idle flicker between the ending turn and the drain turn.
 */
async function startQueuedTurn(
  ctx: MutationCtx,
  meta: Doc<'threadMetadata'>,
  rows: QueueRow[],
): Promise<void> {
  const ordered = [...rows].sort((a, b) => a._creationTime - b._creationTime);
  const last = ordered[ordered.length - 1];
  if (!last) return;

  const streamId = await persistentStreaming.createStream(ctx);
  const now = Date.now();
  for (const row of ordered) {
    await ctx.db.patch(row._id, {
      status: 'claimed' as const,
      claimedByStreamId: streamId,
      claimedAt: now,
    });
  }
  await ctx.db.patch(meta._id, {
    generationStatus: 'generating' as const,
    streamId,
    generationStartTime: now,
    generationHeartbeatAt: undefined,
    updatedAt: now,
    // The prior turn did end — bump the unread badge like clearGenerationStatus
    // would have.
    lastReplyAt: now,
    liveRoute: undefined,
    cancelledAt: undefined,
    cancelledMessageId: undefined,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.agents.chat_turn_generate.runChatTurnGeneration,
    {
      agentSlug: last.agentSlug,
      organizationId: last.organizationId,
      message: ordered.map((r) => r.text).join('\n\n'),
      threadId: meta.threadId,
      streamId,
      userId: last.userId,
      userEmail: last.userEmail,
      userName: last.userName,
      requestStartMs: now,
      // The user messages are already persisted (saved at enqueue) — the
      // pipeline must not save the combined text as a new user message.
      queuedPromptMessageId: last.messageId,
    },
  );
}

/**
 * The single queue hook, called by every `generating → idle` writer while the
 * ending turn's streamId still matches `threadMetadata.streamId`.
 *
 * 1. Rows the ending turn carried (claimed under `endingStreamId`, or already
 *    consumed in-sandbox) are deleted — their content is in the transcript.
 * 2. If anything is still queued, it drains as one combined turn and the
 *    thread STAYS generating (the caller must skip its idle patch when this
 *    returns `drained: true`).
 *
 * Race safety: enqueue reads the same threadMetadata row every finalize
 * writes, so Convex OCC serializes the two — either the finalize sees the new
 * queue row (and drains it here), or the enqueue retries against the idle
 * snapshot and starts the turn itself. A message can never strand.
 */
export async function settleQueueOnTurnEnd(
  ctx: MutationCtx,
  meta: Doc<'threadMetadata'>,
  endingStreamId: string | undefined,
): Promise<{ drained: boolean }> {
  if (endingStreamId) {
    const claimed = await listByStatus(ctx, meta.threadId, 'claimed');
    for (const row of claimed) {
      if (row.claimedByStreamId === endingStreamId) {
        await ctx.db.delete(row._id);
      }
    }
  }
  // Consumed rows were injected into the (now ended) turn mid-run; their
  // content lives in the agent transcript, so the pill can retire.
  const consumed = await listByStatus(ctx, meta.threadId, 'consumed');
  for (const row of consumed) {
    await ctx.db.delete(row._id);
  }

  // Self-heal: 'delivered' rows whose exec is no longer running missed their
  // terminal reconciliation (the finalizing action died between stage and
  // reconcile, or the listing transport failed) — roll them back so this
  // boundary's drain carries them. At-least-once.
  const delivered = await listByStatus(ctx, meta.threadId, 'delivered');
  if (delivered.length > 0) {
    const runningExecIds = new Set<string>();
    for await (const op of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', meta.threadId))) {
      if (op.status === 'running') runningExecIds.add(op.execId);
    }
    for (const row of delivered) {
      if (row.deliveredExecId && runningExecIds.has(row.deliveredExecId)) {
        continue; // still steerable mid-turn; leave it
      }
      await ctx.db.patch(row._id, {
        status: 'queued' as const,
        deliveredExecId: undefined,
        deliveredAt: undefined,
      });
    }
  }

  const queued = await listByStatus(ctx, meta.threadId, 'queued');
  if (queued.length === 0) return { drained: false };

  await startQueuedTurn(ctx, meta, queued);
  return { drained: true };
}

/**
 * Deferred drain for the user-Stop path: cancelGeneration schedules this a few
 * seconds out so the exec-cancel cascade settles before the queued messages
 * fire as the next `--resume` turn. Re-checks everything — if another turn
 * started meanwhile (the rows will drain at ITS boundary) or the user deleted
 * the queued bubbles, this is a no-op.
 */
export const drainQueuedMessages = internalMutation({
  args: { threadId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!meta || meta.generationStatus === 'generating') return null;

    const queued = await listByStatus(ctx, args.threadId, 'queued');
    if (queued.length === 0) return null;

    await startQueuedTurn(ctx, meta, queued);
    return null;
  },
});

export const enqueueMessage = mutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    message: v.string(),
    agentSlug: v.string(),
  },
  returns: v.object({
    /** false ⇒ the thread was idle (raced a finalize) and a turn started now. */
    queued: v.boolean(),
    messageId: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }
    const meta = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!meta || meta.userId !== authUser.userId) {
      throw new Error('Thread not found');
    }

    const trimmed = args.message.trim();
    if (!trimmed) {
      throw new ConvexError({ code: 'EMPTY_MESSAGE' });
    }
    const queuedRows = await listByStatus(ctx, args.threadId, 'queued');
    if (queuedRows.length >= MAX_QUEUED_PER_THREAD) {
      throw new ConvexError({ code: 'QUEUE_FULL' });
    }

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: { role: 'user', content: trimmed },
    });
    const rowId = await ctx.db.insert('chatMessageQueue', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: authUser.userId,
      userEmail: authUser.email ?? '',
      userName: authUser.name ?? '',
      agentSlug: args.agentSlug,
      messageId,
      text: trimmed,
      status: 'queued' as const,
      createdAt: Date.now(),
    });

    if (meta.generationStatus === 'generating' && meta.streamId) {
      // External-agent turns can additionally pick this up MID-turn — schedule
      // the steer delivery (no-op when no exec is running / non-external).
      await ctx.scheduler.runAfter(
        0,
        internal.node_only.sandbox.steer_delivery.deliverSteerMessages,
        { threadId: args.threadId },
      );
      return { queued: true, messageId };
    }

    // Idle (or this enqueue raced past the finalize): start the turn directly
    // in the same transaction so the send is self-sufficient.
    const inserted = await ctx.db.get(rowId);
    if (inserted) {
      await startQueuedTurn(ctx, meta, [...queuedRows, inserted]);
    }
    return { queued: false, messageId };
  },
});

// --- mid-turn steering (external-agent turns) -------------------------------
// The node-side steer_delivery action stages queued rows into the RUNNING
// exec's steer dir; these internal endpoints track that delivery lifecycle.

/** Queued rows in delivery order, for the steer_delivery action. */
export const listQueuedForDelivery = internalQuery({
  args: { threadId: v.string() },
  returns: v.array(
    v.object({
      queueId: v.id('chatMessageQueue'),
      messageId: v.string(),
      text: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('chatMessageQueue')
      .withIndex('by_threadId_status', (q) =>
        q.eq('threadId', args.threadId).eq('status', 'queued'),
      )
      .collect();
    rows.sort((a, b) => a._creationTime - b._creationTime);
    return rows.map((r) => ({
      queueId: r._id,
      messageId: r.messageId,
      text: r.text,
      createdAt: r.createdAt,
    }));
  },
});

/** Rows delivered into a specific exec (for the terminal reconciliation). */
export const listDeliveredForExec = internalQuery({
  args: { threadId: v.string(), execId: v.string() },
  returns: v.array(
    v.object({
      queueId: v.id('chatMessageQueue'),
      messageId: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('chatMessageQueue')
      .withIndex('by_threadId_status', (q) =>
        q.eq('threadId', args.threadId).eq('status', 'delivered'),
      )
      .collect();
    return rows
      .filter((r) => r.deliveredExecId === args.execId)
      .map((r) => ({
        queueId: r._id,
        messageId: r.messageId,
        createdAt: r.createdAt,
      }));
  },
});

/** Flip staged rows queued → delivered. Skips rows no longer 'queued' (a turn
 * boundary claimed them first) and refuses entirely when the exec is no longer
 * running (its finalize may already have reconciled — the staged files are
 * inert garbage in a dead exec's dir, cleaned on container restart). Also
 * stamps the op row's steerSeamRequestedAt so the drain seals the current
 * message segment — the turn's subsequent output then renders BELOW the
 * delivered user message(s), keeping the timeline in conversational order. */
export const markDelivered = internalMutation({
  args: {
    threadId: v.string(),
    queueIds: v.array(v.id('chatMessageQueue')),
    execId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let opId: Doc<'sandboxSessionOps'>['_id'] | null = null;
    for await (const op of ctx.db
      .query('sandboxSessionOps')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      if (op.execId === args.execId && op.status === 'running') {
        opId = op._id;
        break;
      }
    }
    if (opId === null) return null;
    const now = Date.now();
    let delivered = false;
    for (const queueId of args.queueIds) {
      const row = await ctx.db.get(queueId);
      if (row && row.status === 'queued') {
        await ctx.db.patch(queueId, {
          status: 'delivered' as const,
          deliveredExecId: args.execId,
          deliveredAt: now,
        });
        delivered = true;
      }
    }
    if (delivered) {
      await ctx.db.patch(opId, { steerSeamRequestedAt: now });
    }
    return null;
  },
});

/** Live consumption signal (parser-detected Stop-hook injection): flip
 * delivered rows → consumed so the UI pill updates mid-turn. */
export const markConsumed = internalMutation({
  args: { threadId: v.string(), messageIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const wanted = new Set(args.messageIds);
    const delivered = await listByStatus(ctx, args.threadId, 'delivered');
    for (const row of delivered) {
      if (wanted.has(row.messageId)) {
        await ctx.db.patch(row._id, { status: 'consumed' as const });
      }
    }
    return null;
  },
});

/** Terminal reconciliation (exactly-once, from finalizeTurnSideEffects): rows
 * whose staged file the hook consumed flip to 'consumed' (content is in the
 * agent transcript, which --resume carries forward); the rest roll back to
 * 'queued' so the boundary drain re-delivers them. At-least-once across turns,
 * at-most-once within one. */
export const reconcileDelivered = internalMutation({
  args: {
    threadId: v.string(),
    execId: v.string(),
    consumedMessageIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const consumed = new Set(args.consumedMessageIds);
    const delivered = await listByStatus(ctx, args.threadId, 'delivered');
    for (const row of delivered) {
      if (row.deliveredExecId !== args.execId) continue;
      if (consumed.has(row.messageId)) {
        await ctx.db.patch(row._id, { status: 'consumed' as const });
      } else {
        await ctx.db.patch(row._id, {
          status: 'queued' as const,
          deliveredExecId: undefined,
          deliveredAt: undefined,
        });
      }
    }
    return null;
  },
});

export const deleteQueuedMessage = mutation({
  args: { queueId: v.id('chatMessageQueue') },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }
    const row = await ctx.db.get(args.queueId);
    if (!row || row.userId !== authUser.userId) {
      return { deleted: false };
    }
    // claimed/delivered/consumed are already (being) handed to the agent.
    if (row.status !== 'queued') {
      return { deleted: false };
    }
    await ctx.runMutation(components.agent.messages.deleteByIds, {
      messageIds: [row.messageId],
    });
    await ctx.db.delete(row._id);
    return { deleted: true };
  },
});

export const listQueuedMessages = query({
  args: { threadId: v.string(), organizationId: v.optional(v.string()) },
  returns: v.array(
    v.object({
      queueId: v.id('chatMessageQueue'),
      messageId: v.string(),
      status: v.union(
        v.literal('queued'),
        v.literal('claimed'),
        v.literal('delivered'),
        v.literal('consumed'),
      ),
      createdAt: v.number(),
    }),
  ),
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

    const rows = await ctx.db
      .query('chatMessageQueue')
      .withIndex('by_threadId_status', (q) => q.eq('threadId', args.threadId))
      .collect();
    return rows.map((r) => ({
      queueId: r._id,
      messageId: r.messageId,
      status: r.status,
      createdAt: r.createdAt,
    }));
  },
});
