/**
 * Upload base64-encoded file content to Convex storage (no documents row).
 *
 * This is the model-layer helper; Convex actions should call this via a thin
 * wrapper in `convex/documents.ts`.
 */

import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { base64ToBytes } from '../lib/crypto/base64_to_bytes';
import { buildDownloadUrl } from './generate_document_helpers';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export interface UploadBase64Args {
  fileName: string;
  contentType: string;
  dataBase64: string;
}

export interface UploadBase64Result {
  success: boolean;
  fileId: Id<'_storage'>;
  url: string;
  fileName: string;
  size: number;
  contentType: string;
}

export async function uploadBase64ToStorage(
  ctx: ActionCtx,
  args: UploadBase64Args,
): Promise<UploadBase64Result> {
  const { fileName, contentType, dataBase64 } = args;

  debugLog('documents.uploadBase64ToStorage start', {
    fileName,
    contentType,
    dataLength: dataBase64.length,
  });

  const bytes = base64ToBytes(dataBase64);
  const size = bytes.byteLength;

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    // Cast to unknown first to avoid SharedArrayBuffer incompatibility in TS
    body: new Blob([bytes as unknown as ArrayBuffer], { type: contentType }),
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => '');
    console.error('[documents.uploadBase64ToStorage] upload failed', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      body: text,
    });
    throw new Error(
      `Failed to upload file to Convex storage: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  const { storageId } = (await uploadResponse.json()) as {
    storageId: Id<'_storage'>;
  };

  // Build download URL using our custom HTTP endpoint that sets Content-Disposition
  // This ensures the downloaded file has the correct filename instead of the storage ID
  const downloadUrl = buildDownloadUrl(storageId, fileName);

  debugLog('documents.uploadBase64ToStorage success', {
    fileName,
    storageId,
    size,
  });

  return {
    success: true,
    fileId: storageId,
    url: downloadUrl,
    fileName,
    size,
    contentType,
  };
}
