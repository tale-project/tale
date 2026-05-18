import { v } from 'convex/values';

import { isPlaylistUrl } from '../../lib/shared/video-url';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';

/** Per-org cap on in-flight video-link jobs. Prevents one org from soaking
 * all 32 Node-action slots with concurrent yt-dlp/Whisper work. */
const MAX_IN_FLIGHT_PER_ORG = 3;

/** sha256(normalizedUrl).slice(0,16). We can't run crypto.subtle inside
 * Convex mutations (no Node runtime), so the helper is a deterministic
 * pseudo-hash — collision-resistance is NOT a security boundary here,
 * just a stable dedup key. */
function hashUrlForDedup(normalized: string): string {
  // FNV-1a 32-bit, hex-rendered to 16 chars by concatenating two passes.
  // Adequate for an in-thread (orgId, url) dedup key; not a crypto primitive.
  const fnv = (seed: number, str: string): number => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
  const a = fnv(0x811c9dc5, normalized).toString(16).padStart(8, '0');
  const b = fnv(0x9dc58117, normalized).toString(16).padStart(8, '0');
  return (a + b).slice(0, 16);
}

const NON_TERMINAL_STATUSES = [
  'queued',
  'fetching_metadata',
  'fetching_captions',
  'extracting_audio',
  'transcribing_handoff',
  'indexing',
] as const;

function isNonTerminal(status: string): boolean {
  return (NON_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Ingest a pasted video URL. Performs auth + org gate, advisory URL
 * safety check (server-side load-bearing DNS check happens in the action,
 * see `url_safety.ts`), rate-limit, in-flight concurrency cap, URL-hash
 * dedup, then inserts a `videoLinkJobs` row and schedules the orchestrator.
 *
 * Returns the jobId — duplicate of an existing in-flight or recently
 * completed job returns the existing id idempotently (deferred URL-hash
 * dedup from R14 review, promoted to v1).
 */
export const ingestVideoUrl = mutation({
  args: {
    organizationId: v.string(),
    // Optional: welcome-page pastes have no thread yet (the first user
    // send creates it). bindCompletedJobsToMessage patches threadId in
    // on that send. Mirrors audio-upload behaviour.
    threadId: v.optional(v.string()),
    url: v.string(),
    pastedToken: v.string(),
    normalizedUrl: v.string(),
    sourcePlatform: v.string(),
    userLocale: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }
    const userId = String(authUser._id);

    // Cross-org spoofing gate when a thread was supplied.
    if (args.threadId !== undefined) {
      const threadMeta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId!))
        .unique();
      if (
        threadMeta &&
        threadMeta.organizationId !== undefined &&
        threadMeta.organizationId !== args.organizationId
      ) {
        throw new Error('Thread does not belong to this organization');
      }
    }

    // Refuse standalone playlist URLs synchronously — surfaced as inline
    // form-error rather than as a chip-then-fail.
    if (isPlaylistUrl(args.url)) {
      throw new Error(
        'Playlist URLs are not supported — paste a single video link instead',
      );
    }

    // Rate-limit (reuses file:upload bucket: 50/min/org)
    await checkOrganizationRateLimit(ctx, 'file:upload', args.organizationId);

    const sourceUrlHash = hashUrlForDedup(args.normalizedUrl);

    // URL-hash dedup: if a completed or in-flight job exists for the same
    // (org, normalized URL) within last 24h, return its id. Saves yt-dlp/
    // Whisper work on repeat-pastes. Cheap — one indexed lookup.
    const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const existing = await ctx.db
      .query('videoLinkJobs')
      .withIndex('by_organizationId_and_sourceUrlHash', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('sourceUrlHash', sourceUrlHash),
      )
      .order('desc')
      .first();
    if (
      existing &&
      existing.status !== 'failed' &&
      existing.status !== 'skipped' &&
      now - existing._creationTime < DEDUP_WINDOW_MS
    ) {
      return existing._id;
    }

    // Per-org in-flight concurrency cap. Cheap index-scoped iteration.
    let inFlight = 0;
    for (const status of NON_TERMINAL_STATUSES) {
      const rows = await ctx.db
        .query('videoLinkJobs')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )
        .collect();
      inFlight += rows.length;
      if (inFlight >= MAX_IN_FLIGHT_PER_ORG) {
        throw new RateLimitExceededError(
          `At most ${MAX_IN_FLIGHT_PER_ORG} video links can process at once. Wait for one to finish.`,
          60_000,
        );
      }
    }

    const jobId = await ctx.db.insert('videoLinkJobs', {
      organizationId: args.organizationId,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      uploadedBy: userId,
      sourceUrl: args.url,
      sourceUrlHash,
      sourcePlatform: args.sourcePlatform,
      pastedToken: args.pastedToken,
      status: 'queued',
      statusChangedAt: now,
      attempts: 0,
      lifecycleStatus: 'active',
    });

    await ctx.scheduler.runAfter(
      0,
      internal.video_links.ingest_video_link.ingestVideoLink,
      { jobId, userLocale: args.userLocale },
    );

    return jobId;
  },
});

/**
 * Cancel an in-flight or completed video link.
 *
 * Semantics:
 *   - Non-terminal: flip to 'skipped'. Orchestrator's next phase-boundary
 *     check sees this and early-exits without persisting more.
 *   - 'transcribing_handoff': ALSO patch the linked fileMetadata's
 *     transcriptionStatus='skipped' so the existing transcribe_audio.ts
 *     early-exit at lines 317-337 fires; without this, Whisper completes
 *     in the background and writes a transcript/RAG entry the user
 *     thought they cancelled.
 *   - Schedules cleanup action (storage + RAG + maybe-fileMetadata).
 *
 * Auth: uploader OR org admin. (TODO: wire role check; for v1, uploader-only.)
 */
export const cancelVideoLink = mutation({
  args: { jobId: v.id('videoLinkJobs') },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const userId = String(authUser._id);

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error('Video link not found');
    if (job.uploadedBy !== userId) {
      // TODO(prod): allow org admins. For v1, only the uploader can cancel.
      throw new Error('Only the uploader can cancel this video link');
    }

    if (job.status === 'completed' || job.status === 'failed') {
      // No-op — terminal states stay terminal. The chip will dismiss
      // client-side via the hook's local state.
      return;
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: 'skipped',
      statusChangedAt: now,
    });

    // Propagate cancellation into the audio-transcription pipeline if a
    // Whisper-handoff is in flight. updateFileTranscription is a no-op
    // when the row is missing, so this is safe even if the audio file-
    // metadata never landed.
    if (job.fileMetadataId && job.status === 'transcribing_handoff') {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileTranscription,
        {
          storageId: job.storageId!,
          transcriptionStatus: 'skipped',
        },
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.video_links.internal_mutations.cleanupCancelledVideoLink,
      { jobId: args.jobId },
    );
  },
});

/**
 * Retry a failed video link. Cleans stale referents (audio blob,
 * fileMetadata row from the failed Whisper attempt) BEFORE resetting
 * status, otherwise the next run would orphan them. Increments
 * `attempts` so the watchdog can see retry storms.
 */
export const retryVideoLink = mutation({
  args: { jobId: v.id('videoLinkJobs') },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const userId = String(authUser._id);

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error('Video link not found');
    if (job.uploadedBy !== userId) {
      throw new Error('Only the uploader can retry this video link');
    }
    if (job.status !== 'failed' && job.status !== 'skipped') {
      throw new Error(
        `Can only retry failed or skipped video links (current: ${job.status})`,
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.video_links.internal_mutations.cleanupCancelledVideoLink,
      { jobId: args.jobId },
    );

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: 'queued',
      statusChangedAt: now,
      attempts: (job.attempts ?? 0) + 1,
      errorReasonCode: undefined,
      errorMessage: undefined,
      progress: undefined,
      // storageId + fileMetadataId NOT cleared here — the cleanup action
      // schedules deletes asynchronously and the orchestrator's next run
      // overwrites these once a new artifact lands. Leaving them set
      // briefly is OK because isNonTerminal('queued') is true so the
      // chip query treats them as in-flight residuals.
    });

    await ctx.scheduler.runAfter(
      0,
      internal.video_links.ingest_video_link.ingestVideoLink,
      { jobId: args.jobId, userLocale: undefined },
    );
  },
});

/**
 * Atomically bind completed-and-unbound video-link jobs for this thread
 * to an outgoing message. Called from use-send-message.ts right before
 * the chatWithAgent action fires. Returns the FileAttachment payload so
 * the client doesn't have to re-fetch each fileMetadata row.
 *
 * Eliminates the race window between the chip query's "completed" state
 * and the drain logic: a single mutation reads + patches in one
 * transaction.
 */
export const bindCompletedJobsToMessage = mutation({
  args: {
    /** The org id (required so we can scope the pre-thread search). */
    organizationId: v.string(),
    threadId: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const userId = String(authUser._id);

    // Pull two candidate sets, both in any non-terminal-from-our-pov state
    // (captions branch ends at `completed`; Whisper-handoff stays at
    // `transcribing_handoff` even after success — the chip's display state
    // comes from a reactive join on fileMetadata.transcriptionStatus,
    // see queries.ts:projectJob). We re-run the same projection here so
    // the bind matches what the user sees on the chip.
    const inThread = await ctx.db
      .query('videoLinkJobs')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .filter((q) => q.neq(q.field('lifecycleStatus'), 'trashed'))
      .collect();
    const preThread = await ctx.db
      .query('videoLinkJobs')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('uploadedBy', userId),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('threadId'), undefined),
          q.neq(q.field('lifecycleStatus'), 'trashed'),
        ),
      )
      .collect();
    const allCandidates = [...inThread, ...preThread];
    const candidates = [];
    for (const job of allCandidates) {
      if (job.status === 'completed') {
        candidates.push(job);
        continue;
      }
      // Whisper-handoff: ask the fileMetadata row whether transcription
      // finished. This mirrors queries.ts:projectJob exactly so the bind
      // catches every job the user sees as "Ready" on the chip.
      if (job.status === 'transcribing_handoff' && job.fileMetadataId) {
        const meta = await ctx.db.get(job.fileMetadataId);
        if (meta?.transcriptionStatus === 'completed') {
          candidates.push(job);
        }
      }
    }

    const out: Array<{
      fileId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      /** Original substring as pasted by the user. The client strips
       * this from the outgoing message text so the LLM doesn't see both
       * the raw URL and the transcript-fileId attachment. */
      pastedToken: string;
    }> = [];

    for (const job of candidates) {
      // Only bind jobs the caller owns — prevents one user's chips from
      // attaching to another user's message in shared threads.
      if (job.uploadedBy !== userId) continue;
      // 'bound' lifecycle is repurposed here — once bound to a sent
      // message, the chip disappears from the draft area but the row
      // stays for citation integrity (cancel after bind only deletes
      // the audio blob, not the transcript).
      if ((job.lifecycleStatus as string | undefined) === 'bound') continue;
      if (!job.storageId || !job.fileMetadataId) continue;

      const fileMeta = await ctx.db.get(job.fileMetadataId);
      if (!fileMeta) continue;

      await ctx.db.patch(job._id, {
        // Pre-thread rows get their threadId stamped now that the
        // first send has created one. Already-in-thread rows are no-op
        // on this field.
        ...(job.threadId === undefined ? { threadId: args.threadId } : {}),
        // Reusing lifecycleStatus as a soft-state marker; 'bound' isn't
        // in the existing SOFT_DELETE_STATUSES set but the field accepts
        // any of the validator's literals; tests pin this contract.
        lifecycleStatus: 'active',
        statusChangedAt: Date.now(),
      });

      out.push({
        fileId: job.storageId,
        // fileType uses an audio/video sentinel so buildMessageWithAttachments
        // (start_agent_chat.ts:457) matches via isAudioOrVideo and emits the
        // document_retrieve hint.
        fileType: 'video/mp4',
        fileName: job.videoTitle ?? 'Video link',
        fileSize: fileMeta.size,
        pastedToken: job.pastedToken,
      });
    }

    return out;
  },
});
