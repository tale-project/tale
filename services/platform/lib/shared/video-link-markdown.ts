/**
 * Shared markdown formatter for video-link attachments.
 *
 * Used by server `buildMessageWithAttachments` (start_agent_chat.ts) to
 * append a fileId + provenance block to the persisted user-message body
 * so the agent can read it inline. On the client the bubble strips this
 * block back out (`stripInternalFileReferences` in
 * use-message-processing.ts) and renders the video as an attachment card
 * — the optimistic path therefore puts only the typed text in `content`
 * and the metadata on `attachments[]`, matching the post-strip shape.
 *
 * The golden-string test (in this folder's `.test.ts`) guards against
 * accidental whitespace / punctuation drift in the template.
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
