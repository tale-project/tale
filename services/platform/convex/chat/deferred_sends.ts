/**
 * Send-then-wait for attachments — the 0.3 "waiting_media" model, v4-native.
 *
 * Clicking Send while a staged document still RAG-indexes, an audio/video
 * clip still transcribes, or a pasted video link still ingests does not
 * block: the send parks as a `deferredSends` row and the readiness watcher
 * below starts the turn server-side — under the row's stored identity, the
 * `startTurnForApiKey` posture — the moment every tracked medium is
 * terminal and the thread is idle.
 *
 * Readiness matrix (0.3's, `threads/media_send.ts`):
 *  - video-link job: transcript captured (`completed`, or Whisper handoff
 *    whose fileMetadata transcription completed). `failed` WAITS — the chip
 *    offers retry/remove, the user decides; cancelling the send cancels
 *    the jobs outright.
 *  - A/V upload: transcription out of `queued|running` — `failed`/`skipped`
 *    proceed degraded (the turn injects an honest marker).
 *  - document upload: `ragStatus` out of `queued|running` — content is
 *    unreadable before terminal; `failed`/`unsupported` proceed degraded.
 *  - image: never gated.
 */

import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { CHAT_MAX_FILE_COUNT } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  bindJobsForDeferredSend,
  buildBoundJobAttachments,
  cancelDeferredJobs,
} from '../video_links/bind_for_send';
import { reasoningEffortValidator } from './schema';
import { loadOwnedThread } from './threads';

const READY_POLL_MS = 3_000;
const SLOW_POLL_MS = 15_000;
/** After two minutes, back the poll off — a long Whisper run or a
 * failed-chip stall should not burn a mutation every 3s for hours. */
const SLOW_AFTER_MS = 2 * 60_000;
/** Waiting + claimed rows per thread. A bound, not a quota. */
const MAX_DEFERRED_PER_THREAD = 10;

const attachmentValidator = v.object({
  fileId: v.string(),
  fileName: v.string(),
  fileType: v.string(),
  fileSize: v.number(),
});

async function requireOrgUser(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<string> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new AppError({ code: 'UNAUTHENTICATED' });
  await getOrganizationMember(ctx, organizationId, authUser);
  return authUser.userId;
}

/**
 * Park a send. The caller (chat surface) already created the thread — the
 * v4 send flow is thread-first — so the row always has one. Video jobs are
 * claimed HERE (chips leave the composer); their payloads are built at turn
 * start, when they are terminal.
 */
export const enqueueDeferredSend = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    userText: v.string(),
    attachments: v.optional(v.array(attachmentValidator)),
    videoJobIds: v.optional(v.array(v.id('videoLinkJobs'))),
    /** Exactly one of `modelId` and `modelSelection: 'auto'`. An Auto row
     * stores the MODE, not a model: resolution happens at turn start, when
     * the settled media and final prompt are what the pick should read. */
    modelId: v.optional(v.string()),
    modelSelection: v.optional(v.literal('auto')),
    providerSlug: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
    locale: v.optional(v.string()),
  },
  returns: v.object({ deferredSendId: v.id('deferredSends') }),
  handler: async (ctx, args) => {
    if ((args.modelId === undefined) === (args.modelSelection === undefined)) {
      throw new AppError({ code: 'MODEL_REQUIRED' });
    }
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (thread === null) {
      throw new AppError({ code: 'THREAD_NOT_FOUND' });
    }

    const trimmed = args.userText.trim();
    const mediaCount =
      (args.attachments?.length ?? 0) + (args.videoJobIds?.length ?? 0);
    if (trimmed.length === 0 && mediaCount === 0) {
      throw new AppError({ code: 'EMPTY_MESSAGE' });
    }
    if ((args.attachments?.length ?? 0) > CHAT_MAX_FILE_COUNT) {
      throw new AppError({ code: 'TOO_MANY_ATTACHMENTS' });
    }

    const pending = await ctx.db
      .query('deferredSends')
      .withIndex('by_thread_status', (q) => q.eq('threadId', args.threadId))
      .collect();
    if (pending.length >= MAX_DEFERRED_PER_THREAD) {
      throw new AppError({ code: 'QUEUE_FULL' });
    }

    const claimed = await bindJobsForDeferredSend(ctx, {
      jobIds: args.videoJobIds ?? [],
      userId,
      threadId: args.threadId,
      organizationId: args.organizationId,
    });

    const now = Date.now();
    const deferredSendId = await ctx.db.insert('deferredSends', {
      organizationId: args.organizationId,
      userId,
      threadId: args.threadId,
      userText: trimmed,
      ...(args.attachments !== undefined && args.attachments.length > 0
        ? { attachments: args.attachments }
        : {}),
      ...(claimed.length > 0 ? { videoJobIds: claimed } : {}),
      ...(args.modelId !== undefined ? { modelId: args.modelId } : {}),
      ...(args.modelSelection !== undefined
        ? { modelSelection: args.modelSelection }
        : {}),
      ...(args.providerSlug !== undefined
        ? { providerSlug: args.providerSlug }
        : {}),
      ...(args.reasoningEffort !== undefined
        ? { reasoningEffort: args.reasoningEffort }
        : {}),
      locale: args.locale ?? 'en',
      status: 'waiting',
      createdAt: now,
      waitingSince: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.chat.deferred_sends.checkDeferredSendReadiness,
      { deferredSendId },
    );
    return { deferredSendId };
  },
});

/**
 * Abandon a waiting send. Cancelling the message cancels its claimed video
 * jobs too (the user dismissed the whole thing — 0.3's cascade); uploaded
 * attachments stay staged-side-effects (bytes are already stored and the
 * composer restore is the client's job). A `claimed` row is already
 * running — too late, refuse quietly.
 */
export const cancelDeferredSend = mutation({
  args: {
    organizationId: v.string(),
    deferredSendId: v.id('deferredSends'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const row = await ctx.db.get(args.deferredSendId);
    if (
      row === null ||
      row.organizationId !== args.organizationId ||
      row.userId !== userId ||
      row.status !== 'waiting'
    ) {
      return false;
    }
    await cancelDeferredJobs(ctx, row.videoJobIds ?? [], userId);
    await ctx.db.delete(row._id);
    return true;
  },
});

/** The thread's parked sends, oldest first — the tray above the composer.
 * Carries the full attachment snapshot and the claimed job ids so the tray
 * can show each medium's LIVE progress (and a failed video's retry) while
 * the send waits — the 0.3 waiting-media detail, without which a failed
 * job would leave the row stuck with no explanation and no way out. */
export const listDeferredSends = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.array(
    v.object({
      deferredSendId: v.id('deferredSends'),
      userText: v.string(),
      attachments: v.array(attachmentValidator),
      videoJobIds: v.array(v.id('videoLinkJobs')),
      status: v.union(v.literal('waiting'), v.literal('claimed')),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (thread === null) return [];
    const rows = await ctx.db
      .query('deferredSends')
      .withIndex('by_thread_status', (q) => q.eq('threadId', args.threadId))
      .collect();
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        deferredSendId: row._id,
        userText: row.userText,
        attachments: row.attachments ?? [],
        videoJobIds: row.videoJobIds ?? [],
        status: row.status,
        createdAt: row.createdAt,
      }));
  },
});

export const getDeferredSendInternal = internalQuery({
  args: { deferredSendId: v.id('deferredSends') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deferredSendId);
  },
});

/** Readiness per the module-doc matrix. Exported for tests. */
export async function isDeferredSendReady(
  ctx: MutationCtx,
  row: Doc<'deferredSends'>,
): Promise<boolean> {
  for (const jobId of row.videoJobIds ?? []) {
    const job = await ctx.db.get(jobId);
    if (!job) continue; // erased — proceed without it
    if (job.status === 'completed') continue;
    if (job.status === 'skipped') continue; // cancelled — excluded at start
    if (job.status === 'failed') return false; // user action (retry/remove)
    if (job.status === 'transcribing_handoff' && job.fileMetadataId) {
      const meta = await ctx.db.get(job.fileMetadataId);
      if (meta?.transcriptionStatus === 'completed') continue;
      if (
        meta?.transcriptionStatus === 'failed' ||
        meta?.transcriptionStatus === 'skipped'
      ) {
        return false; // Whisper failed — same user-action posture
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
    if (
      meta.transcriptionStatus === 'queued' ||
      meta.transcriptionStatus === 'running'
    ) {
      return false;
    }
    if (meta.ragStatus === 'queued' || meta.ragStatus === 'running') {
      return false;
    }
  }

  return true;
}

/**
 * The watcher chain: poll until ready AND the thread is idle, then claim
 * the row and hand it to the turn action. A deleted row (user cancelled)
 * ends the chain silently.
 */
export const checkDeferredSendReadiness = internalMutation({
  args: { deferredSendId: v.id('deferredSends') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db.get(args.deferredSendId);
    if (!row || row.status !== 'waiting') return null;

    const reschedule = async (delayMs: number) => {
      await ctx.scheduler.runAfter(
        delayMs,
        internal.chat.deferred_sends.checkDeferredSendReadiness,
        { deferredSendId: args.deferredSendId },
      );
    };

    const ready = await isDeferredSendReady(ctx, row);
    if (!ready) {
      const age = Date.now() - row.waitingSince;
      await reschedule(age > SLOW_AFTER_MS ? SLOW_POLL_MS : READY_POLL_MS);
      return null;
    }

    // One turn per thread: while a generation row exists, wait our turn.
    const normalized = ctx.db.normalizeId('threads', row.threadId);
    if (normalized !== null) {
      const generation = await ctx.db
        .query('generations')
        .withIndex('by_thread', (q) => q.eq('threadId', normalized))
        .first();
      if (generation !== null) {
        await reschedule(READY_POLL_MS);
        return null;
      }
    }

    // Build the video payloads NOW (they are terminal) — the action gets a
    // plain merged list, no MutationCtx needed on its side.
    const videoPayloads = await buildBoundJobAttachments(
      ctx,
      row.videoJobIds ?? [],
    );
    const attachments = [...(row.attachments ?? []), ...videoPayloads];

    await ctx.db.patch(row._id, { status: 'claimed' });
    await ctx.scheduler.runAfter(0, internal.chat.turn_action.runDeferredSend, {
      deferredSendId: args.deferredSendId,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    return null;
  },
});

/** Settle the row — delete it. Normally fired the moment the turn persists
 * the user message (the store decoration in `turn_action.ts`): the thread
 * shows the bubble from then on, so the tray row would only double-display.
 * The turn action's `finally` fires it again as the terminal mop-up for
 * pre-append failures and orphans; deleting a deleted row is a no-op. */
export const settleDeferredSend = internalMutation({
  args: { deferredSendId: v.id('deferredSends') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deferredSendId);
    if (row !== null) await ctx.db.delete(row._id);
    return null;
  },
});

/** The turn found the thread busy after all (a race with a direct send) —
 * back to waiting; the watcher retries shortly. */
export const requeueDeferredSend = internalMutation({
  args: { deferredSendId: v.id('deferredSends') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.deferredSendId);
    if (row === null) return null;
    await ctx.db.patch(row._id, { status: 'waiting' });
    await ctx.scheduler.runAfter(
      READY_POLL_MS,
      internal.chat.deferred_sends.checkDeferredSendReadiness,
      { deferredSendId: args.deferredSendId },
    );
    return null;
  },
});
