/**
 * Generate a DOCX document via the crawler service and store it in Convex storage.
 *
 * This is the model-layer helper; Convex actions should call this via a thin
 * wrapper in `convex/documents.ts`.
 */

import { decode as decodeBase64 } from 'base64-arraybuffer';

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { createDebugLog } from '../lib/debug_log';
import { buildDownloadUrl, getCrawlerUrl } from './generate_document_helpers';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export interface DocxSection {
  type:
    | 'heading'
    | 'paragraph'
    | 'bullets'
    | 'numbered'
    | 'table'
    | 'quote'
    | 'code';
  text?: string;
  level?: number; // For headings (1-6)
  items?: string[]; // For bullets/numbered lists
  headers?: string[]; // For tables
  rows?: string[][]; // For tables
}

export interface DocxContent {
  title?: string;
  subtitle?: string;
  sections: DocxSection[];
}

export interface GenerateDocxArgs {
  fileName: string;
  content: DocxContent;
}

export interface GenerateDocxResult {
  success: boolean;
  fileId: Id<'_storage'>;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Generate a DOCX document from structured content using the crawler service.
 */
export async function generateDocx(
  ctx: ActionCtx,
  args: GenerateDocxArgs,
): Promise<GenerateDocxResult> {
  const crawlerUrl = getCrawlerUrl();
  const apiUrl = `${crawlerUrl}/api/v1/docx`;

  const requestBody = {
    content: args.content,
  };

  debugLog('documents.generateDocx start', {
    fileName: args.fileName,
    sectionsCount: args.content.sections.length,
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[documents.generateDocx] crawler error', {
      status: response.status,
      errorText,
    });
    throw new Error(`Crawler generateDocx failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.file_base64) {
    throw new Error(result.error || 'Failed to generate DOCX');
  }

  // Decode base64 and upload to Convex storage
  const docxArrayBuffer = decodeBase64(result.file_base64);
  const docxBytes = new Uint8Array(docxArrayBuffer);
  const contentType =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: docxBytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload DOCX: ${uploadResponse.status}`);
  }

  const { storageId } = (await uploadResponse.json()) as {
    storageId: Id<'_storage'>;
  };

  const finalFileName = args.fileName.toLowerCase().endsWith('.docx')
    ? args.fileName
    : `${args.fileName}.docx`;

  // Build download URL using our custom HTTP endpoint that sets Content-Disposition
  // This ensures the downloaded file has the correct filename instead of the storage ID
  const downloadUrl = buildDownloadUrl(storageId, finalFileName);

  debugLog('documents.generateDocx success', {
    fileName: finalFileName,
    storageId,
    size: docxBytes.length,
  });

  return {
    success: true,
    fileId: storageId,
    url: downloadUrl,
    fileName: finalFileName,
    contentType,
    size: docxBytes.length,
  };
}
