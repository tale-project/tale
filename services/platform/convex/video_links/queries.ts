import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Chip subscription queries. Two shapes:
 *   - listForThread: an active chat thread's chip area
 *   - listForUserUnboundChat: the welcome page (no thread yet) chip area
 *     — same row shape, scoped by (org, user, threadId IS NULL).
 *
 * Both reactively join `fileMetadata` for Whisper-handoff phases so the
 * chip flips to `completed` without any backend callback (R12 decision).
 */

interface VideoLinkJobView {
  jobId: Id<'videoLinkJobs'>;
  sourceUrl: string;
  sourcePlatform: string;
  pastedToken: string;
  videoTitle?: string;
  videoUploader?: string;
  videoDurationSec?: number;
  transcriptSource?: string;
  captionLang?: string;
  displayStatus: string;
  progress?: string;
  errorReasonCode?: string;
  errorMessage?: string;
  attempts?: number;
  storageId?: Id<'_storage'>;
  lifecycleStatus?: string;
  messageBoundAt?: number;
  uploadedBy: string;
  createdAt: number;
}

async function projectJob(
  ctx: QueryCtx,
  job: Doc<'videoLinkJobs'>,
): Promise<VideoLinkJobView> {
  let displayStatus: string = job.status;
  let progress = job.progress;
  let errorReasonCode = job.errorReasonCode;
  let errorMessage = job.errorMessage;

  // Retry state surfacing — see queries.ts comment from R14 round-2
  // review: a status='queued' with attempts>0 + errorReasonCode means
  // the orchestrator reset for backoff retry, not a fresh queue entry.
  // Show the reason ("retrying after botDetection") so the chip isn't
  // mute about lost progress.
  if (
    displayStatus === 'queued' &&
    (job.attempts ?? 0) > 0 &&
    errorReasonCode
  ) {
    displayStatus = 'retrying';
    progress = progress ?? `Attempt ${job.attempts}`;
  }

  // Whisper-handoff: project the linked fileMetadata's transcription
  // state into displayStatus. The chip stays reactive through this read.
  if (job.status === 'transcribing_handoff' && job.fileMetadataId) {
    const meta = await ctx.db.get(job.fileMetadataId);
    if (meta) {
      if (meta.transcriptionStatus === 'running') {
        displayStatus = 'transcribing_handoff';
        progress = meta.transcriptionProgress ?? progress;
      } else if (meta.transcriptionStatus === 'completed') {
        displayStatus = 'completed';
      } else if (meta.transcriptionStatus === 'failed') {
        displayStatus = 'failed';
        errorReasonCode = errorReasonCode ?? 'whisperFailed';
        errorMessage = errorMessage ?? meta.transcriptionError;
      } else if (meta.transcriptionStatus === 'skipped') {
        displayStatus = 'skipped';
      }
    }
  }

  return {
    jobId: job._id,
    sourceUrl: job.sourceUrl,
    sourcePlatform: job.sourcePlatform,
    pastedToken: job.pastedToken,
    videoTitle: job.videoTitle,
    videoUploader: job.videoUploader,
    videoDurationSec: job.videoDurationSec,
    transcriptSource: job.transcriptSource,
    captionLang: job.captionLang,
    displayStatus,
    progress,
    errorReasonCode,
    errorMessage,
    attempts: job.attempts,
    storageId: job.storageId,
    lifecycleStatus: job.lifecycleStatus,
    messageBoundAt: job.messageBoundAt,
    uploadedBy: job.uploadedBy,
    createdAt: job._creationTime,
  };
}

export const listForThread = query({
  args: { threadId: v.string(), organizationId: v.string() },
  async handler(ctx, args): Promise<VideoLinkJobView[]> {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return [];
    const callerIdentity = {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    };

    // Org membership + thread access. canAccessThread returns null on
    // forbidden — we surface that as an empty list to match the query's
    // soft-fail contract (reactive subscriptions shouldn't throw).
    try {
      await getOrganizationMember(ctx, args.organizationId, callerIdentity);
    } catch {
      return [];
    }
    const access = await canAccessThread(
      ctx,
      args.threadId,
      callerIdentity,
      args.organizationId,
    );
    if (!access) return [];

    const jobs = await ctx.db
      .query('videoLinkJobs')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .collect();

    return Promise.all(jobs.map((j) => projectJob(ctx, j)));
  },
});

/**
 * Welcome-page chip query. Returns the current user's in-flight or
 * completed-but-unbound video-link jobs that haven't been attached to a
 * thread yet. The first user send creates the thread; the bind mutation
 * patches threadId onto these rows and they migrate to listForThread's
 * scope automatically (Convex reactivity rebinds).
 */
export const listForUserUnboundChat = query({
  args: { organizationId: v.string() },
  async handler(ctx, args): Promise<VideoLinkJobView[]> {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return [];
    const userId = String(authUser._id);

    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return [];
    }

    const jobs = await ctx.db
      .query('videoLinkJobs')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('uploadedBy', userId),
      )
      .filter((q) => q.eq(q.field('threadId'), undefined))
      .order('asc')
      .collect();

    return Promise.all(jobs.map((j) => projectJob(ctx, j)));
  },
});
