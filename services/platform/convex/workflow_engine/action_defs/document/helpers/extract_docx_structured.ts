'use node';

/**
 * Extract structured paragraph data from a DOCX file via the crawler service.
 *
 * Gets the file from Convex storage, sends it to the crawler /extract-structured
 * endpoint, and returns the lightweight paragraph list with stable keys.
 */

import type { ActionCtx } from '../../../../_generated/server';

import { fetchJson } from '../../../../../lib/utils/type-cast-helpers';
import { getCrawlerUrl } from '../../../../documents/generate_document_helpers';
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
): Promise<ExtractDocxStructuredResult> {
  const crawlerUrl = getCrawlerUrl();
  const apiUrl = `${crawlerUrl}/api/v1/docx/extract-structured`;

  debugLog('extractDocxStructured start', { fileId });

  // Get file from storage
  const fileBlob = await ctx.storage.get(toId<'_storage'>(fileId));
  if (!fileBlob) {
    throw new Error(`File not found in storage: ${fileId}`);
  }

  // Upload to crawler
  const formData = new FormData();
  formData.append('file', fileBlob, 'document.docx');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const response = await fetch(apiUrl, {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Crawler extract-structured failed: ${response.status} ${errorText}`,
    );
  }

  const result = await fetchJson<ExtractDocxStructuredResult>(response);

  debugLog('extractDocxStructured success', {
    fileId,
    paragraphCount: result.metadata.paragraph_count,
    tableCount: result.metadata.table_count,
  });

  return result;
}
