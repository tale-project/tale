/**
 * Shared file parsing helper for PDF, DOCX, and PPTX tools.
 * Gets file from Convex storage and sends it to the crawler service for text extraction.
 * Uses ctx.storage.get() for direct Convex storage access (like image_tool and txt_tool).
 */

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { getParseEndpoint } from '../../../../lib/shared/file-types';
import { createDebugLog } from '../../../lib/debug_log';
import { getCrawlerServiceUrl } from '../../web/helpers/get_crawler_service_url';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export interface ParseFileResult {
  success: boolean;
  filename: string;
  file_type?: string;
  full_text?: string;
  page_count?: number;
  slide_count?: number;
  paragraph_count?: number;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
  };
  error?: string;
}

/**
 * Parse a file by getting it from Convex storage and sending it to the crawler service.
 * @param ctx - Action context for storage access
 * @param fileId - Convex storage ID of the file
 * @param filename - Original filename with extension
 * @param toolName - Name of the calling tool (for logging)
 * @param userInput - Optional user question/instruction to guide parsing
 * @returns ParseFileResult with extracted text and metadata
 */
export async function parseFile(
  ctx: ActionCtx,
  fileId: string,
  filename: string,
  toolName: string,
  userInput?: string,
): Promise<ParseFileResult> {
  debugLog(`tool:${toolName} parse start`, {
    fileId,
    filename,
  });

  try {
    // Get the file blob from Convex storage (like image_tool and txt_tool)
    const fileBlob = await ctx.storage.get(fileId as Id<'_storage'>);
    if (!fileBlob) {
      throw new Error(`File not found in storage: ${fileId}`);
    }

    debugLog(`tool:${toolName} parse got blob`, {
      filename,
      size: fileBlob.size,
      type: fileBlob.type,
    });

    const crawlerUrl = getCrawlerServiceUrl();
    const endpointPath = getParseEndpoint(filename);
    const apiUrl = `${crawlerUrl}${endpointPath}`;

    // Create FormData and upload to crawler service
    const formData = new FormData();
    formData.append('file', fileBlob, filename);
    if (userInput) {
      formData.append('user_input', userInput);
    }

    debugLog(`tool:${toolName} parse uploading to crawler`, {
      filename,
      size: fileBlob.size,
      endpoint: endpointPath,
      hasUserInput: !!userInput,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Crawler service error: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    debugLog(`tool:${toolName} parse success`, {
      filename: result.filename,
      success: result.success,
      textLength: result.full_text?.length ?? 0,
    });

    return result as ParseFileResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tool:${toolName} parse] error`, {
      filename,
      error: message,
    });
    return {
      success: false,
      filename,
      error: message,
    };
  }
}
