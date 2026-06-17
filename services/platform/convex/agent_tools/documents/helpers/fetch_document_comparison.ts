import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';

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
  ctx: ActionCtx,
  orgSlug: string,
  baseFileId: string,
  comparisonFileId: string,
  maxChanges?: number,
): Promise<DocumentComparisonResult> {
  // The RAG by-id document comparison now lives in a Convex internal
  // action; the HTTP call was replaced by an in-process `ctx.runAction`.
  // The action returns either the full diff (`success: true` + change
  // blocks/stats) or a `{ error: 'not_found', file_id, role }` shape when
  // a document is missing. It throws plain Errors on other failures.
  const result = await ctx.runAction(internal.rag.documents.compareDocuments, {
    orgSlug,
    baseFileId,
    comparisonFileId,
    maxChanges: maxChanges ?? null,
  });

  if (result === null) {
    throw new Error(
      'Could not compare documents: one or both documents were not found in the knowledge base.',
    );
  }

  if (result.error) {
    const which = result.role ? `${result.role} document` : 'document';
    throw new Error(
      `Could not compare documents: the ${which} (${result.file_id ?? 'unknown'}) was not found in the knowledge base.`,
    );
  }

  // Success shape: change_blocks/stats + base/comparison_document. The
  // action types `change_blocks` loosely (`Record<string, unknown>[]`) but
  // the runtime shape matches `RagCompareResponse` field-for-field.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CompareResult success shape is structurally a RagCompareResponse
  return mapRagResponse(result as unknown as RagCompareResponse);
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
 * Compare two files by Convex `_storage` id — no pre-indexing required.
 *
 * Rewired from the external RAG `/api/v1/documents/compare-files` multipart
 * upload to the in-process `internal.rag.documents.compareFiles` action. The
 * `_storage` ids are passed straight through; the action reads the bytes via
 * `ctx.storage.get`, runs the ported text-extraction + diff pipeline, and
 * returns the same `RagCompareResponse`-shaped success object.
 */
export async function fetchDocumentComparisonByStorageIds(
  ctx: ActionCtx,
  baseStorageId: string,
  baseFileName: string,
  comparisonStorageId: string,
  comparisonFileName: string,
  orgSlug: string,
  maxChanges?: number,
): Promise<DocumentComparisonResult> {
  const result = await ctx.runAction(internal.rag.documents.compareFiles, {
    orgSlug,
    baseStorageId,
    baseFilename: baseFileName,
    comparisonStorageId,
    comparisonFilename: comparisonFileName,
    maxChanges: maxChanges ?? null,
  });
  // The action's `CompareResult` success shape is structurally a
  // `RagCompareResponse` (change_blocks/stats + base/comparison_document),
  // matching the by-id `compareDocuments` rewire above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- CompareResult success shape is structurally a RagCompareResponse
  return mapRagResponse(result as unknown as RagCompareResponse);
}
