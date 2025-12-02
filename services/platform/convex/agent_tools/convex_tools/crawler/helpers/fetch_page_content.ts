/**
 * Helper: Fetch Page Content
 *
 * Fetches and extracts content from a web URL using the crawler service.
 */

import { getCrawlerServiceUrl } from './get_crawler_service_url';
import { type FetchUrlsApiResponse, type WebReadFetchUrlResult } from './types';

import { createDebugLog } from '../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CRAWLER', '[Crawler]');

// Convex imposes a 1 MiB per-value limit. Some pages can be very large and would
// cause tool result messages to exceed this limit when stored by @convex-dev/agent.
// Truncate the extracted page content to keep each message comfortably below
// the limit while still providing rich context for the model.
const MAX_CONTENT_CHARS = 100_000;

export async function fetchPageContent(
  ctx: unknown,
  args: { url: string; word_count_threshold?: number },
): Promise<WebReadFetchUrlResult> {
  const variables = (ctx as { variables?: Record<string, unknown> }).variables;
  const crawlerServiceUrl = getCrawlerServiceUrl(variables);

  debugLog('tool:web_read:fetch_url start', {
    url: args.url,
    crawlerServiceUrl,
  });

  const apiUrl = `${crawlerServiceUrl}/api/v1/fetch-urls`;

  const payload = {
    urls: [args.url],
    word_count_threshold: args.word_count_threshold ?? 50,
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
    });

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
    };
  } catch (error) {
    console.error('[tool:web_read:fetch_url] error', {
      url: args.url,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
