/**
 * Convex Tool: Product Read
 *
 * Unified read-only product operations for agents.
 * Supports:
 * - operation = 'get_by_id': fetch products by IDs (batch supported)
 * - operation = 'list': list products for the current organization with pagination
 * - operation = 'count': count total products (with optional filters)
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import { countProducts } from './helpers/count_products';
import { readProductsByIds } from './helpers/read_product_by_id';
import { readProductList } from './helpers/read_product_list';
import type {
  ProductReadGetByIdResult,
  ProductReadListResult,
  ProductReadCountResult,
} from './helpers/types';

const productReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_by_id'),
    productIds: z
      .array(z.string())
      .nonempty()
      .describe(
        'Array of Convex Id<"products"> strings. Can be single item or multiple.',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to return. Default: ['_id','name','description','price','currency','status','category','imageUrl','stock'].",
      ),
  }),
  z.object({
    operation: z.literal('list'),
    status: z
      .enum(['active', 'inactive', 'draft', 'archived'])
      .optional()
      .describe('Filter by product status'),
    minStock: z
      .number()
      .optional()
      .describe(
        'Filter by minimum stock level. Only returns products with stock >= minStock',
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
      .describe('Number of items per page (default: 50)'),
  }),
  z.object({
    operation: z.literal('count'),
    status: z
      .enum(['active', 'inactive', 'draft', 'archived'])
      .optional()
      .describe('Filter by product status'),
    minStock: z
      .number()
      .optional()
      .describe(
        'Filter by minimum stock level. Only counts products with stock >= minStock',
      ),
  }),
]);

export const productReadTool: ToolDefinition = {
  name: 'product_read',
  availability: 'any',
  tool: createTool({
    description: `Read products from the INTERNAL catalog. External e-commerce products are NOT here — check [INTEGRATIONS] context and delegate to the integration agent instead.

OPERATIONS:
• 'list': browse/search; returns fixed fields (_id, name, description, status, stock); filters: status (active/inactive/draft/archived), minStock.
• 'get_by_id': one or more IDs (batch in ONE call); pass 'fields' to select from _id, name, description, price, currency, status, category, imageUrl, stock, tags, externalId, lastUpdated, translations/metadata (HEAVY — avoid unless needed).
• 'count': with optional status/minStock filters (may report "too large" past 3 pages).

WORKFLOW: 'list' to find → 'get_by_id' (with 'fields') for details → 'count' for totals.`,
    inputSchema: productReadArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<
      ProductReadGetByIdResult | ProductReadListResult | ProductReadCountResult
    > => {
      if (args.operation === 'get_by_id') {
        return readProductsByIds(ctx, {
          productIds: args.productIds,
          fields: args.fields,
        });
      }

      if (args.operation === 'count') {
        return countProducts(ctx, {
          status: args.status,
          minStock: args.minStock,
        });
      }

      // operation === 'list'
      return readProductList(ctx, {
        cursor: args.cursor,
        numItems: args.numItems,
        status: args.status,
        minStock: args.minStock,
      });
    },
  }),
} as const;
