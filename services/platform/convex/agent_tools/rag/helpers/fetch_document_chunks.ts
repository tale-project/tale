import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { ragFetch } from '../../../lib/helpers/rag_config';

const MAX_CHUNK_WINDOW = 200;
/** Stop fetching once accumulated content exceeds this size (~15K tokens). */
const MAX_TOTAL_CHARS = 60_000;

interface DocumentContentResponse {
  file_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
  chunks: Array<{ index: number; content: string }> | null;
}

export interface DocumentChunksResult {
  documentId: string;
  title: string | null;
  chunks: Array<{ index: number; content: string }>;
  totalChunks: number;
}

export async function fetchDocumentChunks(
  fileId: string,
): Promise<DocumentChunksResult> {
  const allChunks: Array<{ index: number; content: string }> = [];
  let totalChunks = 0;
  let documentId = '';
  let title: string | null = null;
  let chunkStart = 1;

  while (true) {
    const chunkEnd = chunkStart + MAX_CHUNK_WINDOW - 1;
    const response = await ragFetch(
      `/api/v1/documents/${encodeURIComponent(fileId)}/content?return_chunks=true&chunk_start=${chunkStart}&chunk_end=${chunkEnd}`,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `RAG get_chunks error (${response.status}): ${errorText || 'Unknown error'}`,
      );
    }

    const result = await fetchJson<DocumentContentResponse>(response);
    documentId = result.file_id;
    title = result.title;
    totalChunks = result.total_chunks;

    if (result.chunks) {
      allChunks.push(...result.chunks);
    }

    const totalCharsNow = allChunks.reduce((s, c) => s + c.content.length, 0);
    if (
      result.chunk_range.end >= totalChunks ||
      totalCharsNow >= MAX_TOTAL_CHARS
    ) {
      break;
    }

    chunkStart = result.chunk_range.end + 1;
  }

  return { documentId, title, chunks: allChunks, totalChunks };
}
