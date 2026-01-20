/**
 * Helper: Fetch Page Content
 *
 * Fetches and extracts content from a web URL using the crawler service.
 */

import { getCrawlerServiceUrl } from './get_crawler_service_url';
import { type FetchUrlsApiResponse, type WebReadFetchUrlResult } from './types';
import type { ToolCtx } from '@convex-dev/agent';
import { internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

// Convex imposes a 1 MiB per-value limit. Some pages can be very large and would
// cause tool result messages to exceed this limit when stored by @convex-dev/agent.
// Truncate the extracted page content to keep each message comfortably below
// the limit while still providing rich context for the model.
const MAX_CONTENT_CHARS = 100_000;

export async function fetchPageContent(
  ctx: ToolCtx,
  args: { url: string; word_count_threshold?: number },
): Promise<WebReadFetchUrlResult> {
  const { variables, organizationId } = ctx;
  const crawlerServiceUrl = getCrawlerServiceUrl(variables);

  debugLog('tool:web_read:fetch_url start', {
    url: args.url,
    crawlerServiceUrl,
  });

  // Try cache first when organizationId is available.
  if (organizationId) {
    try {
      // @ts-ignore TS2589: Convex API type instantiation is excessively deep
      const cachedPage = (await ctx.runQuery(internal.websites.queries.getWebsitePageByUrlInternal, { organizationId, url: args.url })) as Doc<'websitePages'> | null;

      if (cachedPage && cachedPage.content) {
        const rawContent = cachedPage.content ?? '';
        const wasTruncated = rawContent.length > MAX_CONTENT_CHARS;
        const content = wasTruncated
          ? rawContent.slice(0, MAX_CONTENT_CHARS)
          : rawContent;

        debugLog('tool:web_read:fetch_url cache_hit', {
          url: args.url,
          organizationId,
          title: cachedPage.title,
          word_count: cachedPage.wordCount,
          truncated: wasTruncated,
          content_length: rawContent.length,
          has_structured_data: !!cachedPage.structuredData,
        });

        return {
          operation: 'fetch_url',
          success: true,
          url: cachedPage.url,
          title: cachedPage.title ?? undefined,
          content,
          word_count: cachedPage.wordCount ?? 0,
          metadata: {
            ...(cachedPage.metadata ?? {}),
            truncated: wasTruncated,
            original_content_length: rawContent.length,
          },
          structured_data: cachedPage.structuredData ?? undefined,
        };
      }

      debugLog('tool:web_read:fetch_url cache_miss', {
        url: args.url,
        organizationId,
      });
    } catch (error) {
      debugLog('tool:web_read:fetch_url cache_error', {
        url: args.url,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const apiUrl = `${crawlerServiceUrl}/api/v1/urls/fetch`;

  const payload = {
    urls: [args.url],
    // Low threshold for single URL fetches - user explicitly requested this page
    word_count_threshold: args.word_count_threshold ?? 0,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Crawler service error: ${response.status} ${errorText}`);
    }

    const result = (await response.json()) as FetchUrlsApiResponse;

    if (!result.success) {
      throw new Error(`Crawler service returned failure for URL: ${args.url}`);
    }

    if (result.pages.length === 0) {
      throw new Error(
        `No content extracted from URL: ${args.url}. The page may be empty, blocked, or have insufficient text content.`,
      );
    }

    const page = result.pages[0];

    const rawContent = page.content ?? '';
    const wasTruncated = rawContent.length > MAX_CONTENT_CHARS;
    const content = wasTruncated
      ? rawContent.slice(0, MAX_CONTENT_CHARS)
      : rawContent;

    debugLog('tool:web_read:fetch_url success', {
      url: args.url,
      title: page.title,
      word_count: page.word_count,
      truncated: wasTruncated,
      content_length: rawContent.length,
      has_structured_data: !!page.structured_data,
    });

    // Return both structured_data (OpenGraph, JSON-LD) and content.
    // structured_data contains machine-readable product info including variant prices.
    // content is fallback for pages without structured data.
    return {
      operation: 'fetch_url',
      success: true,
      url: page.url,
      title: page.title,
      content,
      word_count: page.word_count,
      metadata: {
        ...(page.metadata ?? {}),
        truncated: wasTruncated,
        original_content_length: rawContent.length,
      },
      structured_data: page.structured_data,
    };
  } catch (error) {
    console.error('[tool:web_read:fetch_url] error', {
      url: args.url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
