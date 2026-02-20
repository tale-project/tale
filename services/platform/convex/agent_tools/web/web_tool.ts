/**
 * Convex Tool: Web
 *
 * Semantic search over crawled website pages.
 * Users add websites to their knowledge base; the crawler indexes them;
 * agents search the indexed content via vector embeddings.
 */

import { createTool, type ToolCtx } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { searchPages } from './helpers/search_pages';

const webToolArgs = z.object({
  query: z.string().describe('Natural language search query'),
});

export const webTool: ToolDefinition = {
  name: 'web',
  tool: createTool({
    description: `Search crawled website pages using semantic similarity.

Searches through previously crawled and indexed website content from the organization's knowledge base.
Uses vector embeddings for semantic understanding — finds related content even without exact keyword matches.
Returns ranked results with page URL, title, and relevant content excerpts.

IMPORTANT: Always cite the source URL for every piece of information you present from the results. Never omit the URL — users need to verify and navigate to the original source.

EXAMPLES:
- { query: "shipping policy" }
- { query: "product pricing details" }
- { query: "return and refund process" }`,
    args: webToolArgs,
    handler: async (ctx: ToolCtx, args): Promise<string> => {
      return searchPages(ctx, { query: args.query });
    },
  }),
};
