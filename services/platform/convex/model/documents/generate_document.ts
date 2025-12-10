/**
 * Generate a document via the crawler service and store it in Convex storage.
 *
 * This is the model-layer helper; Convex actions should call this via a thin
 * wrapper in `convex/documents.ts`.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { GenerateDocumentArgs, GenerateDocumentResult } from './types';
import {
  buildDownloadUrl,
  buildRequestBody,
  getCrawlerUrl,
  getEndpointPath,
  getOutputInfo,
} from './generate_document_helpers';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

/**
 * Generate a document (PDF/image) using the crawler and upload it to storage.
 */
export async function generateDocument(
  ctx: ActionCtx,
  args: GenerateDocumentArgs,
): Promise<GenerateDocumentResult> {
  const crawlerUrl = getCrawlerUrl();

  const endpointPath = getEndpointPath(args.sourceType, args.outputFormat);
  const apiUrl = `${crawlerUrl}${endpointPath}`;

  const requestBody = buildRequestBody(
    args.sourceType,
    args.outputFormat,
    args.content,
    args.pdfOptions,
    args.imageOptions,
    args.urlOptions,
    args.extraCss,
    args.wrapInTemplate,
  );

  debugLog('documents.generateDocument start', {
    fileName: args.fileName,
    sourceType: args.sourceType,
    outputFormat: args.outputFormat,
    contentLength: args.content.length,
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[documents.generateDocument] crawler error', {
      status: response.status,
      statusText: response.statusText,
      errorText,
    });
    throw new Error(
      `Crawler generateDocument failed: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const size = bytes.byteLength;

  const { contentType, extension } = getOutputInfo(
    args.outputFormat,
    args.imageOptions?.imageType,
  );

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
    },
    body: bytes,
  });

  if (!uploadResponse.ok) {
    const uploadErrorText = await uploadResponse.text().catch(() => '');
    console.error('[documents.generateDocument] upload error', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      uploadErrorText,
    });
    throw new Error(
      `Failed to upload generated document: ${uploadResponse.status} ${uploadResponse.statusText}`,
    );
  }

  const { storageId } = (await uploadResponse.json()) as {
    storageId: Id<'_storage'>;
  };

  const safeExtension = extension || 'pdf';
  const lowerFileName = args.fileName.toLowerCase();
  const expectedSuffix = `.${safeExtension.toLowerCase()}`;
  const finalFileName = lowerFileName.endsWith(expectedSuffix)
    ? args.fileName
    : `${args.fileName}.${safeExtension}`;

  // Build download URL using our custom HTTP endpoint that sets Content-Disposition
  // This ensures the downloaded file has the correct filename instead of the storage ID
  const downloadUrl = buildDownloadUrl(storageId, finalFileName);

  debugLog('documents.generateDocument success', {
    fileName: finalFileName,
    storageId,
    size,
    contentType,
    extension: safeExtension,
  });

  return {
    success: true,
    fileId: storageId,
    url: downloadUrl,
    fileName: finalFileName,
    contentType,
    size,
    extension: safeExtension,
  };
}
