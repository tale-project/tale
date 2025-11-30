/**
 * Convex Tool: Customer Search (by ID or Email)
 *
 * Find a customer's detailed information by customerId, or by email within an organization.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { Doc, Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';

export const customerSearchTool = {
  name: 'customer_search' as const,
  tool: createTool({
    description:
      'Find customer details by customerId or by email. When searching by email, the organizationId will be automatically obtained from context.',
    args: z
      .object({
        customerId: z
          .string()
          .optional()
          .describe('Convex Id<"customers"> (string format)'),
        email: z.string().email().optional().describe('Customer email'),
      })
      .refine((a) => !!a.customerId || !!a.email, {
        message: 'Provide either customerId or email for customer lookup.',
      }),
    handler: async (ctx, args): Promise<Doc<'customers'> | null> => {
      if (args.customerId) {
        const result = await ctx.runQuery(internal.customers.getCustomerById, {
          customerId: args.customerId as Id<'customers'>,
        });
        return result;
      }

      // email path - get organizationId from context
      // organizationId is added to context by the agent caller (see chat_with_agent.ts, execute_agent_with_tools.ts)
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error(
          'organizationId is required in context for email-based customer search',
        );
      }

      const result = await ctx.runQuery(
        internal.customers.getCustomerByEmailInternal,
        {
          organizationId,
          email: args.email!,
        },
      );
      return result;
    },
  }),
} as const satisfies ToolDefinition;
