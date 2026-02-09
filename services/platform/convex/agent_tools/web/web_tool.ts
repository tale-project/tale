/**
 * Convex Tool: Web
 *
 * Unified web operations for agents.
 * Supports:
 * - operation = 'fetch_url': fetch content from URL via PDF extraction pipeline
 * - operation = 'browser_operate': browser automation via operator service
 */

import { createTool, type ToolCtx } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import type {
  WebFetchUrlResult,
  WebBrowserOperateResult,
} from './helpers/types';

import { browserOperate } from './helpers/browser_operate';
import { fetchUrlViaPdf } from './helpers/fetch_url_via_pdf';

const webToolArgs = z.object({
  operation: z
    .enum(['fetch_url', 'browser_operate'])
    .describe("Operation: 'fetch_url' or 'browser_operate'"),
  url: z
    .string()
    .optional()
    .describe("Required for 'fetch_url': The URL to fetch content from"),
  instruction: z
    .string()
    .optional()
    .describe(
      "For 'fetch_url': Optional AI instruction for extraction. For 'browser_operate': Required browser automation instruction",
    ),
});

export const webTool: ToolDefinition = {
  name: 'web',
  tool: createTool({
    description: `Web content tool with two operations:

1. fetch_url - Fetch and extract content from a URL
   Pipeline: URL -> PDF (Playwright) -> Extract (Vision API)
   - url: Required, the URL to fetch
   - instruction: Optional AI instruction (e.g., "extract pricing info")
   Returns: page content, word count, page count, vision_used flag

2. browser_operate - AI-driven browser automation via Operator service
   - instruction: Required, natural language instruction for browser automation
   Use for: searching the web, filling forms, multi-step interactions
   Example: { operation: "browser_operate", instruction: "Search Google for React 19 features" }

EXAMPLES:
- Fetch URL: { operation: "fetch_url", url: "https://example.com/article" }
- With instruction: { operation: "fetch_url", url: "https://example.com/pricing", instruction: "extract pricing tiers" }
- Browser search: { operation: "browser_operate", instruction: "Search for latest AI news on Google" }
- Browser interact: { operation: "browser_operate", instruction: "Go to github.com and find the React repository" }`,
    args: webToolArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<WebFetchUrlResult | WebBrowserOperateResult> => {
      if (args.operation === 'fetch_url') {
        if (!args.url) {
          throw new Error("Missing required 'url' for fetch_url operation");
        }
        return fetchUrlViaPdf(ctx, {
          url: args.url,
          instruction: args.instruction,
        });
      }

      // operation === 'browser_operate'
      if (!args.instruction) {
        throw new Error(
          "Missing required 'instruction' for browser_operate operation",
        );
      }
      return browserOperate(ctx, {
        instruction: args.instruction,
      });
    },
  }),
};
