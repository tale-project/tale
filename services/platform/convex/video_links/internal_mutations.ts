import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const STATUS_VALIDATOR = v.union(
  v.literal('queued'),
  v.literal('fetching_metadata'),
  v.literal('fetching_captions'),
  v.literal('extracting_audio'),
  v.literal('transcribing_handoff'),
  v.literal('indexing'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('skipped'),
);

const TRANSCRIPT_SOURCE_VALIDATOR = v.union(
  v.literal('captions_human'),
  v.literal('captions_auto'),
  v.literal('whisper'),
);

// Tight union so a backend caller emitting an unknown / snake_case code fails
// the Convex validator at write time, instead of silently propagating to the
// chip where it would fall through to the generic fallback. Keep in lockstep
// with YtDlpErrorReason (ytdlp.ts), UrlSafetyError.kind (url_safety.ts), and
// orchestrator-synthesized reasons in ingest_video_link.ts.
export type VideoLinkErrorReason =
  // YtDlpErrorReason
  | 'privateOrAgeGated'
  | 'unavailable'
  | 'geoblocked'
  | 'unsupported'
  | 'transient'
  | 'botDetection'
  | 'rateLimited'
  | 'forbidden'
  | 'liveStream'
  | 'premiere'
  | 'memberOnly'
  | 'jsRuntimeMissing'
  | 'binaryNotInstalled'
  | 'timeout'
  | 'outputValidationFailed'
  // UrlSafetyError.kind
  | 'invalidUrl'
  | 'unsupportedProtocol'
  | 'credentialedUrl'
  | 'ipLiteral'
  | 'playlist'
  | 'dnsResolutionFailed'
  | 'privateIpResolved'
  // Orchestrator-synthesized
  | 'videoTooLong'
  | 'whisperFailed';

const ERROR_REASON_CODE_VALIDATOR = v.union(
  // YtDlpErrorReason
  v.literal('privateOrAgeGated'),
  v.literal('unavailable'),
  v.literal('geoblocked'),
  v.literal('unsupported'),
  v.literal('transient'),
  v.literal('botDetection'),
  v.literal('rateLimited'),
  v.literal('forbidden'),
  v.literal('liveStream'),
  v.literal('premiere'),
  v.literal('memberOnly'),
  v.literal('jsRuntimeMissing'),
  v.literal('binaryNotInstalled'),
  v.literal('timeout'),
  v.literal('outputValidationFailed'),
  // UrlSafetyError.kind
  v.literal('invalidUrl'),
  v.literal('unsupportedProtocol'),
  v.literal('credentialedUrl'),
  v.literal('ipLiteral'),
  v.literal('playlist'),
  v.literal('dnsResolutionFailed'),
  v.literal('privateIpResolved'),
  // Orchestrator-synthesized
  v.literal('videoTooLong'),
  v.literal('whisperFailed'),
);

/**
 * Patch arbitrary fields on a videoLinkJobs row. ALWAYS sets
 * `statusChangedAt` when `status` changes — this is the watchdog's
 * single source of truth for staleness, so a missed touch means a
 * row stuck forever.
 *
 * Used by the orchestrator action (`ingest_video_link.ts`) at every
 * phase boundary.
 */
export const updateJob = internalMutation({
  args: {
    jobId: v.id('videoLinkJobs'),
    status: v.optional(STATUS_VALIDATOR),
    /**
     * Optional compare-and-swap: when set, the patch only commits if the
     * current row status equals `expectedStatus`. Protects against status
     * regression if two action instances ever fire concurrently (e.g. a
     * watchdog retry overlapping with a manual retry) — phase boundaries
     * own the expected pre-state, so a stale instance silently no-ops
     * instead of stomping a newer one's writes.
     */
    expectedStatus: v.optional(STATUS_VALIDATOR),
    progress: v.optional(v.string()),
    videoTitle: v.optional(v.string()),
    videoUploader: v.optional(v.string()),
    videoDurationSec: v.optional(v.number()),
    videoLanguage: v.optional(v.string()),
    videoChapters: v.optional(
      v.array(
        v.object({
          startSec: v.number(),
          endSec: v.number(),
          title: v.string(),
        }),
      ),
    ),
    transcriptSource: v.optional(TRANSCRIPT_SOURCE_VALIDATOR),
    captionTrackKind: v.optional(
      v.union(
        v.literal('manual'),
        v.literal('asr'),
        v.literal('auto-translated'),
      ),
    ),
    captionLang: v.optional(v.string()),
    storageId: v.optional(v.id('_storage')),
    fileMetadataId: v.optional(v.id('fileMetadata')),
    errorReasonCode: v.optional(ERROR_REASON_CODE_VALIDATOR),
    errorMessage: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const { jobId, status, expectedStatus, ...rest } = args;
    if (expectedStatus !== undefined) {
      const existing = await ctx.db.get(jobId);
      if (!existing) return; // row already cascaded — treat as cancellation
      if (existing.status !== expectedStatus) {
        console.warn(
          JSON.stringify({
            event: 'video_link.status_cas_miss',
            jobId,
            expected: expectedStatus,
            actual: existing.status,
          }),
        );
        return;
      }
    }
    const patch: Record<string, unknown> = { ...rest };
    if (status !== undefined) {
      patch.status = status;
      patch.statusChangedAt = Date.now();
    }
    await ctx.db.patch(jobId, patch);
  },
});

/**
 * Captions-branch finalizer. Creates a synthetic `fileMetadata` row that
 * carries the transcript blob + provenance fields so:
 *   - the chip UI can show "completed",
 *   - `buildMessageWithAttachments` finds the row and emits the
 *     document_retrieve hint to the agent,
 *   - RAG ingestion runs via the existing `uploadFileToRag` action.
 *
 * Prepends a provenance header to the transcript (per R8 review's
 * cheap-hygiene recommendation) so a downstream DMCA request can find
 * the source link in the artifact itself.
 */
export const insertSyntheticFileMetadata = internalMutation({
  args: {
    jobId: v.id('videoLinkJobs'),
    storageId: v.id('_storage'),
    transcript: v.string(),
    fileSize: v.number(),
    videoTitle: v.string(),
    videoUploader: v.optional(v.string()),
    videoDurationSec: v.number(),
    sourceUrl: v.string(),
    sourcePlatform: v.string(),
    transcriptSource: TRANSCRIPT_SOURCE_VALIDATOR,
    captionLang: v.optional(v.string()),
    threadId: v.optional(v.string()),
    organizationId: v.string(),
    uploadedBy: v.string(),
  },
  async handler(ctx, args) {
    const provenanceHeader = [
      `Source: ${args.sourceUrl}`,
      `Platform: ${args.sourcePlatform}`,
      args.videoUploader ? `Uploader: ${args.videoUploader}` : null,
      `Fetched: ${new Date().toISOString()}`,
      `Method: ${args.transcriptSource}${args.captionLang ? ` (lang=${args.captionLang})` : ''}`,
    ]
      .filter(Boolean)
      .join('\n');
    const transcriptWithHeader = `${provenanceHeader}\n\n${args.transcript}`;

    const fileMetadataId = await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      // Trust-distinct label: transcript was fetched from a third-party
      // site, not authored by the user. Downstream agent-side guards can
      // gate on this (see also wrapUntrusted in start_agent_chat.ts).
      source: 'video_link',
      fileName: `${args.videoTitle}.txt`,
      contentType: 'text/plain; charset=utf-8',
      size: args.fileSize,
      uploadedBy: args.uploadedBy,
      ...(args.threadId !== undefined && { threadId: args.threadId }),
      // Captions branch has no audio step — directly completed.
      transcript: transcriptWithHeader,
      transcriptionStatus: 'completed',
      transcriptionDurationSec: args.videoDurationSec,
      // RAG indexing happens via the scheduled uploadFileToRag below.
      transcriptRagStatus: 'queued',
      // Provenance fields (sourceUrl/sourcePlatform/videoTitle/uploader/
      // duration) are NOT written here — `start_agent_chat.ts` JOINs
      // videoLinkJobs by storageId for live state. The legacy schema
      // fields are kept @deprecated for rows from older builds.
      lifecycleStatus: 'active',
      statusChangedAt: Date.now(),
    });

    // Hand off to RAG ingestion. The existing pipeline keys on storageId,
    // so the synthetic row plugs in with no special-casing.
    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.internal_actions.uploadFileToRag,
      {
        storageId: args.storageId,
        fileName: `${args.videoTitle}.txt`,
        contentType: 'text/plain; charset=utf-8',
      },
    );

    // Bind the job to the freshly-created row + transition to terminal.
    await ctx.db.patch(args.jobId, {
      fileMetadataId,
      storageId: args.storageId,
      status: 'completed',
      statusChangedAt: Date.now(),
      progress: undefined,
    });

    return fileMetadataId;
  },
});

/**
 * Cancellation/retry cleanup. Runs as a separate scheduled action so the
 * cancel mutation returns instantly and the user-visible chip flips
 * before the storage/RAG deletes complete (which can take seconds).
 *
 * Lifecycle-bound jobs (lifecycleStatus='active' but bound to a sent
 * message via 'bind' state — TODO: dedicated flag) keep their
 * fileMetadata row for citation integrity but their audio blob deletes.
 * Unbound jobs cleanup everything.
 */
export const cleanupCancelledVideoLink = internalMutation({
  args: { jobId: v.id('videoLinkJobs') },
  async handler(ctx, args) {
    const job = await ctx.db.get(args.jobId);
    if (!job) return;

    // _storage blob: always delete if present and not message-bound.
    // (Message-bound jobs have audio replaced by transcript already, so
    // this branch only fires for audio blobs from failed Whisper runs.)
    if (job.storageId) {
      try {
        await ctx.storage.delete(job.storageId);
      } catch (err) {
        console.warn(
          `[video_links] storage delete failed for job ${args.jobId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // fileMetadata row: only delete if it's a pure transient artifact.
    // For now, if `transcriptionStatus !== 'completed'`, drop it.
    if (job.fileMetadataId) {
      const meta = await ctx.db.get(job.fileMetadataId);
      if (meta && meta.transcriptionStatus !== 'completed') {
        await ctx.db.delete(job.fileMetadataId);
      }
    }
  },
});

/**
 * Per-chunk heartbeat called from `transcribe_audio.ts` to keep long
 * Whisper jobs alive past the watchdog window. Looks up the videoLinkJob
 * by storageId (the canonical key both modules share — avoids the
 * reverse-coupling problem from the original plan that R12 flagged).
 *
 * No-op when the storageId doesn't map to any videoLinkJob (the
 * common case — most audio uploads aren't from a video link).
 */
export const heartbeatJobByStorageId = internalMutation({
  args: {
    storageId: v.id('_storage'),
    progress: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const job = await ctx.db
      .query('videoLinkJobs')
      .filter((q) => q.eq(q.field('storageId'), args.storageId))
      .first();
    if (!job) return;
    if (job.status !== 'transcribing_handoff') return;
    await ctx.db.patch(job._id, {
      statusChangedAt: Date.now(),
      progress: args.progress ?? job.progress,
    });
  },
});

/**
 * Watchdog: flip stuck non-terminal jobs to 'failed'/transient. Called
 * from the existing `recoverStuckTranscriptions` cron at 5min cadence
 * (per-status windows below; numbers from R14 review).
 *
 * `transcribing_handoff` is INTENTIONALLY EXCLUDED — that lifecycle is
 * owned by the existing recoverStuckTranscriptions sweep on the
 * fileMetadata row; we'd double-fire otherwise. The chip's reactive
 * join already projects fileMetadata's failed state into displayStatus.
 */
const STATUS_WINDOWS: ReadonlyArray<
  readonly [
    (
      | 'queued'
      | 'fetching_metadata'
      | 'fetching_captions'
      | 'extracting_audio'
      | 'indexing'
    ),
    number,
  ]
> = [
  ['queued', 5 * 60_000],
  ['fetching_metadata', 5 * 60_000],
  ['fetching_captions', 10 * 60_000],
  ['extracting_audio', 20 * 60_000],
  ['indexing', 5 * 60_000],
];

/** Lazy GC: completed-but-unbound video-link rows that stayed in the
 * draft chip area for 7+ days without being attached to a sent message.
 * Typical cause: user pastes a URL on the welcome page, then leaves
 * without sending. Without this sweep the row + its `_storage` blob
 * persist indefinitely outside of any cascade scope (no threadId, no
 * message). Cron tick caps at 50/sweep so a large backlog drains over
 * multiple ticks without exhausting the mutation budget. */
const UNBOUND_GC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const UNBOUND_GC_BATCH = 50;

export const recoverStuckVideoLinkJobs = internalMutation({
  args: {},
  async handler(ctx) {
    const now = Date.now();
    let recoveredCount = 0;
    let gcCount = 0;

    for (const [status, windowMs] of STATUS_WINDOWS) {
      const cutoff = now - windowMs;
      const rows = await ctx.db
        .query('videoLinkJobs')
        .withIndex('by_status', (q) => q.eq('status', status))
        .collect();
      for (const row of rows) {
        const checkpoint = row.statusChangedAt ?? row._creationTime;
        if (checkpoint > cutoff) continue;
        await ctx.db.patch(row._id, {
          status: 'failed',
          statusChangedAt: now,
          errorReasonCode: 'transient',
          errorMessage: `Stuck in '${row.status}' for >${Math.round(
            windowMs / 60_000,
          )}min — watchdog flipped to failed`,
        });
        recoveredCount += 1;
      }
    }

    // Lazy GC pass for completed-but-unbound rows.
    const gcCutoff = now - UNBOUND_GC_AGE_MS;
    const candidates = await ctx.db
      .query('videoLinkJobs')
      .withIndex('by_status', (q) => q.eq('status', 'completed'))
      .take(UNBOUND_GC_BATCH * 4);
    for (const row of candidates) {
      if (gcCount >= UNBOUND_GC_BATCH) break;
      if (row.messageBoundAt !== undefined) continue;
      if (row._creationTime > gcCutoff) continue;
      if (row.storageId) {
        try {
          await ctx.storage.delete(row.storageId);
        } catch (err) {
          console.warn(
            `[video_links] GC storage.delete failed for ${row._id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (row.fileMetadataId) {
        try {
          await ctx.db.delete(row.fileMetadataId);
        } catch (err) {
          console.warn(
            `[video_links] GC fileMetadata.delete failed for ${row._id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      await ctx.db.delete(row._id);
      gcCount += 1;
    }

    return { recoveredCount, gcCount };
  },
});
