/**
 * Shared file parsing helper for PDF, DOCX, and PPTX tools.
 * Downloads a file from URL and sends it to the crawler service for text extraction.
 */

import { createDebugLog } from '../../../lib/debug_log';
import { getCrawlerServiceUrl } from '../../crawler/helpers/get_crawler_service_url';
import { parseFileCache } from '../../../lib/action_cache';
import type { ActionCtx } from '../../../_generated/server';

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
 * Get the parse endpoint path based on file extension.
 * Routes to the appropriate file-type-specific endpoint.
 */
function getParseEndpoint(filename: string): string {
  const lowerFilename = filename.toLowerCase();

  if (lowerFilename.endsWith('.pdf')) {
    return '/api/v1/pdf/parse';
  } else if (lowerFilename.endsWith('.docx')) {
    return '/api/v1/docx/parse';
  } else if (lowerFilename.endsWith('.pptx')) {
    return '/api/v1/pptx/parse';
  }

  // Default to PDF for unknown extensions
  return '/api/v1/pdf/parse';
}

/**
 * Parse a file by downloading it from a URL and sending it to the crawler service.
 * @param url - URL of the file to download
 * @param filename - Original filename with extension
 * @param toolName - Name of the calling tool (for logging)
 * @returns ParseFileResult with extracted text and metadata
 */
export async function parseFile(
  url: string,
  filename: string,
  toolName: string,
): Promise<ParseFileResult> {
  debugLog(`tool:${toolName} parse start`, {
    filename,
    url: url.substring(0, 100) + '...',
  });

  try {
    const crawlerUrl = getCrawlerServiceUrl();
    const endpointPath = getParseEndpoint(filename);
    const apiUrl = `${crawlerUrl}${endpointPath}`;

    // Download the file from the URL
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file: ${fileResponse.status} ${fileResponse.statusText}`);
    }

    const fileBlob = await fileResponse.blob();

    // Create FormData and upload to crawler service
    const formData = new FormData();
    formData.append('file', fileBlob, filename);

    debugLog(`tool:${toolName} parse uploading to crawler`, {
      filename,
      size: fileBlob.size,
      endpoint: endpointPath,
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

/**
 * Cached version of parseFile.
 * Use this when calling from actions to benefit from caching.
 * @param ctx - Action context
 * @param url - URL of the file to download
 * @param filename - Original filename with extension
 * @param toolName - Name of the calling tool (for logging)
 * @returns ParseFileResult with extracted text and metadata
 */
export async function parseFileCached(
  ctx: ActionCtx,
  url: string,
  filename: string,
  toolName: string,
): Promise<ParseFileResult> {
  return await parseFileCache.fetch(ctx, { url, filename, toolName });
}
