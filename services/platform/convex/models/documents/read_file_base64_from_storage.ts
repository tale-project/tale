/**
 * Read a file from Convex storage and return base64 content.
 *
 * Model-layer helper; Convex actions should call this via a thin wrapper
 * in `convex/documents.ts`.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { bytesToBase64 } from '../../lib/crypto/base64_to_bytes';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export interface ReadFileBase64Args {
  fileId: Id<'_storage'>;
}

export interface ReadFileBase64Result {
  success: boolean;
  fileId: Id<'_storage'>;
  dataBase64: string;
  contentType: string;
  size: number;
}

export async function readFileBase64FromStorage(
  ctx: ActionCtx,
  args: ReadFileBase64Args,
): Promise<ReadFileBase64Result> {
  const { fileId } = args;

  debugLog('documents.readFileBase64FromStorage start', {
    fileId,
  });

  const blob = await ctx.storage.get(fileId);
  if (!blob) {
    console.error('[documents.readFileBase64FromStorage] file not found', {
      fileId,
    });
    throw new Error(`File not found in Convex storage: ${fileId}`);
  }

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const dataBase64 = bytesToBase64(bytes);
  const size = bytes.byteLength;
  const contentType = blob.type || 'application/octet-stream';

  debugLog('documents.readFileBase64FromStorage success', {
    fileId,
    size,
    contentType,
  });

  return {
    success: true,
    fileId,
    dataBase64,
    contentType,
    size,
  };
}
