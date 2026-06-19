/**
 * Convex Tool: Product Write
 *
 * Lets an agent create and update products in the internal catalog. Org-scoped
 * via `products/internal_mutations.ts` (the `callerOrgId` guard closes
 * cross-tenant writes). Deletion is NOT exposed to agents (destructive).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const STATUS = z.enum(['active', 'inactive', 'draft', 'archived']);

// Optional attributes shared by create and update. `name` is required on
// create (declared inline there) and optional on update (folded in here).
const productFields = {
  description: z.string().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  stock: z.number().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: STATUS.optional(),
} as const;

const productWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    name: z.string().describe('Product name'),
    ...productFields,
  }),
  z.object({
    operation: z.literal('update'),
    productId: z.string().describe('Convex Id<"products">'),
    name: z.string().optional(),
    ...productFields,
  }),
]);

export const productWriteTool: ToolDefinition = {
  name: 'product_write',
  tool: createTool({
    description: `Create and update products in the internal catalog.

OPERATIONS:
• 'create': Add a new product.
• 'update': Patch an existing product's fields by id.

Use product_read first to find the product id. Deleting products is not available to agents.`,
    inputSchema: productWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'create') {
        const result = await ctx.runMutation(
          internal.products.internal_mutations.ingestProduct,
          {
            organizationId,
            name: args.name,
            description: args.description,
            price: args.price,
            currency: args.currency,
            stock: args.stock,
            category: args.category,
            tags: args.tags,
            status: args.status,
          },
        );
        return { operation: 'create', ...result };
      }

      // operation === 'update'
      const result = await ctx.runMutation(
        internal.products.internal_mutations.updateProducts,
        {
          productId: toId<'products'>(args.productId),
          callerOrgId: organizationId,
          updates: {
            name: args.name,
            description: args.description,
            price: args.price,
            currency: args.currency,
            stock: args.stock,
            category: args.category,
            tags: args.tags,
            status: args.status,
          },
        },
      );
      return { operation: 'update', ...result };
    },
  }),
} as const;
