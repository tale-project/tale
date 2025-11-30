/**
 * Convex Tool: List Products
 *
 * List all products for a given organization with pagination support and field selection.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

interface PaginatedProductResult {
  products: Array<Record<string, unknown>>;
  pagination: {
    hasMore: boolean;
    totalFetched: number;
    cursor: string | null;
  };
}

export const listProductsTool = {
  name: 'list_products',
  tool: createTool({
    description: `List products for an organization with pagination support and field selection.
The organizationId will be automatically obtained from context.

AVAILABLE FIELDS:
You can select which fields to return to optimize data transfer and token usage.
System fields (always useful):
  - _id: Product ID (string)
  - _creationTime: Creation timestamp (number)
  - organizationId: Organization ID (string)

Core product fields:
  - name: Product name (string) - RECOMMENDED
  - description: Product description (string, optional)
  - imageUrl: Product image URL (string, optional)
  - stock: Stock quantity (number, optional)
  - price: Product price (number, optional)
  - currency: Price currency (string, optional)
  - category: Product category (string, optional)
  - tags: Product tags (array of strings, optional)
  - status: Product status - 'active' | 'inactive' | 'draft' | 'archived' (optional)
  - lastUpdated: Last update timestamp (number, optional)
  - externalId: External system ID (string or number, optional)

Large/complex fields (use sparingly):
  - translations: Multi-language translations (array of objects, optional) - CAN BE VERY LARGE
  - metadata: Additional metadata (object, optional) - CAN BE VERY LARGE

Parameters:
- fields (optional): Array of field names to return. If not specified, returns only essential fields: ['_id', 'name', 'description', 'price', 'currency', 'status', 'category']
- cursor (optional): Pagination cursor from previous response. Use this to fetch the next page of results.
- numItems (optional): Number of items to fetch per page (default: 200). You can adjust this based on field selection:
  * Minimal fields (e.g., just _id, name): Can safely use 500-1000 items per page
  * Essential fields (default): 200-300 items per page is reasonable
  * Many fields or large fields (translations, metadata): Use 50-100 items per page

Returns:
- products: Array of product objects with only the requested fields
- pagination: Object containing:
  - hasMore: Whether there are more products to fetch
  - totalFetched: Total number of products fetched in this response
  - cursor: Cursor to use for fetching the next page (null if no more pages)

IMPORTANT INSTRUCTIONS:
1. Choose fields based on your task - don't request fields you don't need
2. Avoid 'translations' and 'metadata' unless specifically needed (they can be very large)
3. Adjust numItems based on how many fields you're requesting:
   - Fewer fields = can request more items per page
   - More fields = should request fewer items per page
4. If hasMore is true, you MUST call this tool again with the returned cursor to fetch all products
5. Continue calling until hasMore is false to ensure you have retrieved all products
6. Use the same 'fields' parameter across all pagination calls for consistency
7. There is NO maximum limit on total products - keep paginating until hasMore is false`,
    args: z.object({
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Array of field names to return. Default: ['_id', 'name', 'description', 'price', 'currency', 'status', 'category']",
        ),
      cursor: z
        .string()
        .nullable()
        .optional()
        .describe('Pagination cursor from previous response'),
      numItems: z
        .number()
        .min(1)
        .optional()
        .describe(
          'Number of items per page (default: 200). Adjust based on field count: fewer fields = more items, more fields = fewer items',
        ),
    }),
    handler: async (ctx, args): Promise<PaginatedProductResult> => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Get organizationId from context
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error(
          'organizationId is required in context for listing products',
        );
      }

      const numItems = args.numItems ?? 200;
      const cursor = args.cursor ?? null;
      const fields = args.fields ?? [
        '_id',
        'name',
        'description',
        'price',
        'currency',
        'status',
        'category',
      ];

      const result = await actionCtx.runQuery(
        internal.products.listByOrganization,
        {
          organizationId,
          paginationOpts: {
            numItems,
            cursor,
          },
          fields,
        },
      );

      return {
        products: result.page,
        pagination: {
          hasMore: !result.isDone,
          totalFetched: result.page.length,
          cursor: result.continueCursor,
        },
      };
    },
  }),
} as const satisfies ToolDefinition;
