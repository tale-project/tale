import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Donor lookup for transcript reuse: the same URL pasted anywhere in the
 * SAME organization (any thread, any user) within this window attaches a
 * clone of the existing transcript instead of re-running yt-dlp. Never
 * crosses organizations — the index prefix is the tenant boundary.
 *
 * Why donors exist at all: a cancelled completed chip keeps its
 * fileMetadata row (cleanupCancelledVideoLink deletes only the blob and
 * only-non-completed rows), and message-bound rows keep everything — so
 * the transcript TEXT survives on the row in both the remove→re-add and
 * the already-sent case.
 */

/** Captions drift over time (creators edit, auto-captions regenerate) —
 * a stale transcript quietly diverging from the video is worse than one
 * fresh re-fetch per month. */
export const TRANSCRIPT_REUSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Rows examined per lookup. The (org, hash) key rarely accumulates more
 * than a handful of rows; the cap bounds the mutation's read set when a
 * URL was spam-pasted hundreds of times. */
const DONOR_SCAN_LIMIT = 20;

export interface TranscriptDonor {
  job: Doc<'videoLinkJobs'>;
  meta: Doc<'fileMetadata'>;
}

/**
 * Newest reusable transcript for (org, normalized-URL hash), or null.
 * Reusable = the linked fileMetadata row still exists, is not trashed,
 * finished transcription, and carries the transcript text (blob presence
 * is NOT required — cancel deletes the blob but keeps the row).
 */
export async function findReusableTranscriptDonor(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  sourceUrlHash: string,
  now: number,
): Promise<TranscriptDonor | null> {
  let scanned = 0;
  for await (const job of ctx.db
    .query('videoLinkJobs')
    .withIndex('by_organizationId_and_sourceUrlHash', (q) =>
      q.eq('organizationId', organizationId).eq('sourceUrlHash', sourceUrlHash),
    )
    .order('desc')) {
    scanned += 1;
    if (scanned > DONOR_SCAN_LIMIT) break;
    // Descending _creationTime: every row past this point is older still.
    if (now - job._creationTime > TRANSCRIPT_REUSE_MAX_AGE_MS) break;
    if (job.lifecycleStatus === 'trashed') continue;
    if (!job.fileMetadataId) continue;
    const meta = await ctx.db.get(job.fileMetadataId);
    if (!meta) continue;
    if (meta.lifecycleStatus === 'trashed') continue;
    if (meta.transcriptionStatus !== 'completed') continue;
    if (typeof meta.transcript !== 'string' || meta.transcript.length === 0) {
      continue;
    }
    return { job, meta };
  }
  return null;
}
