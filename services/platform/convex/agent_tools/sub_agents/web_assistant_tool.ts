/**
 * Web Assistant Tool
 *
 * Delegates web tasks to the specialized Web Agent.
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
  url: 'url',
} as const;

export const webAssistantTool = {
  name: 'web_assistant' as const,
  tool: createTool({
    description: `Delegate web tasks to the specialized Web Agent.

Use this tool for:
- Fetching and extracting content from URLs
- Browsing websites and web pages
- Searching the web for information
- Multi-step web interactions and automation

The Web Agent has access to:
- fetch_url: Extract content from URLs (URL → PDF → Vision API extraction)
- browser_operate: AI-driven browser automation for searching and interactions

EXAMPLES:
- Fetch URL: { userRequest: "Get the content from https://example.com" }
- Search: { userRequest: "Search for the latest news about AI" }
- Extract: { userRequest: "Find the pricing information from this page", url: "https://example.com/pricing" }
- Browse: { userRequest: "Go to GitHub and find trending repositories" }`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's web-related request in natural language"),
      url: z
        .string()
        .optional()
        .describe('Target URL if fetching a specific page'),
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

        const result = await ctx.runAction(
          getWebAgentGenerateResponseRef(),
          {
            threadId: subThreadId,
            userId,
            organizationId,
            promptMessage: args.userRequest,
            additionalContext: buildAdditionalContext(args, WEB_CONTEXT_MAPPING),
            parentThreadId: threadId,
          },
        );

        return successResponse(
          result.text,
          {
            ...result.usage,
            durationSeconds:
              result.durationMs !== undefined
                ? result.durationMs / 1000
                : undefined,
          },
          result.model,
          result.provider,
          undefined,
          args.userRequest,
        );
      } catch (error) {
        return handleToolError('web_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
