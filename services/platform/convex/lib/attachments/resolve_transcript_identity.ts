import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

/**
 * Video-link transcript attachments travel through chat messages under a
 * DISPLAY identity: `bindCompletedJobsToMessage` stamps `fileType:
 * 'video/mp4'` (the isAudioOrVideo routing sentinel that keeps the bubble's
 * video card and the document_retrieve hint working) and the extension-less
 * video title as `fileName` — while the underlying blob is the transcript
 * TEXT. Any consumer that materializes the blob as a real file (the chat
 * workspace's /user/uploads, external-agent staging) must restore the true
 * identity from the synthetic fileMetadata row (`fileName: "<title>.txt"`,
 * `contentType: text/plain`) or it ships a text file labelled as an mp4 —
 * unreadable in the Canvas preview and a lie in the agent's file listing.
 */

interface AttachmentIdentity {
  fileId: string;
  fileName: string;
  fileType: string;
}

type TranscriptMeta = {
  source?: string;
  fileName: string;
  contentType: string;
} | null;

/**
 * Pure mapping: video-link rows adopt the fileMetadata identity; everything
 * else (regular uploads, audio, unknown rows) passes through untouched.
 */
export function applyTranscriptIdentity<T extends AttachmentIdentity>(
  attachment: T,
  meta: TranscriptMeta,
): T {
  if (!meta || meta.source !== 'video_link') return attachment;
  return {
    ...attachment,
    fileName: meta.fileName,
    fileType: meta.contentType,
  };
}

/**
 * Resolve each attachment's on-disk identity via its fileMetadata row.
 * Fail-open: a lookup error keeps the display identity — staging is
 * best-effort and must never fail the turn.
 */
export async function resolveTranscriptAttachmentIdentities<
  T extends AttachmentIdentity,
>(ctx: Pick<ActionCtx, 'runQuery'>, attachments: readonly T[]): Promise<T[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      try {
        const meta = await ctx.runQuery(
          internal.file_metadata.internal_queries.getByStorageId,
          { storageId: attachment.fileId },
        );
        return applyTranscriptIdentity(attachment, meta);
      } catch (err) {
        console.warn(
          `[attachments] identity lookup failed for ${attachment.fileId}; keeping display identity:`,
          err instanceof Error ? err.message : err,
        );
        return attachment;
      }
    }),
  );
}
