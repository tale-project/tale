import type { ActionCtx } from '../../../../_generated/server';
import type { RagUploadResult } from './types';

import { toId } from '../../../../lib/type_cast_helpers';
import { uploadFile } from './upload_file_direct';

export async function uploadDocument(
  ctx: ActionCtx,
  ragServiceUrl: string,
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

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download file: ${fileResponse.status}`);
  }
  const file = await fileResponse.blob();

  const sync = options?.sync ?? false;

  return uploadFile({
    ragServiceUrl,
    file,
    filename: options?.fileName || 'document',
    contentType: options?.contentType || 'application/octet-stream',
    fileId,
    metadata: options?.metadata,
    sync,
  });
}
