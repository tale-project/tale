/**
 * Web Assistant Tool
 *
 * Delegates web-related tasks to the specialized Web Assistant Agent.
 * Isolates large web page content from the main chat agent's context.
 *
 * Uses the shared context management module for:
 * - Structured prompt building
 * - Smart history filtering via contextHandler
 * - Token-aware context management
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { createWebAgent } from '../../lib/create_web_agent';
import { getOrCreateSubThread } from './helpers/get_or_create_sub_thread';
import { buildSubAgentPrompt } from './helpers/build_sub_agent_prompt';
import { createContextHandler, AGENT_CONTEXT_CONFIGS } from '../../lib/context_management';

export const webAssistantTool = {
  name: 'web_assistant' as const,
  tool: createTool({
    description: `Delegate web-related tasks to the specialized Web Assistant Agent.

Use this tool for ANY web-related request, including:
- Searching the web for information
- Fetching content from URLs
- Extracting and summarizing web page content
- Looking up real-world data (weather, prices, news, etc.)

The Web Assistant is specialized in:
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

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      response: string;
      error?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
    }> => {
      const { organizationId, threadId, userId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          response: '',
          error: 'organizationId is required',
        };
      }

      // Sub-thread creation requires a parent threadId to link to
      if (!threadId) {
        return {
          success: false,
          response: '',
          error: 'threadId is required for web_assistant to create sub-threads',
        };
      }

      try {
        const webAgent = createWebAgent();

        // Get or create a sub-thread for this parent thread + sub-agent combination
        // Reusing the thread allows the sub-agent to maintain context across calls
        const { threadId: subThreadId, isNew } = await getOrCreateSubThread(
          ctx,
          {
            parentThreadId: threadId,
            subAgentType: 'web_assistant',
            userId,
          },
        );

        console.log('[web_assistant_tool] Sub-thread:', subThreadId, isNew ? '(new)' : '(reused)');

        // Build structured prompt using the shared context management module
        const additionalContext: Record<string, string> = {};
        if (args.url) {
          additionalContext.target_url = args.url;
        }
        if (args.searchQuery) {
          additionalContext.search_query = args.searchQuery;
        }

        const promptResult = buildSubAgentPrompt({
          userRequest: args.userRequest,
          agentType: 'web',
          threadId: subThreadId,
          organizationId,
          userId,
          parentThreadId: threadId,
          additionalContext,
        });

        console.log('[web_assistant_tool] Calling webAgent.generateText', {
          estimatedTokens: promptResult.estimatedTokens,
        });

        // Create context handler with web agent configuration
        const webConfig = AGENT_CONTEXT_CONFIGS.web;
        const contextHandler = createContextHandler({
          modelContextLimit: webConfig.modelContextLimit,
          outputReserve: webConfig.outputReserve,
          minRecentMessages: Math.min(4, webConfig.recentMessages),
        });

        const generationStartTime = Date.now();
        const result = await webAgent.generateText(
          ctx,
          { threadId: subThreadId, userId },
          {
            prompt: promptResult.prompt,
            messages: promptResult.systemMessages,
          },
          {
            contextOptions: {
              recentMessages: webConfig.recentMessages,
              excludeToolMessages: false,
            },
            contextHandler,
          },
        );
        const generationDurationMs = Date.now() - generationStartTime;

        console.log('[web_assistant_tool] Result:', {
          durationMs: generationDurationMs,
          textLength: result.text?.length ?? 0,
          finishReason: result.finishReason,
          stepsCount: result.steps?.length ?? 0,
        });

        return {
          success: true,
          response: result.text,
          usage: result.usage,
        };
      } catch (error) {
        console.error('[web_assistant_tool] Error:', error);
        return {
          success: false,
          response: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
