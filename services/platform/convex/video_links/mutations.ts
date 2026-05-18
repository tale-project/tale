import { ConvexError, v } from 'convex/values';

import {
  detectPlatform,
  isPlaylistUrl,
  normalizeUrlForHash,
} from '../../lib/shared/video-url';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { checkOrganizationRateLimit } from '../lib/rate_limiter/helpers';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

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
    const callerIdentity = {
      userId,
      email: authUser.email,
      name: authUser.name,
    };

    // Cross-org gate: caller must be a member of the org they're charging.
    // Without this, any authenticated user could spend another org's
    // file:upload rate-limit + in-flight cap by passing the target orgId.
    await getOrganizationMember(ctx, args.organizationId, callerIdentity);

    // Thread-access gate when a thread was supplied. assertThreadAccess
    // covers: ownership, sharing, org-membership for the thread's org, and
    // soft-deleted-thread rejection — strictly stronger than the previous
    // hand-rolled org-id comparison.
    const threadIdArg = args.threadId;
    if (threadIdArg !== undefined) {
      await assertThreadAccess(
        ctx,
        threadIdArg,
        callerIdentity,
        args.organizationId,
      );
    }

    // Refuse standalone playlist URLs synchronously — surfaced as a toast
    // before any chip is rendered. ConvexError code matches the i18n key
    // under `videoLink.errors.*` so the frontend can localize without
    // string-matching the message.
    if (isPlaylistUrl(args.url)) {
      throw new ConvexError({
        code: 'playlist',
        message:
          'Playlist URLs are not supported — paste a single video link instead',
      });
    }

    // Rate-limit (reuses file:upload bucket: 50/min/org)
    await checkOrganizationRateLimit(ctx, 'file:upload', args.organizationId);

    // SERVER-SIDE derive the dedup key + platform tag — do NOT trust
    // client-supplied `normalizedUrl` / `sourcePlatform`. A hostile client
    // could otherwise (a) collide-hash a different URL into an existing
    // job's dedup slot to short-circuit fresh ingest, or (b) lie about
    // platform to confuse downstream chip iconography / telemetry.
    const serverNormalized = normalizeUrlForHash(args.url);
    const serverPlatform = detectPlatform(args.url);
    const sourceUrlHash = hashUrlForDedup(serverNormalized);

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
      // Refresh `pastedToken` to the most recent paste's substring. The
      // bind path uses this verbatim to strip the URL from the outgoing
      // message text via `String.prototype.replace` — a stale token from
      // the first paste won't match the second paste's punctuation, and
      // the raw URL leaks through to the LLM input alongside the
      // transcript attachment.
      if (args.pastedToken !== existing.pastedToken) {
        await ctx.db.patch(existing._id, { pastedToken: args.pastedToken });
      }
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
        throw new ConvexError({
          code: 'inFlightCap',
          message: `At most ${MAX_IN_FLIGHT_PER_ORG} video links can process at once. Wait for one to finish.`,
        });
      }
    }

    const jobId = await ctx.db.insert('videoLinkJobs', {
      organizationId: args.organizationId,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      uploadedBy: userId,
      sourceUrl: args.url,
      sourceUrlHash,
      sourcePlatform: serverPlatform,
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
 * Auth: uploader-only for v1. Org-admin override is a tracked follow-up
 * issue — see the PR description for the link.
 */
export const cancelVideoLink = mutation({
  args: { jobId: v.id('videoLinkJobs') },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const userId = String(authUser._id);

    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error('Video link not found');

    // Org-membership gate: a user who has been removed from the org can no
    // longer touch its rows even on their own historical jobs.
    await getOrganizationMember(ctx, job.organizationId, {
      userId,
      email: authUser.email,
      name: authUser.name,
    });

    if (job.uploadedBy !== userId) {
      // Uploader-only for v1 (org-admin override deferred — tracked).
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
    // metadata never landed. Only fires when storageId is populated —
    // Whisper-handoff status implies the audio blob was stored, but the
    // optional-type guard keeps TS honest and survives any future race.
    if (
      job.fileMetadataId &&
      job.storageId &&
      job.status === 'transcribing_handoff'
    ) {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileTranscription,
        {
          storageId: job.storageId,
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

    await getOrganizationMember(ctx, job.organizationId, {
      userId,
      email: authUser.email,
      name: authUser.name,
    });

    if (job.uploadedBy !== userId) {
      throw new Error('Only the uploader can retry this video link');
    }
    if (job.status !== 'failed' && job.status !== 'skipped') {
      throw new Error(
        `Can only retry failed or skipped video links (current: ${job.status})`,
      );
    }

    // Cooldown: do not let users hammer-retry a bot-flagged / rate-limited
    // URL. Each retry burns a yt-dlp call and digs the per-IP block on
    // YouTube etc. deeper. 15-min cooldown matches the typical block
    // duration; user can paste the URL fresh to bypass the dedup window
    // and start a new job if they truly need to.
    const RETRY_COOLDOWN_MS = 15 * 60_000;
    if (
      (job.errorReasonCode === 'botDetection' ||
        job.errorReasonCode === 'rateLimited') &&
      Date.now() - (job.statusChangedAt ?? job._creationTime) <
        RETRY_COOLDOWN_MS
    ) {
      throw new ConvexError({
        code: 'retryCooldown',
        message:
          'This video failed with a rate-limit / bot-detection signal. Please wait a few minutes before retrying.',
      });
    }

    // Reuse `ingestVideoUrl`'s abuse gates so retries cannot bypass them.
    // Without this, a user looping `retryVideoLink` over N pre-existing
    // failed jobs could spawn unlimited concurrent yt-dlp/Whisper work
    // (round-2 V8 / HIGH #11).
    await checkOrganizationRateLimit(ctx, 'file:upload', job.organizationId);
    let inFlight = 0;
    for (const status of NON_TERMINAL_STATUSES) {
      const rows = await ctx.db
        .query('videoLinkJobs')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', job.organizationId).eq('status', status),
        )
        .collect();
      inFlight += rows.length;
      if (inFlight >= MAX_IN_FLIGHT_PER_ORG) {
        throw new ConvexError({
          code: 'inFlightCap',
          message: `At most ${MAX_IN_FLIGHT_PER_ORG} video links can process at once. Wait for one to finish.`,
        });
      }
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
    const callerIdentity = {
      userId,
      email: authUser.email,
      name: authUser.name,
    };

    // Org-membership gate + thread-access gate. Without these, any
    // authenticated user could pass another org's threadId here and pull
    // back the existence + URL hashes of every video-link row in that
    // thread (the uploader-only filter below only narrows to *their own*
    // rows, but the scan still leaks the unrelated rows' existence via
    // timing and the surrounding query).
    await getOrganizationMember(ctx, args.organizationId, callerIdentity);
    await assertThreadAccess(
      ctx,
      args.threadId,
      callerIdentity,
      args.organizationId,
    );

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
      fileId: Id<'_storage'>;
      fileName: string;
      fileType: string;
      fileSize: number;
      /** Original substring as pasted by the user. The client strips
       * this from the outgoing message text so the LLM doesn't see both
       * the raw URL and the transcript-fileId attachment. */
      pastedToken: string;
      /** Job row id. The send hook tracks this in a local ref so that on
       * downstream send failure (chatWithAgent throw) it can call
       * `unbindJobsFromMessage` to reverse the bind — otherwise the chip
       * disappears from the composer permanently and the user can't
       * recover the transcript without re-pasting. */
      jobId: Id<'videoLinkJobs'>;
    }> = [];

    for (const job of candidates) {
      // Only bind jobs the caller owns — prevents one user's chips from
      // attaching to another user's message in shared threads.
      if (job.uploadedBy !== userId) continue;
      // Skip jobs already bound to a sent message. messageBoundAt is the
      // single source of truth for bind status (R2 review: the previous
      // implementation guarded on lifecycleStatus==='bound' but wrote
      // 'active', so the guard never fired and double-bind was possible).
      if (job.messageBoundAt !== undefined) continue;
      if (!job.storageId || !job.fileMetadataId) continue;

      const fileMeta = await ctx.db.get(job.fileMetadataId);
      if (!fileMeta) continue;

      await ctx.db.patch(job._id, {
        // Pre-thread rows get their threadId stamped now that the
        // first send has created one. Already-in-thread rows are no-op
        // on this field.
        ...(job.threadId === undefined ? { threadId: args.threadId } : {}),
        messageBoundAt: Date.now(),
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
        jobId: job._id,
      });
    }

    return out;
  },
});

/**
 * Reverse the bind stamped by `bindCompletedJobsToMessage`. Called from
 * `use-send-message.ts` when the downstream `chatWithAgent` /
 * `arenaChatAction` invocation throws — without this, the bound chips
 * stay hidden from the composer (the chip query filters out
 * `messageBoundAt !== undefined`) so the user loses BOTH the typed text
 * AND every transcript on a failed send (round-2 V10 / HIGH #17).
 *
 * Idempotent: re-invoking for a job that no longer exists or that has
 * already been un-bound is a silent no-op.
 */
export const unbindJobsFromMessage = mutation({
  args: { jobIds: v.array(v.id('videoLinkJobs')) },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const userId = String(authUser._id);

    for (const jobId of args.jobIds) {
      const job = await ctx.db.get(jobId);
      if (!job) continue;
      // Ownership gate — a hostile caller can't un-bind another user's
      // chips. Org-membership gate is implicit via `uploadedBy === userId`.
      if (job.uploadedBy !== userId) continue;
      if (job.messageBoundAt === undefined) continue;
      await ctx.db.patch(jobId, { messageBoundAt: undefined });
    }
  },
});
