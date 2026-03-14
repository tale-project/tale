/**
 * Convex Tool: Web
 *
 * Two modes:
 * 1. **URL fetch**: when the user provides a specific URL, fetch and extract
 *    its content directly (web pages, PDFs, images, DOCX, PPTX, etc.).
 * 2. **Semantic search**: when the user asks a question without a URL,
 *    search crawled website pages via vector embeddings.
 */

import { createTool, type ToolCtx } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { fetchAndExtract } from './helpers/fetch_and_extract';
import { searchPages } from './helpers/search_pages';

const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;
const FILE_EXTENSIONS = /\.(pdf|docx|pptx|png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;

function extractUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match ? match[0] : null;
}

function isFileUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return FILE_EXTENSIONS.test(path);
  } catch {
    return false;
  }
}

const webToolArgs = z.object({
  query: z
    .string()
    .describe(
      'The user request or question. Used as extraction instruction when fetching a URL, or as a semantic search query over crawled pages.',
    ),
  url: z
    .string()
    .optional()
    .describe(
      'Explicit URL to fetch and extract content from. When provided, the tool fetches and extracts the URL content directly instead of searching.',
    ),
  domain: z
    .string()
    .optional()
    .describe(
      'Optional domain to restrict search to (e.g., "docs.convex.dev"). Only applies in search mode, ignored when fetching a URL.',
    ),
});

export const webTool: ToolDefinition = {
  name: 'web',
  tool: createTool({
    description: `Search crawled website pages or fetch content from a specific URL.

**Mode 1 — Fetch URL**: When the user provides a specific URL (via the \`url\` parameter, or a URL detected in \`query\`), fetch and extract its content directly. Supports web pages, PDFs, DOCX, PPTX, and images (PNG, JPG, GIF, WebP, etc.). The \`query\` is used as the extraction instruction to guide what content to focus on.

**Mode 2 — Search**: When no URL is provided, search through previously crawled and indexed website content using semantic similarity. Returns ranked results with page URL, title, and relevant content excerpts.

IMPORTANT: Always cite the source URL for every piece of information you present from the results.

EXAMPLES:
- { url: "https://example.com/report.pdf", query: "Summarize the key findings" }
- { url: "https://example.com/pricing", query: "Extract all pricing tiers" }
- { query: "https://example.com/page" } — URL detected in query, fetches directly
- { query: "shipping policy" } — no URL, searches crawled pages
- { query: "product pricing details" }
- { query: "workflow patterns", domain: "docs.convex.dev" } — searches only docs.convex.dev`,
    args: webToolArgs,
    handler: async (ctx: ToolCtx, args): Promise<string> => {
      const targetUrl = args.url || extractUrl(args.query);

      if (targetUrl) {
        const instruction =
          args.url && isFileUrl(targetUrl) ? args.query : undefined;

        const result = await fetchAndExtract(ctx, {
          url: targetUrl,
          instruction,
        });

        if (!result.success) {
          return `Failed to fetch URL: ${result.error || 'Unknown error'}`;
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

        return `${meta}\n\n${result.content}`;
      }

      return searchPages(ctx, { query: args.query, domain: args.domain });
    },
  }),
};
