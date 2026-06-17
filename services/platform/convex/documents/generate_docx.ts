'use node';

/**
 * Generate a DOCX document from structured content in-process and store it in
 * Convex storage.
 *
 * `'use node'`: value-imports the `'use node'` `crawler/lib/docx_generate`
 * (jszip OOXML). Invoked only from `'use node'` internalActions and NOT
 * re-exported by the V8-reachable `documents/helpers` barrel — see
 * `generate_document.ts` for the Node/V8 boundary rationale.
 *
 * Replaces the former `services/crawler` HTTP call (`POST /api/v1/docx`): the
 * OOXML package is now assembled in-process via `crawler/lib/docx_generate`
 * (jszip + hand-written `word/document.xml`).
 *
 * This is the model-layer helper; Convex actions call it via a thin wrapper in
 * `convex/documents.ts`.
 */

import { fetchJson } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import {
  generateDocxBytes,
  type DocxContent,
  type DocxSection,
} from '../crawler/lib/docx_generate';
import { createDebugLog } from '../lib/debug_log';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { buildDownloadUrl } from './generate_document_helpers';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

export type { DocxContent, DocxSection };

export interface GenerateDocxArgs {
  organizationId: string;
  fileName: string;
  content: DocxContent;
}

export interface GenerateDocxResult {
  success: boolean;
  fileStorageId: Id<'_storage'>;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
}

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Generate a DOCX document from structured content (in-process OOXML build).
 */
export async function generateDocx(
  ctx: ActionCtx,
  args: GenerateDocxArgs,
): Promise<GenerateDocxResult> {
  debugLog('documents.generateDocx start', {
    fileName: args.fileName,
    sectionsCount: args.content.sections.length,
  });

  const docxBytes = await generateDocxBytes(args.content);

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': DOCX_CONTENT_TYPE },
    body: docxBytes,
  });

  if (!uploadResponse.ok) {
    const uploadErrorText = await uploadResponse.text().catch(() => '');
    // Storage upload (Convex `_storage`) — scrub body via sanitizeError before
    // logging so any signed URL or token in the response can't leak. Throw a
    // status-only error to the caller.
    console.error('[documents.generateDocx] upload error', {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      errorText: sanitizeError(uploadErrorText, 400),
    });
    throw new Error(`Failed to upload DOCX: HTTP ${uploadResponse.status}`);
  }

  const { storageId } = await fetchJson<{ storageId: Id<'_storage'> }>(
    uploadResponse,
  );

  const finalFileName = args.fileName.toLowerCase().endsWith('.docx')
    ? args.fileName
    : `${args.fileName}.docx`;

  await ctx.runMutation(
    internal.file_metadata.internal_mutations.saveFileMetadata,
    {
      organizationId: args.organizationId,
      storageId,
      fileName: finalFileName,
      contentType: DOCX_CONTENT_TYPE,
      size: docxBytes.length,
      source: 'agent',
    },
  );

  const downloadUrl = buildDownloadUrl(storageId, finalFileName);

  debugLog('documents.generateDocx success', {
    fileName: finalFileName,
    storageId,
    size: docxBytes.length,
  });

  return {
    success: true,
    fileStorageId: storageId,
    downloadUrl,
    fileName: finalFileName,
    contentType: DOCX_CONTENT_TYPE,
    size: docxBytes.length,
  };
}
