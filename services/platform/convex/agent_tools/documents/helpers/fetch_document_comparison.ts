import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { UpstreamHttpError } from '../../../lib/errors/upstream_http_error';
import { ragFetch } from '../../../lib/helpers/rag_config';

const FETCH_TIMEOUT_MS = 120_000;

interface RagDiffItem {
  type: 'added' | 'deleted' | 'modified' | 'context';
  base_content: string | null;
  comparison_content: string | null;
  content: string | null;
  inline_diff?: string | null;
  clause_ref?: string | null;
  base_page?: number | null;
  comparison_page?: number | null;
}

interface RagChangeBlock {
  context_before: string | null;
  items: RagDiffItem[];
  context_after: string | null;
}

interface RagDiffStats {
  total_paragraphs_base: number;
  total_paragraphs_comparison: number;
  unchanged: number;
  modified: number;
  added: number;
  deleted: number;
  high_divergence: boolean;
}

interface RagDocumentInfo {
  file_id: string | null;
  title: string | null;
}

interface RagCompareResponse {
  success: boolean;
  base_document: RagDocumentInfo;
  comparison_document: RagDocumentInfo;
  change_blocks: RagChangeBlock[];
  stats: RagDiffStats;
  truncated: boolean;
}

export interface DiffItem {
  type: 'added' | 'deleted' | 'modified' | 'context';
  baseContent: string | null;
  comparisonContent: string | null;
  content: string | null;
  inlineDiff?: string | null;
  clauseRef?: string | null;
  basePage?: number | null;
  comparisonPage?: number | null;
}

export interface ChangeBlock {
  contextBefore: string | null;
  items: DiffItem[];
  contextAfter: string | null;
}

export interface DiffStats {
  totalParagraphsBase: number;
  totalParagraphsComparison: number;
  unchanged: number;
  modified: number;
  added: number;
  deleted: number;
  highDivergence: boolean;
}

export interface DocumentInfo {
  fileId: string | null;
  title: string | null;
}

export interface DocumentComparisonResult {
  baseDocument: DocumentInfo;
  comparisonDocument: DocumentInfo;
  changeBlocks: ChangeBlock[];
  stats: DiffStats;
  truncated: boolean;
}

function mapDiffItem(item: RagDiffItem): DiffItem {
  return {
    type: item.type,
    baseContent: item.base_content,
    comparisonContent: item.comparison_content,
    content: item.content,
    inlineDiff: item.inline_diff ?? null,
    clauseRef: item.clause_ref ?? null,
    basePage: item.base_page ?? null,
    comparisonPage: item.comparison_page ?? null,
  };
}

function mapChangeBlock(block: RagChangeBlock): ChangeBlock {
  return {
    contextBefore: block.context_before,
    items: block.items.map(mapDiffItem),
    contextAfter: block.context_after,
  };
}

/**
 * Compare two documents by ID via the RAG service's deterministic diff endpoint.
 *
 * Both file_ids must belong to `orgSlug`. RAG now scopes documents by
 * org_slug — a foreign-org file_id returns 404 (not the foreign content).
 */
export async function fetchDocumentComparison(
  orgSlug: string,
  baseFileId: string,
  comparisonFileId: string,
  maxChanges?: number,
): Promise<DocumentComparisonResult> {
  const body: Record<string, unknown> = {
    base_file_id: baseFileId,
    comparison_file_id: comparisonFileId,
  };
  if (maxChanges != null) {
    body.max_changes = maxChanges;
  }

  try {
    const response = await ragFetch('/api/v1/documents/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: FETCH_TIMEOUT_MS,
      orgSlug,
    });

    // All non-2xx paths now route through UpstreamHttpError so the
    // (potentially body-embedded) upstream error text gets sanitized
    // and truncated. The status-specific messaging is already encoded
    // in `safeMessageFor` (404 → "returned not found", 4xx → "returned
    // HTTP …", 5xx → "is unavailable").
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw UpstreamHttpError.fromResponse(
        'rag',
        response,
        errorText,
        '/api/v1/documents/compare',
      );
    }

    const result = await fetchJson<RagCompareResponse>(response);
    return mapRagResponse(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new Error(
        `RAG service timed out after ${FETCH_TIMEOUT_MS / 1000}s while comparing documents.`,
        { cause: error },
      );
    }

    throw error;
  }
}

function mapRagResponse(result: RagCompareResponse): DocumentComparisonResult {
  return {
    baseDocument: {
      fileId: result.base_document.file_id,
      title: result.base_document.title,
    },
    comparisonDocument: {
      fileId: result.comparison_document.file_id,
      title: result.comparison_document.title,
    },
    changeBlocks: result.change_blocks.map(mapChangeBlock),
    stats: {
      totalParagraphsBase: result.stats.total_paragraphs_base,
      totalParagraphsComparison: result.stats.total_paragraphs_comparison,
      unchanged: result.stats.unchanged,
      modified: result.stats.modified,
      added: result.stats.added,
      deleted: result.stats.deleted,
      highDivergence: result.stats.high_divergence,
    },
    truncated: result.truncated,
  };
}

/**
 * Compare two files by URL via the RAG service — no pre-indexing required.
 *
 * Downloads both files and uploads them to the RAG service in a single
 * function to avoid passing large Blobs through function parameters.
 */
export async function fetchDocumentComparisonByUrls(
  baseFileUrl: string,
  baseFileName: string,
  comparisonFileUrl: string,
  comparisonFileName: string,
  orgSlug: string,
  maxChanges?: number,
): Promise<DocumentComparisonResult> {
  const [baseResponse, compResponse] = await Promise.all([
    fetch(baseFileUrl),
    fetch(comparisonFileUrl),
  ]);
  if (!baseResponse.ok) {
    throw new Error(`Failed to download base file: ${baseResponse.status}`);
  }
  if (!compResponse.ok) {
    throw new Error(
      `Failed to download comparison file: ${compResponse.status}`,
    );
  }

  const [baseBlob, compBlob] = await Promise.all([
    baseResponse.blob(),
    compResponse.blob(),
  ]);

  const formData = new FormData();
  formData.append('base_file', baseBlob, baseFileName);
  formData.append('comparison_file', compBlob, comparisonFileName);
  if (maxChanges != null) {
    formData.append('max_changes', String(maxChanges));
  }

  try {
    const response = await ragFetch('/api/v1/documents/compare-files', {
      method: 'POST',
      body: formData,
      timeoutMs: FETCH_TIMEOUT_MS,
      orgSlug,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw UpstreamHttpError.fromResponse(
        'rag',
        response,
        errorText,
        '/api/v1/documents/compare-files',
      );
    }

    const result = await fetchJson<RagCompareResponse>(response);
    return mapRagResponse(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new Error(
        `RAG service timed out after ${FETCH_TIMEOUT_MS / 1000}s while comparing files.`,
        { cause: error },
      );
    }

    throw error;
  }
}
