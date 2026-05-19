/**
 * Shared markdown formatter for video-link attachments.
 *
 * Used by:
 *   - server `buildMessageWithAttachments` (start_agent_chat.ts) — appends
 *     this block to the persisted user-message body so the agent can read
 *     fileId + provenance inline.
 *   - client `useSendMessage` optimistic render path — same block is
 *     synthesized client-side at click-time so the optimistic bubble is
 *     byte-identical to the persisted bubble. Without parity, the
 *     optimistic→persisted swap visibly grows the bubble (the user-role
 *     renderer at message-bubble.tsx:447-450 is `whitespace-pre-wrap`, so
 *     these literal brackets / asterisks are SHOWN, not formatted).
 *
 * If you change the template here, the client and server stay in sync
 * automatically. The golden-string test (in this folder's `.test.ts`)
 * guards against accidental whitespace / punctuation drift.
 */
import { sanitizeUntrustedField } from './sanitize-untrusted-field';

interface VideoLinkAttachmentMarkdownInput {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  videoTitle?: string;
  videoUploader?: string;
  sourcePlatform?: string;
  /** Total length of the video in seconds. Server passes
   * `videoLinkJobs.videoDurationSec ?? fileMetadata.transcriptionDurationSec
   * ?? 0`; client passes `videoLinkJob.videoDurationSec ?? 0`. */
  videoDurationSec?: number;
}

export function formatVideoLinkAttachmentMarkdown(
  input: VideoLinkAttachmentMarkdownInput,
): string {
  const icon = input.fileType.startsWith('video/') ? '🎬' : '🎙️';
  const safeTitle = sanitizeUntrustedField(
    input.videoTitle ?? input.fileName,
    120,
  );
  const safeUploader = input.videoUploader
    ? sanitizeUntrustedField(input.videoUploader, 80)
    : '';
  const safePlatform = input.sourcePlatform
    ? sanitizeUntrustedField(input.sourcePlatform, 32)
    : '';
  const platformNote = safePlatform ? ` from ${safePlatform}` : '';
  const uploaderNote = safeUploader ? `, uploader: ${safeUploader}` : '';
  const durSec = input.videoDurationSec ?? 0;
  const durText =
    durSec >= 3600
      ? `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m`
      : `${Math.round(durSec / 60)}m`;
  return `${icon} [${safeTitle}] (video${platformNote}, ${durText}${uploaderNote}) — transcript indexed; call document_retrieve(fileId) to read\n*(fileId: ${input.fileId} | fileName: ${input.fileName} | fileType: ${input.fileType} | fileSize: ${input.fileSize})*`;
}
