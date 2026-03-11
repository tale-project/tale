import { fetchJson } from '../../../../lib/utils/type-cast-helpers';

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
  document_id: string;
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
  documentId: string;
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
 */
export async function fetchDocumentComparison(
  ragServiceUrl: string,
  baseFileId: string,
  comparisonFileId: string,
  maxChanges?: number,
): Promise<DocumentComparisonResult> {
  const url = `${ragServiceUrl}/api/v1/documents/compare`;

  const body: Record<string, unknown> = {
    base_document_id: baseFileId,
    comparison_document_id: comparisonFileId,
  };
  if (maxChanges != null) {
    body.max_changes = maxChanges;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 404) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Document not found during comparison: ${errorText || 'unknown document'}`,
      );
    }

    if (response.status === 400) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Invalid comparison request: ${errorText}`);
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `RAG service error (${response.status}): ${errorText || 'Unknown error'}`,
      );
    }

    const result = await fetchJson<RagCompareResponse>(response);
    return mapRagResponse(result);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
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
      documentId: result.base_document.document_id,
      title: result.base_document.title,
    },
    comparisonDocument: {
      documentId: result.comparison_document.document_id,
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
  ragServiceUrl: string,
  baseFileUrl: string,
  baseFileName: string,
  comparisonFileUrl: string,
  comparisonFileName: string,
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

  const url = `${ragServiceUrl}/api/v1/documents/compare-files`;

  const formData = new FormData();
  formData.append('base_file', baseBlob, baseFileName);
  formData.append('comparison_file', compBlob, comparisonFileName);
  if (maxChanges != null) {
    formData.append('max_changes', String(maxChanges));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `RAG service error (${response.status}): ${errorText || 'Unknown error'}`,
      );
    }

    const result = await fetchJson<RagCompareResponse>(response);
    return mapRagResponse(result);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `RAG service timed out after ${FETCH_TIMEOUT_MS / 1000}s while comparing files.`,
        { cause: error },
      );
    }

    throw error;
  }
}
