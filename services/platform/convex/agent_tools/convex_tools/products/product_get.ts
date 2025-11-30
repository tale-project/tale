/**
 * Convex Tool: Product Get (by ID)
 *
 * Find a product's detailed information by productId within an organization.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';

// Core tool implementation (shared by both names during cutover)
const productGet = createTool({
  description:
    'Find product details by productId. Supports selecting which fields to return to minimize payload.',
  args: z.object({
    productId: z.string().describe('Convex Id<"products"> (string format)'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Array of field names to return. Default: ['_id','name','description','price','currency','status','category','imageUrl','stock']",
      ),
  }),
  handler: async (ctx, args): Promise<Record<string, unknown> | null> => {
    // Debug: basic call info
    const organizationId = (ctx as unknown as { organizationId?: string })
      .organizationId;
    console.log('[tool:product_get] start', {
      organizationId,
      productId: args.productId,
    });

    const product = await ctx.runQuery(internal.products.getProductById, {
      productId: args.productId as Id<'products'>,
    });

    if (!product) {
      console.log('[tool:product_get] not found', {
        organizationId,
        productId: args.productId,
      });
      return null;
    }

    const defaultFields = [
      '_id',
      'name',
      'description',
      'price',
      'currency',
      'status',
      'category',
      'imageUrl',
      'stock',
    ];
    const fields = args.fields ?? defaultFields;

    // Debug: product fetched and requested fields
    const hasImageUrl = Boolean((product as any)?.imageUrl);
    console.log('[tool:product_get] fetched', {
      productId: args.productId,
      imageUrlPresent: hasImageUrl,
      fields,
    });

    const out: Record<string, unknown> = {};
    for (const f of fields) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[f] = (product as any)?.[f];
    }
    if (!('_id' in out)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out._id = (product as any)._id;
    }

    // Debug: keys being returned
    const presentKeys = Object.keys(out).filter((k) => out[k] !== undefined);
    console.log('[tool:product_get] return', {
      productId: args.productId,
      presentKeys,
    });

    return out;
  },
});

export const productGetTool = {
  name: 'product_get' as const,
  tool: productGet,
} as const satisfies ToolDefinition;

// Temporary compatibility alias during cutover
export const productSearchAliasTool = {
  name: 'product_search' as const,
  tool: productGet,
} as const satisfies ToolDefinition;
