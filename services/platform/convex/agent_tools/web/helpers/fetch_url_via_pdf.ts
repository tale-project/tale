/**
 * Helper: fetchUrlViaPdf
 *
 * Fetches a URL's content using the PDF extraction pipeline:
 * URL -> PDF (Playwright) -> Extract (Vision API)
 */

import type { ToolCtx } from '@convex-dev/agent';

import type { WebFetchUrlResult, WebFetchExtractApiResponse } from './types';

import { createDebugLog } from '../../../lib/debug_log';
import { getCrawlerServiceUrl } from './get_crawler_service_url';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const MAX_CONTENT_LENGTH = 100_000;

export async function fetchUrlViaPdf(
  ctx: ToolCtx,
  args: {
    url: string;
    instruction?: string;
  },
): Promise<WebFetchUrlResult> {
  const crawlerServiceUrl = getCrawlerServiceUrl(ctx.variables);
  const apiUrl = `${crawlerServiceUrl}/api/v1/web/fetch-and-extract`;

  debugLog('tool:web:fetch_url start', {
    url: args.url,
    hasInstruction: !!args.instruction,
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: args.url,
        instruction: args.instruction,
        timeout: 60000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Crawler service error: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as WebFetchExtractApiResponse;

    if (!result.success) {
      debugLog('tool:web:fetch_url failed', {
        url: args.url,
        error: result.error,
      });
      return {
        operation: 'fetch_url',
        success: false,
        url: args.url,
        content: '',
        word_count: 0,
        page_count: 0,
        vision_used: false,
        error: result.error || 'Failed to fetch and extract content',
      };
    }

    let content = result.content || '';
    const truncated = content.length > MAX_CONTENT_LENGTH;
    if (truncated) {
      content = content.slice(0, MAX_CONTENT_LENGTH);
    }

    debugLog('tool:web:fetch_url success', {
      url: args.url,
      wordCount: result.word_count,
      pageCount: result.page_count,
      visionUsed: result.vision_used,
      truncated,
    });

    return {
      operation: 'fetch_url',
      success: true,
      url: args.url,
      title: result.title,
      content,
      word_count: result.word_count,
      page_count: result.page_count,
      vision_used: result.vision_used,
      truncated,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[tool:web:fetch_url] error', {
      url: args.url,
      error: errorMessage,
    });
    return {
      operation: 'fetch_url',
      success: false,
      url: args.url,
      content: '',
      word_count: 0,
      page_count: 0,
      vision_used: false,
      error: errorMessage,
    };
  }
}
