/**
 * Generate a PPTX document via the crawler service and store it in Convex storage.
 *
 * This is the model-layer helper; Convex actions should call this via a thin
 * wrapper in `convex/documents.ts`.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { getCrawlerUrl } from './generate_document_helpers';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

/**
 * Table data for PPTX generation.
 */
export interface TableData {
  headers: string[];
  rows: string[][];
}

/**
 * Content for a single slide in the PPTX.
 */
export interface SlideContentData {
  title?: string;
  subtitle?: string;
  textContent?: string[];
  bulletPoints?: string[];
  tables?: TableData[];
}

/**
 * Branding/styling information for the PPTX.
 */
export interface PptxBrandingData {
  slideWidth?: number;
  slideHeight?: number;
  titleFontName?: string;
  bodyFontName?: string;
  titleFontSize?: number;
  bodyFontSize?: number;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}

export interface GeneratePptxArgs {
  fileName: string;
  slidesContent: SlideContentData[];
  branding?: PptxBrandingData;
  /** Template storage ID - uses template as base preserving styling */
  templateStorageId: Id<'_storage'>;
}

export interface GeneratePptxResult {
  success: boolean;
  fileId: Id<'_storage'>;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Generate a PPTX from content using the crawler service.
 *
 * When templateStorageId is provided, uses the template as a base, preserving
 * all styling, backgrounds, and decorative elements.
 *
 * When no template is provided, creates a new blank presentation.
 */
export async function generatePptx(
  ctx: ActionCtx,
  args: GeneratePptxArgs,
): Promise<GeneratePptxResult> {
  const crawlerUrl = getCrawlerUrl();
  const apiUrl = `${crawlerUrl}/api/v1/template/generate-pptx`;

  // Prepare slide content as JSON string
  const slidesContentJson = JSON.stringify(args.slidesContent);

  debugLog('documents.generatePptx start', {
    fileName: args.fileName,
    slidesCount: args.slidesContent.length,
    hasBranding: !!args.branding,
    templateStorageId: args.templateStorageId,
  });

  // Create FormData with slides content and optional branding
  const formData = new FormData();
  formData.append('slides_content', slidesContentJson);
  if (args.branding) {
    formData.append('branding', JSON.stringify(args.branding));
  }

  // Download template and add to form data
  const templateUrl = await ctx.storage.getUrl(args.templateStorageId);
  if (!templateUrl) {
    throw new Error('Template file not found in storage');
  }

  debugLog('documents.generatePptx downloading template', {
    templateStorageId: args.templateStorageId,
  });

  const templateResponse = await fetch(templateUrl);
  if (!templateResponse.ok) {
    throw new Error(`Failed to download template: ${templateResponse.status}`);
  }

  const templateBlob = await templateResponse.blob();
  formData.append('template_file', templateBlob, 'template.pptx');

  const response = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[documents.generatePptx] crawler error', {
      status: response.status,
      errorText,
    });
    throw new Error(`Crawler generatePptx failed: ${response.status}`);
  }

  const result = await response.json();

  if (!result.success || !result.file_base64) {
    throw new Error(result.error || 'Failed to generate PPTX');
  }

  // Decode base64 and upload to Convex storage
  const pptxArrayBuffer = decodeBase64(result.file_base64);
  const pptxBytes = new Uint8Array(pptxArrayBuffer);
  const contentType =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: pptxBytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload PPTX: ${uploadResponse.status}`);
  }

  const { storageId } = (await uploadResponse.json()) as {
    storageId: Id<'_storage'>;
  };

  const finalFileName = args.fileName.toLowerCase().endsWith('.pptx')
    ? args.fileName
    : `${args.fileName}.pptx`;

  // Build download URL using our custom HTTP endpoint that sets Content-Disposition
  // This ensures the downloaded file has the correct filename instead of the storage ID
  const siteUrl =
    process.env.CONVEX_SITE_ORIGIN ||
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
    'http://127.0.0.1:3211';
  const downloadUrl = `${siteUrl}/storage?id=${storageId}&filename=${encodeURIComponent(finalFileName)}`;

  debugLog('documents.generatePptx success', {
    fileName: finalFileName,
    storageId,
    size: pptxBytes.length,
  });

  return {
    success: true,
    fileId: storageId,
    url: downloadUrl,
    fileName: finalFileName,
    contentType,
    size: pptxBytes.length,
  };
}
