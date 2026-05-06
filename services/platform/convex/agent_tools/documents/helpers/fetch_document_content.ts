import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { ragFetch } from '../../../lib/helpers/rag_config';

const MAX_CONTENT_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 60_000;

interface RagContentResponse {
  file_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
  chunks?: Array<{ index: number; content: string }>;
}

export interface DocumentContentResult {
  fileId: string;
  name: string;
  content: string;
  chunkRange: { start: number; end: number };
  totalChunks: number;
  truncated: boolean;
  totalChars: number;
  chunks?: Array<{ index: number; content: string }>;
}

export interface FetchDocumentContentOptions {
  chunkStart?: number;
  chunkEnd?: number;
  returnChunks?: boolean;
}

/**
 * Fetch document content from the RAG service.
 * Shared between agent tool (retrieve_document) and workflow action (document action).
 */
export async function fetchDocumentContent(
  fileId: string,
  options?: FetchDocumentContentOptions,
): Promise<DocumentContentResult> {
  const params = new URLSearchParams();
  if (options?.chunkStart != null) {
    params.set('chunk_start', String(options.chunkStart));
  }
  if (options?.chunkEnd != null) {
    params.set('chunk_end', String(options.chunkEnd));
  }
  if (options?.returnChunks) {
    params.set('return_chunks', 'true');
  }
  const query = params.toString();
  const path = `/api/v1/documents/${encodeURIComponent(fileId)}/content${query ? `?${query}` : ''}`;

  try {
    const response = await ragFetch(path, { timeoutMs: FETCH_TIMEOUT_MS });

    if (response.status === 404) {
      throw new Error(
        `Document "${fileId}" was not found in the knowledge base. ` +
          'It may not have been indexed yet.',
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `RAG service error (${response.status}): ${errorText || 'Unknown error'}`,
      );
    }

    let result: RagContentResponse;
    try {
      result = await fetchJson<RagContentResponse>(response);
    } catch (parseError) {
      throw new Error(
        `Failed to parse RAG response: ${parseError instanceof Error ? parseError.message : 'unknown error'}`,
        { cause: parseError },
      );
    }

    const rawContent = result.content ?? '';
    const truncated = rawContent.length > MAX_CONTENT_CHARS;
    const content = truncated
      ? rawContent.slice(0, MAX_CONTENT_CHARS)
      : rawContent;

    return {
      fileId: result.file_id,
      name: result.title ?? 'Untitled',
      content,
      chunkRange: result.chunk_range,
      totalChunks: result.total_chunks,
      truncated,
      totalChars: result.total_chars,
      chunks: result.chunks,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new Error(
        `RAG service timed out after ${FETCH_TIMEOUT_MS / 1000}s while retrieving document "${fileId}".`,
        { cause: error },
      );
    }

    throw error;
  }
}
