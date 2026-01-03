/**
 * Transform a document to DocumentItemResponse format
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { DocumentItemResponse } from './types';
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

  // Extract RAG status from ragInfo field
  const ragInfo = (document as any).ragInfo as
    | {
        status: 'queued' | 'running' | 'completed' | 'failed';
        jobId?: string;
        indexedAt?: number;
        error?: string;
      }
    | undefined;

  return {
    id: document._id,
    name:
      document.title ??
      (document.metadata as { name?: string })?.name ??
      'Untitled',
    type: ((document.metadata as { type?: string })?.type ?? 'file') as
      | 'file'
      | 'folder',
    size: (document.metadata as { size?: number })?.size,
    mimeType:
      document.mimeType ??
      (document.metadata as { mimeType?: string })?.mimeType,
    extension:
      document.extension ??
      (document.metadata as { extension?: string })?.extension ??
      extractExtension(document.title),
    storagePath: (document.metadata as { storagePath?: string })?.storagePath,
    sourceProvider: ((document as any).sourceProvider ??
      (document.metadata as { sourceProvider?: string })?.sourceProvider ??
      'upload') as 'onedrive' | 'upload',
    sourceMode: ((m) =>
      m === 'auto' || m === 'manual' ? m : m === 'sync' ? 'auto' : 'manual')(
      (document.metadata as { sourceMode?: string })?.sourceMode,
    ) as 'auto' | 'manual',
    lastModified:
      (document.metadata as { lastModified?: number })?.lastModified ??
      document._creationTime,
    syncConfigId: (document.metadata as { syncConfigId?: string })
      ?.syncConfigId,
    isDirectlySelected: (document.metadata as { isDirectlySelected?: boolean })
      ?.isDirectlySelected,
    url,
    // RAG status from database (if available)
    ragStatus: ragInfo?.status,
    ragIndexedAt: ragInfo?.indexedAt,
    ragError: ragInfo?.error,
  };
}
