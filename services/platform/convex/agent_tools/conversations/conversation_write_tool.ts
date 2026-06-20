/**
 * Convex Tool: Conversation Write
 *
 * Lets an agent reply into a customer conversation and update its status /
 * priority. Recording an outbound reply stores the message on the conversation;
 * actually transmitting it to the customer is a separate, approval-gated
 * integration send — so this tool never sends email/SMS on its own.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import {
  requireOrganizationId,
  resolveActorId,
} from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const STATUS = z.enum(['open', 'closed', 'archived', 'spam']);
const PRIORITY = z.enum(['low', 'medium', 'high', 'urgent']);

const conversationWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('reply'),
    conversationId: z.string().describe('Convex Id<"conversations">'),
    content: z
      .string()
      .describe('Reply body (recorded as an outbound message)'),
  }),
  z.object({
    operation: z.literal('update'),
    conversationId: z.string().describe('Convex Id<"conversations">'),
    status: STATUS.optional(),
    priority: PRIORITY.optional(),
    subject: z.string().optional(),
  }),
]);

export const conversationWriteTool: ToolDefinition = {
  name: 'conversation_write',
  tool: createTool({
    description: `Reply into a customer conversation and update its status/priority.

OPERATIONS:
• 'reply': Record an outbound reply message on the conversation. (It is NOT transmitted to the customer here — sending is an approval-gated integration step.)
• 'update': Change a conversation's status (open/closed/archived/spam), priority, or subject.

Use conversation_read first to read the thread and find the conversation id.`,
    inputSchema: conversationWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'reply') {
        const actorId = resolveActorId(ctx);
        await ctx.runMutation(
          internal.conversations.internal_mutations.addMessageToConversation,
          {
            conversationId: toId<'conversations'>(args.conversationId),
            organizationId,
            sender: actorId,
            content: args.content,
            isCustomer: false,
            status: 'queued',
          },
        );
        return { operation: 'reply', recorded: true };
      }

      // operation === 'update'
      const result = await ctx.runMutation(
        internal.conversations.internal_mutations.updateConversations,
        {
          conversationId: toId<'conversations'>(args.conversationId),
          organizationId,
          updates: {
            status: args.status,
            priority: args.priority,
            subject: args.subject,
          },
        },
      );
      return { operation: 'update', ...result };
    },
  }),
} as const;
