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
import { isDrainingNow } from '../control/drain';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { persistentStreaming } from '../streaming/helpers';

/**
 * While a deploy drain is active, queued messages must NOT start a new
 * `runChatTurnGeneration` — the imminent convex recreate would kill it. Instead
 * the drain points defer to `drainQueuedMessages` after this delay; that
 * mutation self-reschedules while draining and fires for real once the flag
 * clears (`endDrain`, or `drainExpiresAt` if a deploy died). Rows stay queued
 * meanwhile (the queue tray keeps showing them), so nothing is lost.
 */
const DRAIN_REQUEUE_DELAY_MS = 5_000;

/**
 * Queue for messages sent while a turn is already running ("keep typing while
 * it works"). Persist-at-pick: the queue row is the only record until the
 * message is actually picked — the transcript copy is created by
 * `persistPickedRow` at the pick (steer injection, boundary drain, or
 * terminal reconcile), so its `_creationTime` is the injection time and its
 * transcript position is final on first render. Drained as ONE combined turn
 * at the next terminal turn boundary via `settleQueueOnTurnEnd`, which every
 * `generating → idle` writer calls. External-agent turns additionally get
 * mid-turn steering delivery (see node_only/sandbox/steer_delivery.ts), which
 * flips rows queued → delivered → consumed without waiting for the boundary.
 */
export const MAX_QUEUED_PER_THREAD = 10;

type QueueRow = Doc<'chatMessageQueue'>;

/**
 * The pick: create the row's transcript copy (once) and return its id.
 * Legacy rows (persisted at enqueue, `deferredPersist` unset) already have
 * one — their `messageId` IS the transcript copy. Idempotent via
 * `savedMessageId`, so racing pickers (live consumption poll vs terminal
 * reconcile) can't double-save; Convex OCC serializes the read-then-patch.
 */
async function persistPickedRow(
  ctx: MutationCtx,
  row: QueueRow,
): Promise<string> {
  if (row.savedMessageId !== undefined) return row.savedMessageId;
  if (!row.deferredPersist) return row.messageId;
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: row.threadId,
    message: { role: 'user', content: row.text },
  });
  await ctx.db.patch(row._id, { savedMessageId: messageId });
  return messageId;
}

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
 * Exported for the plan-approval kickoff (approvals/plan_mutations.ts), which
 * starts the act turn through the same machinery as an idle enqueue.
 */
export async function startQueuedTurn(
  ctx: MutationCtx,
  meta: Doc<'threadMetadata'>,
  rows: QueueRow[],
): Promise<void> {
  const ordered = [...rows].sort((a, b) => a._creationTime - b._creationTime);
  const last = ordered[ordered.length - 1];
  if (!last) return;

  const streamId = await persistentStreaming.createStream(ctx);
  const now = Date.now();
  // The drain IS the pick for boundary-queued rows: persist each as its own
  // user bubble now (in send order, before the turn's assistant message), so
  // N queued messages keep rendering as N bubbles at the turn boundary.
  let lastPromptMessageId: string | undefined;
  for (const row of ordered) {
    lastPromptMessageId = await persistPickedRow(ctx, row);
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
      // Preserve the model the user picked: without it runChatTurnGeneration
      // resolves the org default, swapping the selection (and 403'ing when the
      // session VK only allows the picked model). The last row's pick wins —
      // a drain combines rows enqueued under one composer state.
      ...(last.modelId !== undefined && { modelId: last.modelId }),
      // The user messages were just persisted by the pick above — the
      // pipeline must not save the combined text as a new user message.
      queuedPromptMessageId: lastPromptMessageId,
      // External-thread agent lock (chat_turn_generate step 0): queue rows
      // carry the composer's agentSlug from enqueue time, which can be stale
      // per-user picker state — the thread's stored agent wins when it's an
      // external one.
      ...(meta.agentSlug !== undefined && { priorAgentSlug: meta.agentSlug }),
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
        deliveredChannel: undefined,
      });
    }
  }

  const queued = await listByStatus(ctx, meta.threadId, 'queued');
  if (queued.length === 0) return { drained: false };

  // Deploy drain: don't start the drain turn now (the convex recreate would
  // kill it). Let the ending turn finalize to idle (drained:false) and hand off
  // to the deferred drainQueuedMessages, which resumes once the backend is back.
  if (await isDrainingNow(ctx)) {
    await ctx.scheduler.runAfter(
      DRAIN_REQUEUE_DELAY_MS,
      internal.threads.message_queue.drainQueuedMessages,
      { threadId: meta.threadId },
    );
    return { drained: false };
  }

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

    // Still draining → re-defer rather than start a turn the recreate would
    // kill. Self-rescheduling resolves once isDrainingNow clears (endDrain or
    // drainExpiresAt backstop).
    if (await isDrainingNow(ctx)) {
      await ctx.scheduler.runAfter(
        DRAIN_REQUEUE_DELAY_MS,
        internal.threads.message_queue.drainQueuedMessages,
        { threadId: args.threadId },
      );
      return null;
    }

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
    /** Thread's selected model id — carried onto the queue row so the
     * boundary drain re-enters generation with the user's pick, not the org
     * default. Omitted for Auto. */
    modelId: v.optional(v.string()),
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
      throw new ConvexError({
        code: 'THREAD_NOT_FOUND',
        message: 'Thread not found',
      });
    }

    const trimmed = args.message.trim();
    if (!trimmed) {
      throw new ConvexError({ code: 'EMPTY_MESSAGE' });
    }
    const queuedRows = await listByStatus(ctx, args.threadId, 'queued');
    if (queuedRows.length >= MAX_QUEUED_PER_THREAD) {
      throw new ConvexError({ code: 'QUEUE_FULL' });
    }

    // Persist-at-pick: NO transcript copy here. A copy saved at enqueue gets
    // its `_creationTime` mid-turn, sorts between the running turn's rows,
    // and reshuffles the list as later rows stream in — the queue tray
    // renders the waiting row instead, and the pick creates the copy at its
    // final position. The steer-file contract still needs a stable identity
    // token per row; with no message to borrow an id from, the row's own id
    // is it (unique, deterministic).
    const rowId = await ctx.db.insert('chatMessageQueue', {
      organizationId: args.organizationId,
      threadId: args.threadId,
      userId: authUser.userId,
      userEmail: authUser.email ?? '',
      userName: authUser.name ?? '',
      agentSlug: args.agentSlug,
      ...(args.modelId !== undefined && { modelId: args.modelId }),
      messageId: '',
      deferredPersist: true,
      text: trimmed,
      status: 'queued' as const,
      createdAt: Date.now(),
    });
    const messageId = String(rowId);
    await ctx.db.patch(rowId, { messageId });

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
    // in the same transaction so the send is self-sufficient — unless a deploy
    // drain is active, in which case keep it queued and defer the drain so the
    // recreate doesn't kill a turn started here.
    if (await isDrainingNow(ctx)) {
      await ctx.scheduler.runAfter(
        DRAIN_REQUEUE_DELAY_MS,
        internal.threads.message_queue.drainQueuedMessages,
        { threadId: args.threadId },
      );
      return { queued: true, messageId };
    }
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

/** Count of rows mid-steer for a thread: staged into a running exec
 * ('delivered') or already injected by it ('consumed'). The empty-turn
 * auto-retry refuses to run while any exist — a consumed row's content lives
 * only in the abandoned attempt's transcript, so retrying would drop it. */
export const countSteerInFlight = internalQuery({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const status of ['delivered', 'consumed'] as const) {
      const rows = await ctx.db
        .query('chatMessageQueue')
        .withIndex('by_threadId_status', (q) =>
          q.eq('threadId', args.threadId).eq('status', status),
        )
        .collect();
      count += rows.length;
    }
    return count;
  },
});

/** Rows delivered into a specific exec (for the drain's consumption poll, the
 * linger loop's stdin redelivery, and the terminal reconciliation). `channel`
 * tells the consumers which evidence applies (consumed.* markers for 'file',
 * the next agent result for 'stdin'); `text` lets the linger loop rebuild the
 * stdin payload when it converts a stranded file delivery. */
export const listDeliveredForExec = internalQuery({
  args: { threadId: v.string(), execId: v.string() },
  returns: v.array(
    v.object({
      queueId: v.id('chatMessageQueue'),
      messageId: v.string(),
      text: v.string(),
      createdAt: v.number(),
      channel: v.union(v.literal('file'), v.literal('stdin')),
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
        text: r.text,
        createdAt: r.createdAt,
        // Rows delivered before this field existed were all file-staged.
        channel: r.deliveredChannel ?? ('file' as const),
      }));
  },
});

/** Flip staged rows queued → delivered. Skips rows no longer 'queued' (a turn
 * boundary claimed them first) and refuses entirely when the exec is no longer
 * running (its finalize may already have reconciled — the staged files are
 * inert garbage in a dead exec's dir, cleaned on container restart).
 *
 * The delivered rows themselves are the drain's "steer pending" signal: it
 * watches the steer dir for the hook's consumed.* markers (and the stream for
 * the Stop-hook sentinel) and seals the current message segment only at the
 * OBSERVED injection — staging time would strand the rest of the current
 * answer below the steered user message. The steerSeamRequestedAt stamp is
 * still written for the deploy window only (in-flight pre-deploy actions
 * consume it via the old per-flush poll); see its @deprecated schema note. */
export const markDelivered = internalMutation({
  args: {
    threadId: v.string(),
    queueIds: v.array(v.id('chatMessageQueue')),
    execId: v.string(),
    /** 'file' = staged steer-*.json (hook consumes, markers are evidence);
     * 'stdin' = pushed into the held-open stdin by the drain's linger loop
     * (the next agent result is the evidence). Optional for the deploy
     * window — pre-deploy steer_delivery omits it, and those are files. */
    channel: v.optional(v.union(v.literal('file'), v.literal('stdin'))),
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
          deliveredChannel: args.channel ?? ('file' as const),
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

/** Linger-loop channel conversion: a row file-staged just before the exec went
 * idle would sit unconsumed forever (no hook boundaries fire while the model
 * idles), so the drain tombstones the file and re-pushes the content via
 * stdin. This flips the evidence contract for those rows — the tombstone's
 * consumed.* marker must NOT count (see reconcileSteeredMessages), only the
 * next agent result does. */
export const markStdinRedelivered = internalMutation({
  args: { threadId: v.string(), queueIds: v.array(v.id('chatMessageQueue')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const queueId of args.queueIds) {
      const row = await ctx.db.get(queueId);
      if (row && row.status === 'delivered') {
        await ctx.db.patch(queueId, {
          deliveredChannel: 'stdin' as const,
          deliveredAt: Date.now(),
        });
      }
    }
    return null;
  },
});

/** Live consumption signal (Stop-hook stream sentinel or the drain's
 * consumed.* dir poll): flip delivered rows → consumed so the UI pill updates
 * mid-turn. Returns the number of rows actually flipped — the drain trips the
 * steer seam only on a count > 0, which is what makes the trip exactly-once
 * across replayed sentinels, double detection (a Stop-hook consumption leaves
 * BOTH the marker file and the stream sentinel), and racing continuations:
 * the scan is delivered-only, so a second call for the same ids returns 0. */
export const markConsumed = internalMutation({
  args: { threadId: v.string(), messageIds: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const wanted = new Set(args.messageIds);
    const delivered = await listByStatus(ctx, args.threadId, 'delivered');
    const matches = delivered
      .filter((row) => wanted.has(row.messageId))
      .sort((a, b) => a.createdAt - b.createdAt);
    let flipped = 0;
    for (const row of matches) {
      // The observed injection IS the pick: create the transcript copy now,
      // BEFORE the drain trips the steer seam, so the user bubble sorts
      // between the sealed segment and the fresh post-steer one.
      await persistPickedRow(ctx, row);
      await ctx.db.patch(row._id, { status: 'consumed' as const });
      flipped += 1;
    }
    return flipped;
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
        // Late pick (the drain died before observing the consumption): the
        // agent DID receive the text, so the transcript copy must still be
        // created — at reconcile time, the closest position we can honestly
        // give it.
        await persistPickedRow(ctx, row);
        await ctx.db.patch(row._id, { status: 'consumed' as const });
      } else {
        await ctx.db.patch(row._id, {
          status: 'queued' as const,
          deliveredExecId: undefined,
          deliveredAt: undefined,
          deliveredChannel: undefined,
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
    // Persist-at-pick rows have no transcript copy while queued — only legacy
    // rows (saved at enqueue, in flight across the deploy) carry one.
    if (!row.deferredPersist) {
      await ctx.runMutation(components.agent.messages.deleteByIds, {
        messageIds: [row.messageId],
      });
    }
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
      /** Transcript copy id once the row was picked (persist-at-pick) — lets
       * the UI match a retiring tray entry to its just-revealed bubble. For
       * legacy rows this equals `messageId`. */
      savedMessageId: v.optional(v.string()),
      text: v.string(),
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
    // Send order: the strip renders these in the order the user typed them.
    // The index is keyed on (threadId, status), so the collect is unordered.
    rows.sort((a, b) => a.createdAt - b.createdAt);
    return rows.map((r) => ({
      queueId: r._id,
      messageId: r.messageId,
      savedMessageId: r.deferredPersist ? r.savedMessageId : r.messageId,
      text: r.text,
      status: r.status,
      createdAt: r.createdAt,
    }));
  },
});
