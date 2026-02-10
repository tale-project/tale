/**
 * Transform a document to DocumentItemResponse format
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { DocumentItemResponse, DocumentMetadata } from './types';

import { extractExtension } from './extract_extension';
import { getUserNamesBatch } from './get_user_names_batch';

/**
 * Transform options for batch processing
 */
export interface TransformOptions {
  /**
   * Pre-fetched user names map (userId -> displayName)
   * When provided, avoids individual DB lookups for creator names
   */
  userNamesMap?: Map<string, string>;
  /**
   * Pre-fetched storage URLs map (fileId -> url)
   * When provided, avoids individual storage.getUrl calls
   */
  storageUrlsMap?: Map<string, string>;
}

/**
 * Transform a single document to DocumentItemResponse format
 *
 * This is a synchronous function that transforms document data.
 * For batch processing, pre-fetch user names and storage URLs using:
 * - getUserNamesBatch() for creator names
 * - ctx.storage.getUrl() for file URLs (batched in caller)
 *
 * @param document - Document to transform
 * @param options - Optional transform options including pre-fetched data
 */
export function transformToDocumentItem(
  document: Doc<'documents'>,
  options?: TransformOptions,
): DocumentItemResponse {
  // Type the metadata field for safer access
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex document field
  const metadata = document.metadata as DocumentMetadata | undefined;

  // Normalize source mode value
  const normalizeSourceMode = (m: string | undefined): 'auto' | 'manual' =>
    m === 'auto' || m === 'manual' ? m : m === 'sync' ? 'auto' : 'manual';

  // Normalize type value
  const normalizeType = (t: string | undefined): 'file' | 'folder' =>
    t === 'file' || t === 'folder' ? t : 'file';

  // Get URL from pre-fetched map (fileId is converted to string as key)
  const url = document.fileId
    ? (options?.storageUrlsMap?.get(String(document.fileId)) ?? undefined)
    : undefined;

  // Get creator display name from pre-fetched map
  const createdByName = document.createdBy
    ? options?.userNamesMap?.get(document.createdBy)
    : undefined;

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
    sourceProvider:
      document.sourceProvider ?? metadata?.sourceProvider ?? 'upload',
    sourceMode: normalizeSourceMode(metadata?.sourceMode),
    lastModified: metadata?.lastModified ?? document._creationTime,
    syncConfigId: metadata?.syncConfigId,
    isDirectlySelected: metadata?.isDirectlySelected,
    url,
    // RAG status from database (if available)
    ragStatus: document.ragInfo?.status,
    ragIndexedAt: document.ragInfo?.indexedAt,
    ragError: document.ragInfo?.error,
    // Team tags for multi-tenancy support
    teamTags: document.teamTags,
    // Creator tracking
    createdBy: document.createdBy,
    createdByName,
  };
}

/**
 * Batch transform documents with efficient data fetching
 *
 * This function handles batch fetching of user names and storage URLs,
 * then transforms all documents in a single pass.
 *
 * @param ctx - Query context for data fetching
 * @param documents - Array of documents to transform
 * @returns Array of transformed document items
 */
export async function transformDocumentsBatch(
  ctx: QueryCtx,
  documents: Doc<'documents'>[],
): Promise<DocumentItemResponse[]> {
  // Early return for empty arrays
  if (documents.length === 0) {
    return [];
  }

  // Collect unique user IDs and file IDs
  const userIds = documents
    .map((doc) => doc.createdBy)
    .filter((id): id is string => !!id);

  const fileIds = documents
    .map((doc) => doc.fileId)
    .filter((id): id is NonNullable<Doc<'documents'>['fileId']> => !!id);

  // Batch fetch user names and storage URLs in parallel
  const [userNamesMap, storageUrlsMap] = await Promise.all([
    getUserNamesBatch(ctx, userIds),
    batchGetStorageUrls(ctx, fileIds),
  ]);

  // Transform all documents using pre-fetched data
  return documents.map((doc) =>
    transformToDocumentItem(doc, { userNamesMap, storageUrlsMap }),
  );
}

/**
 * Batch fetch storage URLs for multiple file IDs
 */
async function batchGetStorageUrls(
  ctx: QueryCtx,
  fileIds: NonNullable<Doc<'documents'>['fileId']>[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (fileIds.length === 0) {
    return result;
  }

  // Deduplicate file IDs using string representation
  const seenIds = new Set<string>();
  const uniqueIds: NonNullable<Doc<'documents'>['fileId']>[] = [];
  for (const id of fileIds) {
    const key = String(id);
    if (!seenIds.has(key)) {
      seenIds.add(key);
      uniqueIds.push(id);
    }
  }

  // Fetch all URLs in parallel
  const urlPromises = uniqueIds.map(async (fileId) => {
    const url = await ctx.storage.getUrl(fileId);
    return { fileId: String(fileId), url };
  });

  const urls = await Promise.all(urlPromises);

  for (const { fileId, url } of urls) {
    if (url) {
      result.set(fileId, url);
    }
  }

  return result;
}
