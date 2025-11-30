/**
 * Convex Tool: Fetch URL
 *
 * Fetch and extract content from a web URL using the crawler service.
 * Use this when a user provides a link and wants to know what's on the page.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

interface PageContent {
  url: string;
  title?: string;
  content: string;
  word_count: number;
  metadata?: Record<string, unknown>;
  structured_data?: Record<string, unknown>;
}

interface FetchUrlResponse {
  success: boolean;
  url: string;
  title?: string;
  content: string;
  word_count: number;
  metadata?: Record<string, unknown>;
}

interface FetchUrlsApiResponse {
  success: boolean;
  urls_requested: number;
  urls_fetched: number;
  pages: PageContent[];
}

// Convex imposes a 1 MiB per-value limit. Some pages can be very large and would
// cause tool result messages to exceed this limit when stored by @convex-dev/agent.
// Truncate the extracted page content to keep each message comfortably below
// the limit while still providing rich context for the model.
const MAX_CONTENT_CHARS = 100_000;

/**
 * Get crawler service URL from environment or variables
 */
function getCrawlerServiceUrl(variables?: Record<string, unknown>): string {
  const url =
    (variables?.crawlerServiceUrl as string) ||
    process.env.CRAWLER_URL ||
    'http://localhost:8002';

  return url;
}

export const fetchUrlTool = {
  name: 'fetch_url' as const,
  tool: createTool({
    description: `Fetch and extract content from a normal web URL (HTML pages only).
Use this tool when a user provides a public web page (article, documentation page, blog post, etc.) and wants to know what's on that page.
Returns the page title, main content text, and word count.
This is useful for summarizing articles, extracting information from web pages, or answering questions about linked content.

IMPORTANT LIMITATIONS:
- This tool CANNOT read PDF files, Excel files, Word documents, or other binary file formats.
- For URLs ending in .pdf, .xlsx, .docx, or other document formats, this tool will fail to extract meaningful content.
- If a user asks about a file that was generated during this conversation thread (e.g., a PDF or Excel file you just created), use the "context_search" tool to find the original raw content from the thread messages.
- For documents previously uploaded to the knowledge base, use the "rag_search" tool to find the content.`,
    args: z.object({
      url: z
        .string()
        .describe(
          'The URL to fetch content from (must be a valid http/https URL)',
        ),
      word_count_threshold: z
        .number()
        .optional()
        .describe(
          'Minimum word count for content extraction (default: 50). Lower values capture more content.',
        ),
    }),
    handler: async (ctx, args): Promise<FetchUrlResponse> => {
      // Get variables from context (injected by agent caller)
      const variables = (
        ctx as unknown as { variables?: Record<string, unknown> }
      ).variables;

      const crawlerServiceUrl = getCrawlerServiceUrl(variables);

      console.log('[tool:fetch_url] start', {
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
          throw new Error(
            `Crawler service error: ${response.status} ${errorText}`,
          );
        }

        const result = (await response.json()) as FetchUrlsApiResponse;

        if (!result.success) {
          throw new Error(
            `Crawler service returned failure for URL: ${args.url}`,
          );
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

        console.log('[tool:fetch_url] success', {
          url: args.url,
          title: page.title,
          word_count: page.word_count,
          truncated: wasTruncated,
          content_length: rawContent.length,
        });

        return {
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
        console.error('[tool:fetch_url] error', {
          url: args.url,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
