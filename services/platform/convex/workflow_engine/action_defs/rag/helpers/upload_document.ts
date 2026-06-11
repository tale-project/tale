import {
  extractExtension,
  mimeToExtension,
} from '../../../../../lib/shared/file-types';
import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
import { orgSlugFromId } from '../../../../lib/helpers/org_slug';
import { normalizeFolderPath } from '../../../../lib/helpers/rag_folder_path';
import { toId } from '../../../../lib/type_cast_helpers';
import type { RagUploadResult } from './types';
import { uploadFile } from './upload_file_direct';

function ensureExtension(fileName: string, contentType: string): string {
  if (extractExtension(fileName)) {
    return fileName;
  }

  const ext = mimeToExtension(contentType);
  if (ext) {
    return `${fileName}.${ext}`;
  }

  return fileName;
}

export async function uploadDocument(
  ctx: ActionCtx,
  fileId: string,
  options?: {
    sync?: boolean;
    fileName?: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
    /**
     * Document Hub folder path for folder-scoped RAG search. When
     * omitted, resolved from the Hub document linked via
     * `fileMetadata.documentId` (covers every upload path that funnels
     * through this helper).
     */
    folderPath?: string;
  },
): Promise<RagUploadResult> {
  const storageId = toId<'_storage'>(fileId);

  const fileUrl = await ctx.storage.getUrl(storageId);
  if (!fileUrl) {
    throw new Error(`File URL not available: ${fileId}`);
  }

  // 30s timeout: the storage CDN can stall; without a timeout the
  // entire workflow action blocks indefinitely, holding a Convex
  // concurrency slot until the surrounding 30 min action timeout fires.
  // Round-2 review HIGH (E.4.3).
  const fileResponse = await fetch(fileUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!fileResponse.ok) {
    throw new Error(`Failed to download file: ${fileResponse.status}`);
  }
  const file = await fileResponse.blob();

  const metadata = await ctx.runQuery(
    internal.file_metadata.internal_queries.getByStorageId,
    { storageId },
  );

  if (!metadata) {
    throw new Error(
      `File metadata not found for storageId: ${fileId}. Every uploaded file must have a fileMetadata record.`,
    );
  }

  const contentType = options?.contentType || metadata.contentType;
  const fileName = ensureExtension(
    options?.fileName || metadata.fileName,
    contentType,
  );

  // Resolve the linked Hub document: it carries the denormalized
  // folderPath for folder-scoped search plus the filterable metadata
  // fields (team_id / source_provider / extension) RAG stores for
  // metadata pre-filtering. Chat uploads (no documentId) simply carry
  // neither.
  const document = metadata.documentId
    ? await ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId: metadata.documentId },
      )
    : null;

  // Explicit folderPath option wins; otherwise fall back to the Hub
  // document's denormalized folderPath.
  const folderPath =
    normalizeFolderPath(options?.folderPath) ??
    normalizeFolderPath(document?.folderPath);

  // Stamp the fixed, platform-controlled metadata set (no free-form
  // user keys — they would widen the validation and prompt-injection
  // surface). RAG strips reserved transport keys and re-validates.
  const documentMetadata: Record<string, unknown> = { ...options?.metadata };
  if (document?.teamId) documentMetadata.team_id = document.teamId;
  if (document?.sourceProvider) {
    documentMetadata.source_provider = document.sourceProvider;
  }
  const extension = document?.extension ?? extractExtension(fileName);
  if (extension) documentMetadata.extension = extension;
  if (folderPath) documentMetadata.folder_path = folderPath;

  const orgSlug = await orgSlugFromId(ctx, metadata.organizationId);

  return uploadFile({
    file,
    filename: fileName,
    contentType,
    fileId,
    metadata:
      Object.keys(documentMetadata).length > 0 ? documentMetadata : undefined,
    sync: options?.sync ?? false,
    orgSlug,
  });
}
