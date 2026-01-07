/**
 * Transform a document to DocumentItemResponse format
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { DocumentItemResponse, DocumentMetadata } from './types';
import { extractExtension } from './extract_extension';

export async function transformToDocumentItem(
  ctx: QueryCtx,
  document: Doc<'documents'>,
): Promise<DocumentItemResponse> {
  // Generate URL for file if it has a fileId
  let url: string | undefined;
  if (document.fileId) {
    const fileUrl = await ctx.storage.getUrl(document.fileId);
    url = fileUrl ?? undefined;
  }

  // Type the metadata field for safer access
  const metadata = document.metadata as DocumentMetadata | undefined;

  // Normalize source mode value
  const normalizeSourceMode = (m: string | undefined): 'auto' | 'manual' =>
    m === 'auto' || m === 'manual' ? m : m === 'sync' ? 'auto' : 'manual';

  // Normalize type value
  const normalizeType = (t: string | undefined): 'file' | 'folder' =>
    t === 'file' || t === 'folder' ? t : 'file';

  return {
    id: document._id,
    name: document.title ?? metadata?.name ?? 'Untitled',
    type: normalizeType(metadata?.type),
    size: metadata?.size,
    mimeType: document.mimeType ?? metadata?.mimeType,
    extension:
      document.extension ??
      metadata?.extension ??
      extractExtension(document.title),
    storagePath: metadata?.storagePath,
    sourceProvider: document.sourceProvider ?? metadata?.sourceProvider ?? 'upload',
    sourceMode: normalizeSourceMode(metadata?.sourceMode),
    lastModified: metadata?.lastModified ?? document._creationTime,
    syncConfigId: metadata?.syncConfigId,
    isDirectlySelected: metadata?.isDirectlySelected,
    url,
    // RAG status from database (if available)
    ragStatus: document.ragInfo?.status,
    ragIndexedAt: document.ragInfo?.indexedAt,
    ragError: document.ragInfo?.error,
  };
}
