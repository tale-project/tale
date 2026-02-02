/**
 * Web Assistant Tool
 *
 * Delegates web tasks to the Operator browser automation service.
 * Uses Playwright for browser control with AI-driven navigation.
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { validateToolContext } from './helpers/validate_context';
import {
  successResponse,
  errorResponse,
  handleToolError,
  type ToolResponse,
} from './helpers/tool_response';
import { getOperatorServiceUrl } from './helpers/get_operator_service_url';
import type { OperatorChatResponse } from './helpers/operator_types';

export const webAssistantTool = {
  name: 'web_assistant' as const,
  tool: createTool({
    description: `Delegate web tasks to the Operator browser automation service.

Use this tool for:
- Browsing websites and extracting content
- Interacting with web pages (clicking, filling forms)
- Taking screenshots and visual analysis
- Multi-step web automation workflows

The Operator uses Playwright for browser control with AI-driven navigation.

EXAMPLES:
- Browse: { userRequest: "Go to example.com and summarize the main content" }
- Interact: { userRequest: "Search for 'AI news' on Google and list top 5 results" }
- Extract: { userRequest: "Find the pricing information on this product page" }`,

    args: z.object({
      userRequest: z
        .string()
        .describe("The user's web-related request in natural language"),
      maxTurns: z
        .number()
        .optional()
        .describe('Max agent turns (default: 10, max: 50)'),
    }),

    handler: async (ctx: ToolCtx, args): Promise<ToolResponse> => {
      const validation = validateToolContext(ctx, 'web_assistant');
      if (!validation.valid) return validation.error;

      const operatorUrl = getOperatorServiceUrl(ctx.variables);

      console.log('[web_assistant_tool] Calling operator:', {
        url: `${operatorUrl}/api/v1/chat`,
        message: args.userRequest.slice(0, 100),
        maxTurns: args.maxTurns ?? 10,
      });

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300_000);

        const response = await fetch(`${operatorUrl}/api/v1/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: args.userRequest,
            max_turns: args.maxTurns ?? 10,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Operator service error: ${response.status} ${errorText}`,
          );
        }

        const result = (await response.json()) as OperatorChatResponse;

        if (!result.success) {
          return errorResponse(result.error || 'Operator request failed');
        }

        return successResponse(
          result.response || '',
          result.token_usage
            ? {
                inputTokens: result.token_usage.input_tokens,
                outputTokens: result.token_usage.output_tokens,
                totalTokens: result.token_usage.total_tokens,
              }
            : undefined,
          'opencode',
          'operator',
        );
      } catch (error) {
        return handleToolError('web_assistant_tool', error);
      }
    },
  }),
} as const satisfies ToolDefinition;
