'use node';

/**
 * Apply text modifications to a DOCX template in-process.
 *
 * Replaces the former crawler `POST /api/v1/docx/apply-structured` call:
 * downloads the template from Convex storage, applies the modifications via
 * `crawler/lib/docx_roundtrip` (`applyStructured`, OOXML in-place edit with
 * optional tracked changes), stores the result back in Convex storage, and
 * returns a download URL.
 */

import { v } from 'convex/values';

import { fetchJson } from '../../../../../lib/utils/type-utils';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import { internalAction, type ActionCtx } from '../../../../_generated/server';
import {
  applyStructured,
  type ApplyReport,
} from '../../../../crawler/lib/docx_roundtrip';
import { buildDownloadUrl } from '../../../../documents/generate_document_helpers';
import { createDebugLog } from '../../../../lib/debug_log';
import { toId } from '../../../../lib/type_cast_helpers';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

interface Modification {
  key: string;
  text: string;
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
  debugLog('applyDocxStructured start', {
    templateFileId: args.templateFileId,
    modificationsCount: args.modifications.length,
    trackChanges: args.trackChanges ?? false,
  });

  // Read template bytes from storage in-process.
  const templateBlob = await ctx.storage.get(
    toId<'_storage'>(args.templateFileId),
  );
  if (!templateBlob) {
    throw new Error(
      `Template file not found in storage: ${args.templateFileId}`,
    );
  }
  const templateBytes = new Uint8Array(await templateBlob.arrayBuffer());

  const { bytes: docxBytes, report } = await applyStructured(
    templateBytes,
    args.sourceHash,
    args.modifications,
    { trackChanges: args.trackChanges, author: args.author },
  );

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

  // Save file metadata so the file shows up in the org's library. Cleanup the
  // just-uploaded `_storage` blob if the metadata write fails — without this,
  // a transient mutation failure leaves an orphan blob with no fileMetadata
  // pointer.
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
    applied: report.applied,
  });

  return {
    success: true,
    fileStorageId: String(storageId),
    downloadUrl,
    fileName: finalFileName,
    contentType: DOCX_CONTENT_TYPE,
    size: docxBytes.length,
    report,
  };
}

/**
 * Node-runtime entry point invoked by the V8 `document_action` via
 * `ctx.runAction` — see the note on `extractDocxStructuredAction`.
 */
export const applyDocxStructuredAction = internalAction({
  args: {
    templateFileId: v.string(),
    sourceHash: v.string(),
    modifications: v.array(v.object({ key: v.string(), text: v.string() })),
    fileName: v.string(),
    organizationId: v.string(),
    trackChanges: v.optional(v.boolean()),
    author: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ApplyDocxStructuredResult> =>
    applyDocxStructured(ctx, args),
});
