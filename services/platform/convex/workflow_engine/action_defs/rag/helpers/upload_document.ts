import {
  extractExtension,
  mimeToExtension,
} from '../../../../../lib/shared/file-types';
import { internal } from '../../../../_generated/api';
import type { ActionCtx } from '../../../../_generated/server';
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

  return uploadFile({
    file,
    filename: fileName,
    contentType,
    fileId,
    metadata: options?.metadata,
    sync: options?.sync ?? false,
  });
}
