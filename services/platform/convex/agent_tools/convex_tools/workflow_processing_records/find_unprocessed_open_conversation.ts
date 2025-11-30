/**
 * Convex Tool: Find Unprocessed Open Conversation
 *
 * Find open conversations that haven't been processed by a specific workflow
 * within a given time window, where the latest message is inbound.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

export const findUnprocessedOpenConversationTool = {
  name: 'find_unprocessed_open_conversation',
  tool: createTool({
    description: `Find open conversations that haven't been processed by a specific workflow within a time window.

This tool searches for conversations where:
1. Status is 'open'
2. Latest message direction is 'inbound' (customer sent the last message)
3. The conversation hasn't been processed by the specified workflow, OR
4. The conversation was last processed more than daysBack days ago

Returns exactly one conversation.

IMPORTANT - RETURNED CONVERSATION STRUCTURE:
Each conversation object contains:
- **_id**: The Convex conversation ID (e.g., "jh7abc123...") - USE THIS for all operations
- **customerId**: The customer ID associated with this conversation
- **externalMessageId**: The external message ID that created this conversation (e.g., email messageId)
- **subject**: The conversation subject/title
- **status**: Current status ('open', 'closed', 'spam', 'archived')
- **priority**: Priority level if set
- **type**: Type if set (e.g., 'product-recommendation', 'service-request', 'churn-survey')
- **channel**: Communication channel (e.g., 'email', 'sms')
- **direction**: Direction of the conversation ('inbound' or 'outbound')
- **metadata**: Additional conversation data

USE CASE:
This tool is ideal for finding customer conversations that need attention or response.
For example, finding open email conversations where the customer sent the last message
and no agent has responded yet.`,
    args: z.object({
      workflowId: z
        .string()
        .describe(
          'Workflow ID to check (e.g., "respond-to-customer"). Used to track which conversations have been processed.',
        ),
      hoursBack: z
        .number()
        .min(1)
        .max(8760)
        .default(72)
        .describe(
          'Number of hours to look back. Conversations processed within this window will be excluded.',
        ),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      conversations: unknown[];
      count: number;
      searchCriteria: {
        workflowId: string;
        hoursBack: number;
      };
    }> => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Get organizationId from context
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error(
          'organizationId is required in context for find_unprocessed_open_conversation',
        );
      }

      console.log(
        '[find_unprocessed_open_conversation] Searching for conversations',
        {
          workflowId: args.workflowId,
          hoursBack: args.hoursBack,
          organizationId,
        },
      );

      // Query for unprocessed open conversations using the specialized function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const findUnprocessedOpenConversationRef =
        internal.workflow_processing_records.findUnprocessedOpenConversation;
      const result = (await actionCtx.runQuery(
        findUnprocessedOpenConversationRef,
        {
          organizationId,
          workflowId: args.workflowId,
          backoffHours: args.hoursBack,
        },
      )) as { conversations: unknown[]; count: number };

      console.log('[find_unprocessed_open_conversation] Search completed', {
        conversationsFound: result.count,
        workflowId: args.workflowId,
      });

      return {
        conversations: result.conversations,
        count: result.count,
        searchCriteria: {
          workflowId: args.workflowId,
          hoursBack: args.hoursBack,
        },
      };
    },
  }),
} as const satisfies ToolDefinition;
