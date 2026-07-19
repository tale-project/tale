import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from '../_generated/server';
import { validateChatAttachmentCaps } from '../agents/chat_turn';
import { isDrainingNow } from '../control/drain';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { persistentStreaming } from '../streaming/helpers';
import {
  bindJobsForDeferredSend,
  buildBoundJobAttachments,
} from '../video_links/bind_for_send';
import { MAX_QUEUED_PER_THREAD } from './message_queue';

/**
 * Send-then-wait for media ("thread-first"): Send is allowed while video
 * ingest / transcription / RAG indexing still runs. The send parks as a
 * `chatMessageQueue` row with `status='waiting_media'`; the readiness
 * watcher below starts the agent turn server-side (under the row's stored
 * identity — same posture as the text queue's `startQueuedTurn`) the moment
 * every tracked medium is terminal-ready and the thread is idle.
 *
 * Waiting rows never enter the text-queue drain paths (those filter exact
 * statuses); a started row is `claimed` under its turn's streamId, so the
 * existing `settleQueueOnTurnEnd` retires it at the boundary.
 *
 * Readiness matrix (see the plan note; PR #2808 changed it):
 *  - video job: transcript captured (`completed`, or Whisper-handoff with a
 *    completed fileMetadata). RAG is NOT awaited — `document_retrieve`
 *    serves the row transcript while indexing runs.
 *  - A/V upload: `transcriptionStatus` terminal; `failed`/`skipped` proceed
 *    degraded (the agent reports it) — only pending/running wait.
 *  - doc upload: `ragStatus` out of `queued|running` (extraction lives
 *    inside indexing, so content is unreadable before terminal).
 *  - image: never gated.
 *  - video job `failed`: user action required — the row keeps waiting while
 *    the tray shows the failed chip's retry; deleting the row unbinds the
 *    chips back into the composer.
 */

const READY_POLL_MS = 3_000;
const SLOW_POLL_MS = 15_000;
/** After two minutes of waiting, back the poll off — long Whisper runs and
 * failed-chip stalls should not burn a mutation every 3s for hours. */
const SLOW_AFTER_MS = 2 * 60_000;
const DRAIN_REQUEUE_DELAY_MS = 5_000;

const attachmentValidator = v.object({
  fileId: blobRefValidator,
  fileName: v.string(),
  fileType: v.string(),
  fileSize: v.number(),
});

export const enqueueMediaSend = mutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    /** Typed text, already stripped of video pastedTokens client-side. May
     * be empty for attachment-only sends. */
    message: v.string(),
    agentSlug: v.string(),
    modelId: v.optional(v.string()),
    /** Committed uploads (bytes in storage — composer still gates on
     * isUploading). */
    attachments: v.optional(v.array(attachmentValidator)),
    /** Unbound video-link jobs in any state. */
    videoJobIds: v.optional(v.array(v.id('videoLinkJobs'))),
  },
  returns: v.object({ queueId: v.id('chatMessageQueue') }),
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
    const mediaCount =
      (args.attachments?.length ?? 0) + (args.videoJobIds?.length ?? 0);
    if (!trimmed && mediaCount === 0) {
      throw new ConvexError({ code: 'EMPTY_MESSAGE' });
    }
    validateChatAttachmentCaps(args.attachments);

    // Shared per-thread cap with the text queue: waiting + queued rows
    // together stay bounded.
    let pendingCount = 0;
    for (const status of ['waiting_media', 'queued'] as const) {
      const rows = await ctx.db
        .query('chatMessageQueue')
        .withIndex('by_threadId_status', (q) =>
          q.eq('threadId', args.threadId).eq('status', status),
        )
        .collect();
      pendingCount += rows.length;
    }
    if (pendingCount >= MAX_QUEUED_PER_THREAD) {
      throw new ConvexError({ code: 'QUEUE_FULL' });
    }

    const claimed = await bindJobsForDeferredSend(ctx, {
      jobIds: args.videoJobIds ?? [],
      userId: authUser.userId,
      threadId: args.threadId,
      organizationId: args.organizationId,
    });

    const now = Date.now();
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
      status: 'waiting_media' as const,
      createdAt: now,
      waitingSince: now,
      ...(args.attachments !== undefined &&
        args.attachments.length > 0 && { attachments: args.attachments }),
      ...(claimed.length > 0 && { videoJobIds: claimed }),
    });
    await ctx.db.patch(rowId, { messageId: String(rowId) });

    await ctx.scheduler.runAfter(
      0,
      internal.threads.media_send.checkMediaSendReadiness,
      { queueId: rowId },
    );

    return { queueId: rowId };
  },
});

/** Readiness per the matrix in the module doc. Exported for tests. */
export async function isMediaSendReady(
  ctx: MutationCtx,
  row: Doc<'chatMessageQueue'>,
): Promise<boolean> {
  for (const jobId of row.videoJobIds ?? []) {
    const job = await ctx.db.get(jobId);
    if (!job) continue; // erased — proceed without it
    if (job.status === 'completed') continue;
    if (job.status === 'skipped') continue; // cancelled — excluded at start
    if (job.status === 'failed') return false; // user action (retry/delete)
    if (job.status === 'transcribing_handoff' && job.fileMetadataId) {
      const meta = await ctx.db.get(job.fileMetadataId);
      if (meta?.transcriptionStatus === 'completed') continue;
      if (
        meta?.transcriptionStatus === 'failed' ||
        meta?.transcriptionStatus === 'skipped'
      ) {
        return false; // Whisper failed — same user-action posture as 'failed'
      }
    }
    return false; // any other non-terminal phase
  }

  for (const attachment of row.attachments ?? []) {
    if (attachment.fileType.startsWith('image/')) continue;
    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', attachment.fileId))
      .first();
    if (!meta) continue; // no pipeline record — nothing to wait on
    const isAv =
      attachment.fileType.startsWith('audio/') ||
      attachment.fileType.startsWith('video/');
    if (isAv || meta.transcriptionStatus !== undefined) {
      // Terminal transcription is enough — document_retrieve serves the row
      // transcript while RAG indexing runs (PR #2808). failed/skipped
      // proceed degraded; only an active pipeline waits.
      if (
        meta.transcriptionStatus === 'queued' ||
        meta.transcriptionStatus === 'running'
      ) {
        return false;
      }
      continue;
    }
    // Document: content is only readable once indexing leaves the active
    // states (extraction happens inside the RAG pipeline).
    if (meta.ragStatus === 'queued' || meta.ragStatus === 'running') {
      return false;
    }
  }

  return true;
}

export const checkMediaSendReadiness = internalMutation({
  args: { queueId: v.id('chatMessageQueue') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db.get(args.queueId);
    // Deleted (user abandoned) or already started — the watcher chain ends.
    if (!row || row.status !== 'waiting_media') return null;

    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', row.threadId))
      .first();
    if (!meta) {
      // Thread erased while waiting — the row is an orphan. Jobs follow
      // their own erasure cascade; just drop the row.
      await ctx.db.delete(row._id);
      return null;
    }

    const reschedule = async (delayMs: number) => {
      await ctx.scheduler.runAfter(
        delayMs,
        internal.threads.media_send.checkMediaSendReadiness,
        { queueId: args.queueId },
      );
    };

    const ready = await isMediaSendReady(ctx, row);
    if (!ready) {
      const age = Date.now() - (row.waitingSince ?? row.createdAt);
      await reschedule(age > SLOW_AFTER_MS ? SLOW_POLL_MS : READY_POLL_MS);
      return null;
    }
    if (await isDrainingNow(ctx)) {
      await reschedule(DRAIN_REQUEUE_DELAY_MS);
      return null;
    }
    if (meta.generationStatus === 'generating') {
      // A turn is running — the media send starts at its own readiness, not
      // the text-queue boundary, so just try again shortly.
      await reschedule(READY_POLL_MS);
      return null;
    }

    await startMediaTurn(ctx, meta, row);
    return null;
  },
});

/**
 * Mirror of `startQueuedTurn` for ONE waiting row, with two deliberate
 * differences: attachments are forwarded (row snapshot + payloads of the
 * bound video jobs), and there is NO `queuedPromptMessageId` — the
 * generation pipeline saves the user message itself, so the bubble carries
 * the attachment cards exactly like a direct send.
 */
async function startMediaTurn(
  ctx: MutationCtx,
  meta: Doc<'threadMetadata'>,
  row: Doc<'chatMessageQueue'>,
): Promise<void> {
  const videoPayloads = await buildBoundJobAttachments(
    ctx,
    row.videoJobIds ?? [],
  );
  const attachments = [...(row.attachments ?? []), ...videoPayloads];

  const streamId = await persistentStreaming.createStream(ctx);
  const now = Date.now();
  await ctx.db.patch(row._id, {
    status: 'claimed' as const,
    claimedByStreamId: streamId,
    claimedAt: now,
  });
  await ctx.db.patch(meta._id, {
    generationStatus: 'generating' as const,
    streamId,
    generationStartTime: now,
    generationHeartbeatAt: undefined,
    updatedAt: now,
    lastReplyAt: now,
    liveRoute: undefined,
    cancelledAt: undefined,
    cancelledMessageId: undefined,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.agents.chat_turn_generate.runChatTurnGeneration,
    {
      agentSlug: row.agentSlug,
      organizationId: row.organizationId,
      message: row.text,
      threadId: meta.threadId,
      streamId,
      userId: row.userId,
      userEmail: row.userEmail,
      userName: row.userName,
      requestStartMs: now,
      ...(row.modelId !== undefined && { modelId: row.modelId }),
      ...(attachments.length > 0 && { attachments }),
      // External-thread agent lock parity with startQueuedTurn: the thread's
      // stored agent wins over stale per-user picker state.
      ...(meta.agentSlug !== undefined && { priorAgentSlug: meta.agentSlug }),
    },
  );
}
