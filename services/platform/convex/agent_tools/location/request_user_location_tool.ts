/**
 * Convex Tool: Request User Location
 *
 * Allows the AI to request the user's geographic location on demand.
 * Creates an approval card that prompts the user to share their browser location.
 * Only a city-level address is returned — raw coordinates are never sent to the LLM.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

const requestUserLocationArgs = z.object({
  reason: z
    .string()
    .min(5)
    .describe(
      'A user-facing sentence explaining why you need their location. This text is shown directly on the approval card. Write a complete, natural sentence in the user\'s language. Examples: "为您查找附近的餐厅推荐", "To find nearby restaurants for you", "To show local weather in your area".',
    ),
});

export const requestUserLocationTool = {
  name: 'request_user_location' as const,
  tool: createTool({
    description: `**DIRECTLY call this tool** to request the user's geographic location.

**WHEN TO USE:**
• When you need to know where the user is located (e.g., weather, nearby places, local time, regional recommendations)
• When the user asks a location-dependent question but hasn't provided their location

**HOW IT WORKS:**
• An approval card appears asking the user to share their browser location
• The user can approve (shares city-level location) or deny
• You will receive a city-level address (e.g., "Hangzhou, Zhejiang, China") — never raw coordinates
• If denied, you will be informed and should proceed without location data

**AFTER CALLING - CRITICAL:**
• You MUST STOP and produce your final response immediately
• Do NOT call any more tools or continue with any operation
• Do NOT assume or guess the user's location
• The user's response will appear in a FUTURE turn as <location_response>
• Simply acknowledge you're waiting for their location`,
    inputSchema: requestUserLocationArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      requestId?: string;
      requestCreated?: boolean;
      waitingForUser?: boolean;
      message: string;
    }> => {
      const { organizationId, threadId: currentThreadId } = ctx;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workflow context fields spread onto ctx at runtime via execute_agent_with_tools.ts
      const ctxRecord = ctx as unknown as Record<string, unknown>;
      const wfExecutionId =
        typeof ctxRecord.wfExecutionId === 'string'
          ? ctxRecord.wfExecutionId
          : undefined;
      const stepSlug =
        typeof ctxRecord.stepSlug === 'string' ? ctxRecord.stepSlug : undefined;

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to request user location.',
        };
      }

      if (!threadId) {
        return {
          success: false,
          message: 'threadId is required to request user location.',
        };
      }

      try {
        const requestId = await ctx.runMutation(
          internal.agent_tools.location.internal_mutations
            .createLocationRequest,
          {
            organizationId,
            threadId,
            reason: args.reason,
            wfExecutionId,
            stepSlug,
          },
        );

        return {
          success: true,
          requestId,
          requestCreated: true,
          waitingForUser: true,
          message: `STOP - WAITING FOR USER LOCATION

A location request card (ID: ${requestId}) has been created and is now displayed to the user.

CRITICAL: You MUST stop here and produce your final response now. Do NOT:
- Call any more tools
- Make assumptions about the user's location
- Generate a fake <location_response>
- Continue with any operation

The user's actual response will appear in a FUTURE conversation turn as <location_response id="${requestId}">. You will NOT see it in this turn.

Your response now should acknowledge that you're waiting for the user to share their location.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create location request: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
