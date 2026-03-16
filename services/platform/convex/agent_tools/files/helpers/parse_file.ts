/**
 * Shared file parsing helper for PDF, DOCX, and PPTX tools.
 * Gets file from Convex storage and sends it to the crawler service for text extraction.
 * Uses ctx.storage.get() for direct Convex storage access (like image_tool and text_tool).
 */

import type { ActionCtx } from '../../../_generated/server';

import { getParseEndpoint } from '../../../../lib/shared/file-types';
import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { createDebugLog } from '../../../lib/debug_log';
import { toId } from '../../../lib/type_cast_helpers';
import { getCrawlerServiceUrl } from '../../web/helpers/get_crawler_service_url';
import { resolveFileName } from './resolve_file_name';

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
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs?: number;
    model?: string;
  };
  error?: string;
}

/**
 * Parse a file by getting it from Convex storage and sending it to the crawler service.
 * @param ctx - Action context for storage access
 * @param fileId - Convex storage ID of the file
 * @param filename - Original filename with extension (optional, resolved from fileMetadata if not provided)
 * @param toolName - Name of the calling tool (for logging)
 * @param userInput - Optional user question/instruction to guide parsing
 * @returns ParseFileResult with extracted text and metadata
 */
export async function parseFile(
  ctx: ActionCtx,
  fileId: string,
  filename: string | undefined,
  toolName: string,
  userInput?: string,
  model?: string,
): Promise<ParseFileResult> {
  const resolvedFilename = await resolveFileName(ctx, fileId, filename);

  debugLog(`tool:${toolName} parse start`, {
    fileId,
    filename: resolvedFilename,
  });

  try {
    // Get the file blob from Convex storage (like image_tool and text_tool)
    const fileBlob = await ctx.storage.get(toId<'_storage'>(fileId));
    if (!fileBlob) {
      throw new Error(`File not found in storage: ${fileId}`);
    }

    debugLog(`tool:${toolName} parse got blob`, {
      filename: resolvedFilename,
      size: fileBlob.size,
      type: fileBlob.type,
    });

    const crawlerUrl = getCrawlerServiceUrl();
    const endpointPath = getParseEndpoint(resolvedFilename);
    const apiUrl = `${crawlerUrl}${endpointPath}`;

    // Create FormData and upload to crawler service
    const formData = new FormData();
    formData.append('file', fileBlob, resolvedFilename);
    if (userInput) {
      formData.append('user_input', userInput);
    }
    if (model) {
      formData.append('model', model);
    }

    debugLog(`tool:${toolName} parse uploading to crawler`, {
      filename: resolvedFilename,
      size: fileBlob.size,
      endpoint: endpointPath,
      hasUserInput: !!userInput,
      model: model ?? null,
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

    interface RawCrawlerUsage {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      duration_ms?: number;
      model?: string;
    }

    const raw = await fetchJson<ParseFileResult & { usage?: RawCrawlerUsage }>(
      response,
    );

    // Remap snake_case usage from crawler to camelCase
    const result: ParseFileResult = { ...raw };
    if (raw.usage) {
      result.usage = {
        inputTokens: raw.usage.input_tokens ?? 0,
        outputTokens: raw.usage.output_tokens ?? 0,
        totalTokens: raw.usage.total_tokens ?? 0,
        durationMs: raw.usage.duration_ms,
        model: raw.usage.model,
      };
    }

    debugLog(`tool:${toolName} parse success`, {
      filename: result.filename,
      success: result.success,
      textLength: result.full_text?.length ?? 0,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[tool:${toolName} parse] error`, {
      filename: resolvedFilename,
      error: message,
    });
    return {
      success: false,
      filename: resolvedFilename,
      error: message,
    };
  }
}
