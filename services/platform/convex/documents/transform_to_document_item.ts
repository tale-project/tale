/**
 * Transform a document to DocumentItemResponse format
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  buildBlobServeUrl,
  toPublicUrl,
} from '../lib/helpers/public_storage_url';
import { convexStorageId, isS3Ref } from '../lib/storage/blob_ref';
import { extractExtension } from './extract_extension';
import {
  type DocumentRagProjection,
  getDocumentRagProjectionBatch,
} from './get_document_rag_projection';
import { getUserNamesBatch } from './get_user_names_batch';
import type { DocumentItemResponse, DocumentMetadata } from './types';

/**
 * Resolve the best available source modification date:
 * 1. Top-level sourceModifiedAt (from file sync / RAG extraction)
 * 2. Metadata sourceModifiedAt (legacy location)
 * 3. Metadata lastModified (generic provider timestamp)
 *
 * Returns undefined when no source date is available — the UI shows "—".
 */
export function getDocumentEffectiveDate(
  document: { sourceModifiedAt?: number },
  metadata: DocumentMetadata | undefined,
  fallback?: number,
): number | undefined {
  return (
    document.sourceModifiedAt ??
    metadata?.sourceModifiedAt ??
    metadata?.lastModified ??
    fallback
  );
}

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
  /**
   * Pre-fetched RAG status projection map (document _id -> projection).
   * RAG status lives on fileMetadata.ragStatus now (not documents.ragInfo);
   * the batch transform populates this so per-doc projection is a map lookup.
   * Absent → the doc projects as not-indexed.
   */
  ragProjectionMap?: Map<string, DocumentRagProjection>;
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata is ConvexJsonRecord; shape is DocumentMetadata written by our code
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

  // RAG status projected from fileMetadata.ragStatus (canonical owner).
  const ragProjection = options?.ragProjectionMap?.get(String(document._id));

  // Controlled-record projection: state + version for the row badge, plus
  // the reviewer a pending review waits on (name via the same batch map
  // that resolves creators).
  const record = document.record
    ? {
        state: document.record.state,
        version: document.record.version,
        ...(document.fileId !== undefined
          ? { currentFileId: String(document.fileId) }
          : {}),
        ...(document.record.reviewerUserId !== undefined
          ? {
              reviewerUserId: document.record.reviewerUserId,
              ...(options?.userNamesMap?.get(document.record.reviewerUserId) !==
              undefined
                ? {
                    reviewerName: options.userNamesMap.get(
                      document.record.reviewerUserId,
                    ),
                  }
                : {}),
            }
          : {}),
      }
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
    folderId: document.folderId ? String(document.folderId) : undefined,
    sourceProvider:
      document.sourceProvider ?? metadata?.sourceProvider ?? 'upload',
    sourceMode: normalizeSourceMode(metadata?.sourceMode),
    sourceCreatedAt: document.sourceCreatedAt,
    sourceModifiedAt: document.sourceModifiedAt,
    lastModified: getDocumentEffectiveDate(document, metadata),
    uploadedAt: document._creationTime,
    syncConfigId: metadata?.syncConfigId,
    isDirectlySelected: metadata?.isDirectlySelected,
    url,
    // RAG status projected from fileMetadata (canonical), not documents.ragInfo
    ragStatus: ragProjection?.status,
    ragIndexedAt: ragProjection?.indexedAt,
    ragError: ragProjection?.error,
    ragErrorCode: ragProjection?.errorCode,
    scannedPagesDetected: document.scannedPagesDetected,
    ocrApplied: document.ocrApplied,
    teamId: document.teamId ?? null,
    teamIds: document.teamTags ?? [],
    // Creator tracking
    createdBy: document.createdBy,
    createdByName,
    ...(record !== undefined ? { record } : {}),
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

  // Collect unique user IDs and file IDs (creators + record reviewers share
  // one name-resolution batch)
  const userIds = documents
    .flatMap((doc) => [doc.createdBy, doc.record?.reviewerUserId])
    .filter((id): id is string => !!id);

  const fileRefs = documents.flatMap((doc) =>
    doc.fileId
      ? [{ fileId: doc.fileId, organizationId: doc.organizationId }]
      : [],
  );

  // Batch fetch user names, storage URLs, and RAG status projections in parallel
  const [userNamesMap, storageUrlsMap, ragProjectionMap] = await Promise.all([
    getUserNamesBatch(ctx, userIds),
    batchGetStorageUrls(ctx, fileRefs),
    getDocumentRagProjectionBatch(ctx, documents),
  ]);

  // Transform all documents using pre-fetched data
  return documents.map((doc) =>
    transformToDocumentItem(doc, {
      userNamesMap,
      storageUrlsMap,
      ragProjectionMap,
    }),
  );
}

/**
 * Batch fetch storage URLs for multiple file refs
 */
async function batchGetStorageUrls(
  ctx: QueryCtx,
  fileRefs: {
    fileId: NonNullable<Doc<'documents'>['fileId']>;
    organizationId: string;
  }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  if (fileRefs.length === 0) {
    return result;
  }

  // Deduplicate file refs using string representation
  const seenIds = new Set<string>();
  const uniqueRefs: typeof fileRefs = [];
  for (const ref of fileRefs) {
    const key = String(ref.fileId);
    if (!seenIds.has(key)) {
      seenIds.add(key);
      uniqueRefs.push(ref);
    }
  }

  // Fetch all URLs in parallel and rewrite to public-facing URLs. A Convex
  // `_storage` id gets the direct (proxied) storage URL; an `s3:` ref gets the
  // `/storage?ref=…&org=…` route URL — a query cannot presign S3, so the node
  // route 302s to a short-lived presigned GET (mirrors thread_files/queries.ts).
  const urlPromises = uniqueRefs.map(async ({ fileId, organizationId }) => {
    if (isS3Ref(fileId)) {
      return {
        fileId: String(fileId),
        url: buildBlobServeUrl(String(fileId), organizationId),
      };
    }
    const convexId = convexStorageId(fileId);
    const raw = convexId === null ? null : await ctx.storage.getUrl(convexId);
    return { fileId: String(fileId), url: raw ? toPublicUrl(raw) : raw };
  });

  const urls = await Promise.all(urlPromises);

  for (const { fileId, url } of urls) {
    if (url) {
      result.set(fileId, url);
    }
  }

  return result;
}
