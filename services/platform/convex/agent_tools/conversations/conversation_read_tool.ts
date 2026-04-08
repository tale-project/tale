/**
 * Convex Tool: Conversation Read
 *
 * Unified read-only conversation operations for agents.
 * Supports:
 * - operation = 'get_by_id': fetch a single conversation by conversationId
 * - operation = 'list': list conversations with optional filters (status, customerId)
 * - operation = 'get_messages': read messages from a specific conversation
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import { readConversationById } from './helpers/read_conversation_by_id';
import { readConversationList } from './helpers/read_conversation_list';
import { readConversationMessages } from './helpers/read_conversation_messages';
import type {
  ConversationReadGetByIdResult,
  ConversationReadListResult,
  ConversationReadMessagesResult,
} from './helpers/types';

const conversationReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_by_id'),
    conversationId: z
      .string()
      .describe(
        'Convex Id<"conversations"> (string format) for the target conversation',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to return. Default: ['_id','subject','status','priority','channel','direction','customerId','lastMessageAt']",
      ),
  }),
  z.object({
    operation: z.literal('list'),
    status: z
      .enum(['open', 'closed', 'spam', 'archived'])
      .optional()
      .describe('Filter by conversation status'),
    customerId: z
      .string()
      .optional()
      .describe('Filter by customer ID (Convex Id<"customers"> string format)'),
    cursor: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Pagination cursor from previous response, or null/omitted for first page',
      ),
    numItems: z
      .number()
      .optional()
      .describe('Number of items per page (default: 50)'),
  }),
  z.object({
    operation: z.literal('get_messages'),
    conversationId: z
      .string()
      .describe(
        'Convex Id<"conversations"> for the conversation to read messages from',
      ),
    cursor: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Pagination cursor from previous response, or null/omitted for first page',
      ),
    numItems: z
      .number()
      .optional()
      .describe('Number of messages per page (default: 100)'),
  }),
]);

export const conversationReadTool: ToolDefinition = {
  name: 'conversation_read',
  tool: createTool({
    description: `Customer conversation read tool for accessing conversation data and message history.

SCOPE LIMITATION:
This tool accesses the internal conversations database (inbound/outbound customer conversations).
It does NOT access the agent's own chat thread — use this to look up customer support conversations.

OPERATIONS:
• 'get_by_id': Fetch a single conversation by its Convex ID. Returns conversation metadata.
• 'list': Browse conversations for the organization. Supports filters: status (open/closed/spam/archived), customerId.
  Use pagination (cursor) for large result sets.
• 'get_messages': Read messages from a specific conversation. Returns message content, sender direction, timestamps, and delivery state.
  Use pagination (cursor) for conversations with many messages.

AVAILABLE FIELDS FOR get_by_id:
System fields:
• _id: Convex document ID (Id<"conversations">)
• _creationTime: Document creation timestamp (number)
• organizationId: Organization ID (string)

Core conversation fields:
• subject: Conversation subject/title (string, optional)
• status: Conversation status — 'open' | 'closed' | 'spam' | 'archived' (optional)
• priority: Priority level — 'low' | 'medium' | 'high' | 'urgent' (optional)
• channel: Communication channel (string, optional)
• direction: Message direction — 'inbound' | 'outbound' (optional)
• customerId: Associated customer ID (Id<"customers">, optional)
• integrationName: Integration source name (string, optional)
• lastMessageAt: Timestamp of last message (number, optional)

Large/complex fields (use sparingly):
• metadata: Additional metadata (object, optional) — CAN BE VERY LARGE

MESSAGE FIELDS (returned by get_messages):
• _id, conversationId, channel, direction, content, deliveryState, sentAt, deliveredAt
• externalMessageId, integrationName, metadata (HEAVY)

BEST PRACTICES:
• Use 'list' to find conversations, then 'get_messages' to read their content.
• Always specify 'fields' in get_by_id to minimize response size.
• Use status filter in 'list' to narrow results (e.g., only 'open' conversations).
• Use customerId filter to find conversations for a specific customer.
• Paginate through messages — some conversations may have hundreds of messages.`,
    inputSchema: conversationReadArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<
      | ConversationReadGetByIdResult
      | ConversationReadListResult
      | ConversationReadMessagesResult
    > => {
      if (args.operation === 'get_by_id') {
        return readConversationById(ctx, {
          conversationId: args.conversationId,
          fields: args.fields,
        });
      }

      if (args.operation === 'get_messages') {
        return readConversationMessages(ctx, {
          conversationId: args.conversationId,
          cursor: args.cursor,
          numItems: args.numItems,
        });
      }

      // operation === 'list'
      return readConversationList(ctx, {
        cursor: args.cursor,
        numItems: args.numItems,
        status: args.status,
        customerId: args.customerId,
      });
    },
  }),
} as const;
