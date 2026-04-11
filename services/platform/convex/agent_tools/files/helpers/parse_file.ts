import type { ActionCtx } from '../../../_generated/server';
import { toId } from '../../../lib/type_cast_helpers';

interface ParseFileResult {
  success: boolean;
  full_text?: string;
  error?: string;
}

/**
 * Parse a document file and extract its text content.
 */
export async function parseFile(
  ctx: ActionCtx,
  fileId: string,
  _fileName: string,
  _toolName?: string,
  _userText?: string,
): Promise<ParseFileResult> {
  try {
    const url = await ctx.storage.getUrl(toId<'_storage'>(fileId));
    if (!url) {
      return { success: false, error: `No storage URL for fileId ${fileId}` };
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
