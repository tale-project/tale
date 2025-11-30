/**
 * Convex Tool: Update Product
 *
 * Safely updates a single product document with provided updates, using
 * the existing internal workflow database executor.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

export const updateProductTool = {
  name: 'update_product',
  tool: createTool({
    description: `Update a single product with the provided fields.`,
    args: z.object({
      productId: z.string().describe('Product id to update'),
      updates: z
        .record(z.string(), z.any())
        .describe('Fields to update (e.g., metadata, status, notes, etc.)'),
    }),
    handler: async (ctx, args) => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Minimal validation
      if (!args.productId) throw new Error('productId is required');
      if (!args.updates || typeof args.updates !== 'object') {
        throw new Error('updates must be an object');
      }

      console.log('[update_product] Updating product', {
        productId: args.productId,
        updates: args.updates,
      });

      const result: unknown = await actionCtx.runMutation(
        internal.products.updateProducts,
        {
          productId: args.productId as unknown as Id<'products'>,
          updates: args.updates as Record<string, unknown>,
        },
      );

      console.log('[update_product] Product updated', {
        productId: args.productId,
        updatedCount: (result as { updatedCount?: number }).updatedCount,
      });

      return {
        ok: true,
        updatedCount: (result as { updatedCount?: number }).updatedCount ?? 1,
        productId: args.productId,
      };
    },
  }),
} as const satisfies ToolDefinition;

