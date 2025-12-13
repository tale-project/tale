/**
 * Generate a DOCX document from a template via the crawler service.
 *
 * This is the model-layer helper; Convex actions should call this via a thin
 * wrapper in `convex/documents.ts`.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { buildDownloadUrl, getCrawlerUrl } from './generate_document_helpers';
import { createDebugLog } from '../../lib/debug_log';
import type { DocxContent } from './generate_docx';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export interface GenerateDocxFromTemplateArgs {
  fileName: string;
  content: DocxContent;
  templateStorageId: Id<'_storage'>;
}

export interface GenerateDocxFromTemplateResult {
  success: boolean;
  fileId: Id<'_storage'>;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Generate a DOCX from content using a template as the base.
 *
 * When templateStorageId is provided, uses the template as a base, preserving
 * all styling, headers/footers, and document properties.
 */
export async function generateDocxFromTemplate(
  ctx: ActionCtx,
  args: GenerateDocxFromTemplateArgs,
): Promise<GenerateDocxFromTemplateResult> {
  const crawlerUrl = getCrawlerUrl();
  const apiUrl = `${crawlerUrl}/api/v1/docx/from-template`;

  // Prepare content as JSON string
  const contentJson = JSON.stringify(args.content);

  debugLog('documents.generateDocxFromTemplate start', {
    fileName: args.fileName,
    sectionsCount: args.content.sections.length,
    templateStorageId: args.templateStorageId,
  });

  // Create FormData with content
  const formData = new FormData();
  formData.append('content', contentJson);

  // Download template and add to form data
  const templateUrl = await ctx.storage.getUrl(args.templateStorageId);
  if (!templateUrl) {
    throw new Error('Template file not found in storage');
  }

  debugLog('documents.generateDocxFromTemplate downloading template', {
    templateStorageId: args.templateStorageId,
  });

  const templateResponse = await fetch(templateUrl);
  if (!templateResponse.ok) {
    throw new Error(`Failed to download template: ${templateResponse.status}`);
  }

  const templateBlob = await templateResponse.blob();
  formData.append('template_file', templateBlob, 'template.docx');

  const response = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[documents.generateDocxFromTemplate] crawler error', {
      status: response.status,
      errorText,
    });
    throw new Error(`Crawler generateDocxFromTemplate failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.file_base64) {
    throw new Error(result.error || 'Failed to generate DOCX from template');
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

  // Build download URL using our custom HTTP endpoint
  const downloadUrl = buildDownloadUrl(storageId, finalFileName);

  debugLog('documents.generateDocxFromTemplate success', {
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

