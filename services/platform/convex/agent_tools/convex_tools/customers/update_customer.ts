/**
 * Convex Tool: Update Customer
 *
 * Safely updates a single customer document with provided updates, using
 * the existing internal workflow database executor.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

export const updateCustomerTool = {
  name: 'update_customer',
  tool: createTool({
    description: `Update a single customer with the provided fields.`,
    args: z.object({
      customerId: z.string().describe('Customer id to update'),
      updates: z
        .record(z.string(), z.any())
        .describe('Fields to update (e.g., metadata, status, notes, etc.)'),
    }),
    handler: async (ctx, args) => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Minimal validation
      if (!args.customerId) throw new Error('customerId is required');
      if (!args.updates || typeof args.updates !== 'object') {
        throw new Error('updates must be an object');
      }

      const result: unknown = await actionCtx.runMutation(
        internal.customers.updateCustomers,
        {
          customerId: args.customerId as unknown as Id<'customers'>,
          updates: args.updates as Record<string, unknown>,
        },
      );

      return {
        ok: true,
        updatedCount: (result as { updatedCount?: number }).updatedCount ?? 1,
        customerId: args.customerId,
      };
    },
  }),
} as const satisfies ToolDefinition;
