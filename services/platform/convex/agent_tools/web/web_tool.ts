/**
 * Convex Tool: Web
 *
 * Two modes (discriminated union on `mode`):
 * 1. **fetch**: when the user provides a specific URL, fetch and extract
 *    its content directly (web pages, PDFs, images, DOCX, PPTX, etc.).
 *    Works with any public URL.
 * 2. **search**: search crawled website pages via semantic similarity.
 *    Only covers websites added to the organization's knowledge base.
 */

import { createTool, type ToolCtx } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import { fetchAndExtract } from './helpers/fetch_and_extract';
import { searchPages } from './helpers/search_pages';

const FILE_EXTENSIONS = /\.(pdf|docx|pptx|png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;

function isFileUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return FILE_EXTENSIONS.test(path);
  } catch {
    return false;
  }
}

const webToolArgs = z.discriminatedUnion('mode', [
  z.object({
    mode: z
      .literal('fetch')
      .describe(
        'Fetch and extract content from a specific URL. Works with any public URL.',
      ),
    url: z
      .string()
      .describe(
        'The URL to fetch (web page, PDF, DOCX, PPTX, or image such as PNG, JPG, GIF, WebP, etc.)',
      ),
    query: z
      .string()
      .optional()
      .describe(
        'Optional extraction instruction to guide what content to focus on.',
      ),
  }),
  z.object({
    mode: z
      .literal('search')
      .describe(
        'Search through websites added to the knowledge base using semantic similarity.',
      ),
    query: z.string().describe('The search query.'),
    domain: z
      .string()
      .optional()
      .describe(
        'Optional domain to restrict search to (e.g., "docs.convex.dev").',
      ),
  }),
]);

export const webTool: ToolDefinition = {
  name: 'web',
  tool: createTool({
    description: `Access web content in two modes:

**fetch**: Fetch and extract content from any public URL. Supports web pages, PDFs, DOCX, PPTX, and images (PNG, JPG, GIF, WebP, etc.). Use the \`query\` parameter as an extraction instruction to guide what content to focus on.

**search**: Search through websites that have been added to the organization's knowledge base. Only content from indexed knowledge base websites is searchable — this does NOT search the open internet. If the website you need isn't indexed, use fetch mode with a direct URL instead, or suggest the user add the website to their knowledge base.

IMPORTANT: Always cite the source URL for every piece of information you present from the results.

EXAMPLES:
- { mode: "fetch", url: "https://example.com/report.pdf", query: "Summarize the key findings" }
- { mode: "fetch", url: "https://example.com/pricing" }
- { mode: "search", query: "shipping policy" }
- { mode: "search", query: "workflow patterns", domain: "docs.convex.dev" }`,
    inputSchema: webToolArgs,
    execute: async (ctx: ToolCtx, args) => {
      if (args.mode === 'fetch') {
        const instruction = isFileUrl(args.url) ? args.query : undefined;

        const result = await fetchAndExtract(ctx, {
          url: args.url,
          instruction,
        });

        if (!result.success) {
          return {
            success: false,
            response: `Failed to fetch URL: ${result.error || 'Unknown error'}`,
          };
        }

        const meta = [
          result.title ? `Title: ${result.title}` : null,
          `URL: ${result.url}`,
          `Words: ${result.word_count}`,
          result.page_count ? `Pages: ${result.page_count}` : null,
          result.vision_used ? 'Vision: used for extraction' : null,
          result.truncated ? '(content truncated)' : null,
        ]
          .filter(Boolean)
          .join(' | ');

        const citationHeader = `[1] (Relevance: 100.0%) [Source: ${result.title ?? result.url}] [URL: ${result.url}]`;
        const responseText = `${citationHeader}\n${meta}\n\n${result.content}`;

        const citations = [
          {
            index: 1,
            type: 'web' as const,
            source: result.title ?? result.url,
            url: result.url,
            relevance: 1,
          },
        ];

        return {
          success: true,
          response: responseText,
          citations,
          ...(result.usage && {
            usage: {
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens,
              totalTokens: result.usage.total_tokens,
            },
            model: result.usage.model,
          }),
        };
      }

      // mode === 'search'
      const { text: searchResult, citations } = await searchPages(ctx, {
        query: args.query,
        domain: args.domain,
      });
      return { success: true, response: searchResult, citations };
    },
  }),
};
