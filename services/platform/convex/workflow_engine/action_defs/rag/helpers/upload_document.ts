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

  // The in-process `uploadFile` indexer reads the bytes directly from Convex
  // storage via the `_storage` id, so this helper no longer downloads the file
  // into a Blob. Existence is validated by the metadata lookup below + the
  // indexing action's own `ctx.storage.get`.
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

  return uploadFile(ctx, {
    filename: fileName,
    contentType,
    fileId,
    metadata:
      Object.keys(documentMetadata).length > 0 ? documentMetadata : undefined,
    sync: options?.sync ?? false,
    orgSlug,
  });
}
