'use node';

/**
 * Apply text modifications to a DOCX template via the crawler service.
 *
 * Downloads the template from Convex storage, sends it to the crawler
 * /apply-structured endpoint with modifications, stores the result back
 * in Convex storage, and returns a download URL.
 */

import { decode as decodeBase64 } from 'base64-arraybuffer';

import { fetchJson } from '../../../../../lib/utils/type-cast-helpers';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';
import {
  buildDownloadUrl,
  getCrawlerUrl,
} from '../../../../documents/generate_document_helpers';
import { createDebugLog } from '../../../../lib/debug_log';
import { UpstreamHttpError } from '../../../../lib/errors/upstream_http_error';
import { orgSlugFromId } from '../../../../lib/helpers/org_slug';
import { toId } from '../../../../lib/type_cast_helpers';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

interface Modification {
  key: string;
  text: string;
}

interface ApplyReport {
  total_modifications_requested: number;
  applied: number;
  success: boolean;
  skipped_not_editable: string[];
  skipped_unknown_key: string[];
  skipped_no_change: string[];
  skipped_non_text_content: string[];
  format_simplified: string[];
  errors: Array<{ key: string; error: string }>;
}

interface CrawlerApplyResponse {
  success: boolean;
  file_base64: string | null;
  file_size: number | null;
  report: ApplyReport | null;
  error: string | null;
}

export interface ApplyDocxStructuredArgs {
  templateFileId: string;
  sourceHash: string;
  modifications: Modification[];
  fileName: string;
  organizationId: string;
  trackChanges?: boolean;
  author?: string;
}

export interface ApplyDocxStructuredResult {
  success: boolean;
  fileStorageId: string;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
  report: ApplyReport;
}

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function applyDocxStructured(
  ctx: ActionCtx,
  args: ApplyDocxStructuredArgs,
): Promise<ApplyDocxStructuredResult> {
  const crawlerUrl = getCrawlerUrl();
  const apiUrl = `${crawlerUrl}/api/v1/docx/apply-structured`;

  debugLog('applyDocxStructured start', {
    templateFileId: args.templateFileId,
    modificationsCount: args.modifications.length,
    trackChanges: args.trackChanges ?? false,
  });

  // Download template from storage
  const templateUrl = await ctx.storage.getUrl(
    toId<'_storage'>(args.templateFileId),
  );
  if (!templateUrl) {
    throw new Error(
      `Template file not found in storage: ${args.templateFileId}`,
    );
  }

  const templateResponse = await fetch(templateUrl);
  if (!templateResponse.ok) {
    throw new Error(`Failed to download template: ${templateResponse.status}`);
  }
  const templateBlob = await templateResponse.blob();

  // Build params JSON
  const params = JSON.stringify({
    source_hash: args.sourceHash,
    modifications: args.modifications,
    track_changes: args.trackChanges ?? false,
    author: args.author ?? 'AI Assistant',
  });

  // Send to crawler
  const formData = new FormData();
  formData.append('template_file', templateBlob, 'template.docx');
  formData.append('params', params);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const orgSlug = await orgSlugFromId(ctx, args.organizationId);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'x-tale-org': orgSlug },
    body: formData,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw UpstreamHttpError.fromResponse(
      'crawler',
      response,
      errorText,
      '/api/v1/docx/apply-structured',
    );
  }

  const result = await fetchJson<CrawlerApplyResponse>(response);

  if (!result.success || !result.file_base64) {
    throw new Error(
      result.error || 'Failed to apply structured modifications to DOCX',
    );
  }

  // Decode base64 and upload to Convex storage
  const docxArrayBuffer = decodeBase64(result.file_base64);
  const docxBytes = new Uint8Array(docxArrayBuffer);

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': DOCX_CONTENT_TYPE },
    body: docxBytes,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload modified DOCX: ${uploadResponse.status}`);
  }

  const { storageId } = await fetchJson<{ storageId: Id<'_storage'> }>(
    uploadResponse,
  );

  const finalFileName = args.fileName.toLowerCase().endsWith('.docx')
    ? args.fileName
    : `${args.fileName}.docx`;

  // Save file metadata so the file shows up in the org's library.
  // Cleanup the just-uploaded _storage blob if the metadata write
  // fails — without this, a transient mutation failure leaves an
  // orphan blob in the global _storage namespace with no fileMetadata
  // pointer (round-3 P2 R10-P2-c).
  try {
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
  } catch (err) {
    try {
      await ctx.storage.delete(storageId);
    } catch (deleteErr) {
      console.warn(
        `[applyDocxStructured] orphan-blob cleanup failed for ${storageId}:`,
        deleteErr instanceof Error ? deleteErr.message : deleteErr,
      );
    }
    throw err;
  }

  const downloadUrl = buildDownloadUrl(storageId, finalFileName);

  debugLog('applyDocxStructured success', {
    fileName: finalFileName,
    storageId,
    size: docxBytes.length,
    applied: result.report?.applied ?? 0,
  });

  return {
    success: true,
    fileStorageId: String(storageId),
    downloadUrl,
    fileName: finalFileName,
    contentType: DOCX_CONTENT_TYPE,
    size: docxBytes.length,
    report: result.report ?? {
      total_modifications_requested: args.modifications.length,
      applied: 0,
      success: true,
      skipped_not_editable: [],
      skipped_unknown_key: [],
      skipped_no_change: [],
      skipped_non_text_content: [],
      format_simplified: [],
      errors: [],
    },
  };
}
