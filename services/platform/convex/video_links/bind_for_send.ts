import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Video-job binding for the send-then-wait path (threads/media_send.ts).
 *
 * A deferred media send claims its video jobs at ENQUEUE — non-terminal jobs
 * included, that is the point — by stamping `messageBoundAt` (+ `threadId`
 * for welcome-page rows). The stamp is what releases the chips from the
 * composer (`useChatVideoLinks` filters bound rows) and keeps
 * `bindCompletedJobsToMessage` from double-binding them into another send.
 * The attachment payloads are built later, at turn START, when the jobs are
 * terminal; deleting the waiting row unbinds so the chips reappear in the
 * composer and the existing retry/remove flows take over.
 *
 * Sibling of `bindCompletedJobsToMessage` (mutations.ts) — that one scans a
 * thread for completed-only jobs at direct-send time; these helpers work an
 * explicit id list for a stored user with no auth context.
 */

export interface BoundJobAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/** Enqueue-time claim. Skips anything not claimable (foreign, bound,
 * cancelled, trashed); returns the ids actually claimed. */
export async function bindJobsForDeferredSend(
  ctx: MutationCtx,
  args: {
    jobIds: readonly Id<'videoLinkJobs'>[];
    userId: string;
    threadId: string;
    organizationId: string;
  },
): Promise<Id<'videoLinkJobs'>[]> {
  const now = Date.now();
  const claimed: Id<'videoLinkJobs'>[] = [];
  for (const jobId of args.jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job) continue;
    if (job.organizationId !== args.organizationId) continue;
    if (job.uploadedBy !== args.userId) continue;
    if (job.messageBoundAt !== undefined) continue;
    if (job.status === 'skipped') continue;
    if (job.lifecycleStatus === 'trashed') continue;
    await ctx.db.patch(jobId, {
      ...(job.threadId === undefined && { threadId: args.threadId }),
      messageBoundAt: now,
    });
    claimed.push(jobId);
  }
  return claimed;
}

/**
 * Start-time payloads — the same shape `bindCompletedJobsToMessage` puts on
 * a direct send's attachments (fileType keeps the 'video/mp4' routing
 * sentinel; see that mutation). Jobs without a completed transcript by now
 * (failed, cancelled, erased) are excluded — the turn proceeds without them.
 */
export async function buildBoundJobAttachments(
  ctx: MutationCtx,
  jobIds: readonly Id<'videoLinkJobs'>[],
): Promise<BoundJobAttachment[]> {
  const out: BoundJobAttachment[] = [];
  for (const jobId of jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job || !job.storageId || !job.fileMetadataId) continue;
    const meta = await ctx.db.get(job.fileMetadataId);
    if (!meta) continue;
    // Captions/clone branch ends 'completed'; the Whisper branch stays
    // 'transcribing_handoff' with completion recorded on the fileMetadata
    // row — mirror bindCompletedJobsToMessage's projection.
    const transcriptReady =
      job.status === 'completed' ||
      (job.status === 'transcribing_handoff' &&
        meta.transcriptionStatus === 'completed');
    if (!transcriptReady) continue;
    out.push({
      fileId: job.storageId,
      fileName: job.videoTitle ?? 'Video link',
      fileType: 'video/mp4',
      fileSize: meta.size,
    });
  }
  return out;
}

/** Delete-time release: clear `messageBoundAt` on the row owner's jobs so
 * the unbound chips reappear in the composer. */
export async function unbindDeferredJobs(
  ctx: MutationCtx,
  jobIds: readonly Id<'videoLinkJobs'>[],
  userId: string,
): Promise<void> {
  for (const jobId of jobIds) {
    const job = await ctx.db.get(jobId);
    if (!job) continue;
    if (job.uploadedBy !== userId) continue;
    if (job.messageBoundAt === undefined) continue;
    await ctx.db.patch(jobId, { messageBoundAt: undefined });
  }
}
