'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { putBlob } from '../lib/storage/blob_access';
import type { BlobRef } from '../lib/storage/blob_ref';

/**
 * Materialize a donor transcript for a freshly-inserted clone job:
 * store the donor's transcript text as this job's own blob (backend-aware
 * — a BYO-bucket org's copy lands in its own bucket) and finalize via
 * `finalizeClonedTranscript`. No yt-dlp, no Whisper — this is the
 * zero-re-parse path behind org-wide video-link reuse.
 *
 * Scheduled by `ingestVideoUrl` when `findReusableTranscriptDonor` hits.
 * The job sits at status='indexing' while this runs (watchdog window
 * 5 min); every exit either completes the job, degrades it to the full
 * pipeline, or CAS-fails it — never leaves it stuck.
 */
export const cloneTranscriptFromDonor = internalAction({
  args: {
    jobId: v.id('videoLinkJobs'),
    donorFileMetadataId: v.id('fileMetadata'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const donor = await ctx.runQuery(
        internal.file_metadata.internal_queries.getById,
        { fileMetadataId: args.donorFileMetadataId },
      );

      if (
        !donor ||
        donor.organizationId !== args.organizationId ||
        donor.transcriptionStatus !== 'completed' ||
        typeof donor.transcript !== 'string' ||
        donor.transcript.length === 0
      ) {
        // Donor vanished (GC/erasure) between lookup and clone — degrade
        // to the full pipeline instead of failing the chip: reset to
        // 'queued' (the orchestrator CAS-expects it) and hand over.
        const reset = await ctx.runMutation(
          internal.video_links.internal_mutations.updateJob,
          {
            jobId: args.jobId,
            status: 'queued',
            expectedStatus: 'indexing',
          },
        );
        if (reset === 'ok') {
          await ctx.scheduler.runAfter(
            0,
            internal.video_links.ingest_video_link.ingestVideoLink,
            { jobId: args.jobId },
          );
        }
        return null;
      }

      const bytes = new TextEncoder().encode(donor.transcript);
      const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
      let storageId: BlobRef;
      if (orgSlug !== null) {
        storageId = await putBlob(
          ctx,
          orgSlug,
          bytes,
          'text/plain; charset=utf-8',
        );
      } else {
        // Unresolvable slug → Convex `_storage` fallback, mirroring the
        // workspace filer's posture (never break the flow over routing).
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        storageId = await ctx.storage.store(
          new Blob([ab], { type: 'text/plain; charset=utf-8' }),
        );
      }

      await ctx.runMutation(
        internal.video_links.internal_mutations.finalizeClonedTranscript,
        {
          jobId: args.jobId,
          storageId,
          organizationId: args.organizationId,
          transcript: donor.transcript,
          fileName: donor.fileName,
          fileSize: bytes.byteLength,
          ...(donor.transcriptionDurationSec !== undefined && {
            transcriptionDurationSec: donor.transcriptionDurationSec,
          }),
        },
      );
    } catch (err) {
      console.error(
        `[cloneTranscriptFromDonor] clone failed for job ${args.jobId}:`,
        err instanceof Error ? err.message : err,
      );
      // CAS keeps a concurrent cancel's 'skipped' from being stomped.
      await ctx.runMutation(internal.video_links.internal_mutations.updateJob, {
        jobId: args.jobId,
        status: 'failed',
        expectedStatus: 'indexing',
        errorReasonCode: 'transient',
        errorMessage: 'Transcript clone failed — retry to re-fetch',
      });
    }
    return null;
  },
});
