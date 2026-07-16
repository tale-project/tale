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

/**
 * Which retrieval tool the transcript hint may reference. The hint must never
 * instruct the model to call a tool the agent does not have (#2760) — the
 * runtime rejects the call and the turn dead-ends. `null` = the agent has no
 * way to read the indexed transcript.
 */
export type TranscriptRetrievalTool = 'document_retrieve' | 'rag_search' | null;

/**
 * Resolve which retrieval tool the transcript hint may point at, mirroring the
 * chat tool filter (`internal_actions.ts`): `document_retrieve` survives only
 * when listed in the agent's tools; `rag_search` additionally requires a
 * tool-capable knowledge mode.
 */
export function resolveTranscriptRetrievalTool(agentConfig: {
  convexToolNames?: readonly string[];
  knowledgeMode?: string;
}): TranscriptRetrievalTool {
  const tools = agentConfig.convexToolNames ?? [];
  if (tools.includes('document_retrieve')) {
    return 'document_retrieve';
  }
  if (
    tools.includes('rag_search') &&
    (agentConfig.knowledgeMode === 'tool' ||
      agentConfig.knowledgeMode === 'both')
  ) {
    return 'rag_search';
  }
  return null;
}

/** The tool-aware "how to read the transcript" fragment of the hint line. */
export function transcriptAccessHint(tool: TranscriptRetrievalTool): string {
  if (tool === 'document_retrieve') {
    return 'call document_retrieve(fileId) to read';
  }
  if (tool === 'rag_search') {
    return 'search its contents with rag_search';
  }
  return 'no retrieval tool is available in this chat to read it';
}

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
  /**
   * Which retrieval tool the hint may reference; defaults to
   * `document_retrieve` (the historical template). Pass the resolved value
   * from `resolveTranscriptRetrievalTool` so the hint never names a tool the
   * agent lacks.
   */
  retrievalTool?: TranscriptRetrievalTool;
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
  const accessHint = transcriptAccessHint(
    input.retrievalTool === undefined
      ? 'document_retrieve'
      : input.retrievalTool,
  );
  return `${icon} [${safeTitle}] (video${platformNote}, ${durText}${uploaderNote}) — transcript indexed; ${accessHint}\n*(fileId: ${input.fileId} | fileName: ${input.fileName} | fileType: ${input.fileType} | fileSize: ${input.fileSize})*`;
}
