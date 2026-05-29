/**
 * Helper: fetchAndExtract
 *
 * Fetches a URL's content and extracts text using the crawler service.
 * Supports web pages, documents (PDF, DOCX, PPTX), and images (PNG, JPG, etc.).
 */

import type { ToolCtx } from '@convex-dev/agent';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { createDebugLog } from '../../../lib/debug_log';
import { UpstreamHttpError } from '../../../lib/errors/upstream_http_error';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import { getCrawlerServiceUrl } from './get_crawler_service_url';
import type { WebFetchUrlResult, WebFetchExtractApiResponse } from './types';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const MAX_CONTENT_LENGTH = 100_000;

export async function fetchAndExtract(
  ctx: ToolCtx,
  args: {
    url: string;
    instruction?: string;
  },
): Promise<WebFetchUrlResult> {
  const crawlerServiceUrl = getCrawlerServiceUrl(ctx.variables);
  const apiUrl = `${crawlerServiceUrl}/api/v1/web/fetch-and-extract`;

  if (!ctx.organizationId) {
    throw new Error('fetch_and_extract requires organizationId in ToolCtx.');
  }

  debugLog('tool:web:fetch_and_extract start', {
    url: args.url,
    hasInstruction: !!args.instruction,
  });

  try {
    // Resolve the slug INSIDE the try so a lookup failure folds into
    // the same `{ success: false, error }` shape every other failure
    // path returns. Earlier this happened outside the try, which
    // threw raw Error past the tool's contract.
    const orgSlug = await orgSlugFromId(ctx, ctx.organizationId);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tale-org': orgSlug,
      },
      body: JSON.stringify({
        url: args.url,
        instruction: args.instruction,
        timeout: 60000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw UpstreamHttpError.fromResponse(
        'crawler',
        response,
        errorText,
        '/api/v1/web/fetch-and-extract',
      );
    }

    const result = await fetchJson<WebFetchExtractApiResponse>(response);

    if (!result.success) {
      debugLog('tool:web:fetch_and_extract failed', {
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

    debugLog('tool:web:fetch_and_extract success', {
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
      usage: result.usage,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[tool:web:fetch_and_extract] error', {
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
