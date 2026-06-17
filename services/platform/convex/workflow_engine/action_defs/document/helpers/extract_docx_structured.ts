'use node';

/**
 * Extract structured paragraph data from a DOCX file in-process.
 *
 * Replaces the former crawler `POST /api/v1/docx/extract-structured` call: gets
 * the file from Convex storage and parses it via `crawler/lib/docx_roundtrip`
 * (`extractStructured`), returning the lightweight paragraph list with stable
 * keys + a source hash for the apply step.
 */

import { v } from 'convex/values';

import { internalAction, type ActionCtx } from '../../../../_generated/server';
import { extractStructured } from '../../../../crawler/lib/docx_roundtrip';
import { createDebugLog } from '../../../../lib/debug_log';
import { toId } from '../../../../lib/type_cast_helpers';

const debugLog = createDebugLog('DEBUG_DOCUMENTS', '[Documents]');

interface LightweightParagraph {
  key: string;
  text: string;
  editable: boolean;
  style?: string | null;
}

interface ExtractStructuredMetadata {
  paragraph_count: number;
  table_count: number;
  group_count: number;
}

export interface ExtractDocxStructuredResult {
  source_hash: string;
  metadata: ExtractStructuredMetadata;
  lightweight: LightweightParagraph[];
  groups: LightweightParagraph[][];
}

export async function extractDocxStructured(
  ctx: ActionCtx,
  fileId: string,
  organizationId: string,
): Promise<ExtractDocxStructuredResult> {
  debugLog('extractDocxStructured start', { fileId });
  void organizationId;

  // Get file from storage and read its bytes in-process.
  const fileBlob = await ctx.storage.get(toId<'_storage'>(fileId));
  if (!fileBlob) {
    throw new Error(`File not found in storage: ${fileId}`);
  }
  const bytes = new Uint8Array(await fileBlob.arrayBuffer());

  const result = await extractStructured(bytes, 'document.docx');

  debugLog('extractDocxStructured success', {
    fileId,
    paragraphCount: result.metadata.paragraph_count,
    tableCount: result.metadata.table_count,
  });

  return result;
}

/**
 * Node-runtime entry point. `document_action` runs in the V8 runtime, so it
 * cannot value-import this `'use node'` module (that would pull `node:crypto`
 * from `docx_roundtrip` into the V8 bundle). It invokes this action via
 * `ctx.runAction` instead.
 */
export const extractDocxStructuredAction = internalAction({
  args: { fileId: v.string(), organizationId: v.string() },
  handler: async (ctx, args): Promise<ExtractDocxStructuredResult> =>
    extractDocxStructured(ctx, args.fileId, args.organizationId),
});
