/**
 * Web Assistant Tool
 *
 * Delegates web-related tasks to the specialized Web Agent.
 * This tool is a thin wrapper that creates sub-threads and calls the agent.
 * All context management is handled by the agent itself.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { validateToolContext } from './helpers/validate_context';
import { buildAdditionalContext } from './helpers/build_additional_context';
import {
  successResponse,
  handleToolError,
  type ToolResponse,
} from './helpers/tool_response';
import { getWebAgentGenerateResponseRef } from '../../lib/function_refs';

const WEB_CONTEXT_MAPPING = {
  url: 'target_url',
  searchQuery: 'search_query',
} as const;

export const webAssistantTool = {
  name: 'web_assistant' as const,
  tool: createTool({
    description: `Delegate web-related tasks to the specialized Web Agent.

Use this tool for ANY web-related request, including:
- Searching the web for information
- Fetching content from URLs
- Extracting and summarizing web page content
- Looking up real-world data (weather, prices, news, etc.)

The Web Agent is specialized in:
- Web search using SearXNG meta search engine
- URL content extraction with intelligent parsing
- Handling the search → fetch → summarize workflow

Simply describe what information you need from the web.

EXAMPLES:
• Search: { userRequest: "Find the latest React 19 features", searchQuery: "React 19 new features 2024" }
• Fetch URL: { userRequest: "Summarize this article", url: "https://example.com/article" }
• Research: { userRequest: "What's the current weather in Zurich?" }`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's web-related request in natural language"),
      url: z
        .string()
        .optional()
        .describe('Specific URL to fetch content from (if known)'),
      searchQuery: z
        .string()
        .optional()
        .describe('Search query to use (if searching)'),
    }),

    handler: async (ctx: ToolCtx, args): Promise<ToolResponse> => {
      const validation = validateToolContext(ctx, 'web_assistant');
      if (!validation.valid) return validation.error;

      const { organizationId, threadId, userId } = validation.context;

      try {
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'web_assistant',
            userId,
          },
        );

        console.log(
          '[web_assistant_tool] Sub-thread:',
          subThreadId,
          isNew ? '(new)' : '(reused)',
        );

        const result = await ctx.runAction(getWebAgentGenerateResponseRef(), {
          threadId: subThreadId,
          userId,
          organizationId,
          taskDescription: args.userRequest,
          additionalContext: buildAdditionalContext(args, WEB_CONTEXT_MAPPING),
          parentThreadId: threadId,
        });

        return successResponse(result.text, result.usage);
      } catch (error) {
        return handleToolError('web_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
