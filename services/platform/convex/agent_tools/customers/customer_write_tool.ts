/**
 * Convex Tool: Customer Write
 *
 * Lets an agent create and update customers in the internal CRM. Org-scoped via
 * `customers/internal_mutations.ts` (the `callerOrgId` guard closes cross-tenant
 * writes). Deletion is intentionally NOT exposed to agents (destructive).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const STATUS = z.enum(['active', 'churned', 'potential']);
const ADDRESS = z
  .object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
  })
  .optional();

// Shared between create and update — both accept the same optional attributes.
const customerFields = {
  name: z.string().optional(),
  email: z.string().optional(),
  status: STATUS.optional(),
  locale: z.string().optional(),
  address: ADDRESS,
} as const;

const customerWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    ...customerFields,
  }),
  z.object({
    operation: z.literal('update'),
    customerId: z.string().describe('Convex Id<"customers">'),
    ...customerFields,
  }),
]);

export const customerWriteTool: ToolDefinition = {
  name: 'customer_write',
  tool: createTool({
    description: `Create and update customers in the INTERNAL CRM (not external systems).

OPERATIONS:
• 'create': Add a new customer. At least a name or email is recommended.
• 'update': Patch an existing customer's fields by id.

Use customer_read first to find the customer id. Deleting customers is not available to agents.`,
    inputSchema: customerWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'create') {
        const result = await ctx.runMutation(
          internal.customers.internal_mutations.createCustomer,
          {
            organizationId,
            name: args.name,
            email: args.email,
            status: args.status,
            source: 'manual_import',
            locale: args.locale,
            address: args.address,
          },
        );
        return { operation: 'create', ...result };
      }

      // operation === 'update'
      const updated = await ctx.runMutation(
        internal.customers.internal_mutations.updateCustomer,
        {
          customerId: toId<'customers'>(args.customerId),
          name: args.name,
          email: args.email,
          status: args.status,
          locale: args.locale,
          address: args.address,
          callerOrgId: organizationId,
        },
      );
      return {
        operation: 'update',
        updated: updated !== null,
        customer: updated,
      };
    },
  }),
} as const;
