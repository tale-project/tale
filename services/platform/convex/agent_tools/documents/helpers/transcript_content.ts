import {
  MAX_CONTENT_CHARS,
  type DocumentContentResult,
} from './fetch_document_content';

/**
 * Direct-transcript content window for `document_retrieve`.
 *
 * Used when a chat attachment's RAG indexing hasn't completed (queued /
 * running / failed) but the `fileMetadata` row already carries the full
 * transcript — video-link captions (`insertSyntheticFileMetadata`) and audio
 * Whisper runs (`transcribe_audio`) both write it before indexing starts.
 * The RAG index is derived from that same text, so serving the source is
 * strictly fresher than waiting for the derived copy.
 *
 * Mirrors the RAG read contract (`rag_service.getDocumentContent` +
 * `fetchDocumentContent`) so pagination behaves identically on both paths:
 * 1-indexed chunk windows, `chunkEnd` defaulting to
 * `chunkStart + MAX_CHUNK_WINDOW - 1`, an out-of-range start returning empty
 * content with `chunkRange {0,0}`, `totalChars` counting the selected window
 * before the cap, and the 50K content cap with `truncated`.
 */

/**
 * Mirrors the RAG default `chunk_size` (rag/lib/config.ts) so fallback pages
 * have familiar granularity. Boundaries need NOT match the real chunker —
 * chunk numbering is per-response, and the model never mixes windows across
 * the index-completion moment within one call.
 */
const FALLBACK_CHUNK_CHARS = 2048;
/** Mirrors `MAX_CHUNK_WINDOW` in rag/lib/rag_service.ts. */
const MAX_CHUNK_WINDOW = 200;

export interface TranscriptContentArgs {
  fileId: string;
  fileName: string;
  transcript: string;
  chunkStart?: number;
  chunkEnd?: number;
}

export function buildTranscriptContentResult(
  args: TranscriptContentArgs,
): DocumentContentResult {
  const totalChunks = Math.max(
    1,
    Math.ceil(args.transcript.length / FALLBACK_CHUNK_CHARS),
  );
  const start = args.chunkStart ?? 1;
  const end = Math.min(
    args.chunkEnd ?? start + MAX_CHUNK_WINDOW - 1,
    totalChunks,
  );

  if (start > totalChunks) {
    return {
      fileId: args.fileId,
      name: args.fileName,
      content: '',
      chunkRange: { start: 0, end: 0 },
      totalChunks,
      truncated: false,
      totalChars: 0,
    };
  }

  // Windows are contiguous, non-overlapping slices, so one `slice` over the
  // [start, end] range reconstructs the exact text of those chunks.
  const rawContent = args.transcript.slice(
    (start - 1) * FALLBACK_CHUNK_CHARS,
    end * FALLBACK_CHUNK_CHARS,
  );
  const truncated = rawContent.length > MAX_CONTENT_CHARS;

  return {
    fileId: args.fileId,
    name: args.fileName,
    content: truncated ? rawContent.slice(0, MAX_CONTENT_CHARS) : rawContent,
    chunkRange: { start, end },
    totalChunks,
    truncated,
    totalChars: rawContent.length,
  };
}
