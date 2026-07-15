import type { ActionCtx } from '../../../_generated/server';
import { getBlobFetchUrl } from '../../../lib/storage/blob_read_any';
import type { BlobRef } from '../../../lib/storage/blob_ref';

interface ParseFileResult {
  success: boolean;
  full_text?: string;
  error?: string;
}

/**
 * Parse a document file and extract its text content. Backend-aware: a Convex
 * `_storage` id resolves to a direct storage URL (unchanged); an `s3:` ref is
 * presigned against the org's own bucket — hence `organizationId`.
 */
export async function parseFile(
  ctx: ActionCtx,
  fileId: BlobRef,
  organizationId: string,
  _fileName: string,
  _toolName?: string,
  _userText?: string,
): Promise<ParseFileResult> {
  try {
    const url = await getBlobFetchUrl(ctx, organizationId, fileId);
    if (!url) {
      return {
        success: false,
        error: `No storage URL for fileId ${String(fileId)}`,
      };
    }

    const response = await fetch(url);
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch file: ${response.statusText}`,
      };
    }

    const text = await response.text();
    return { success: true, full_text: text };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
