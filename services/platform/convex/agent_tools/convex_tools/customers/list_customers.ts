/**
 * Convex Tool: List Customers
 *
 * List all customers for a given organization with pagination support and field selection.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import type { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';

interface PaginatedCustomerResult {
  customers: Array<Record<string, unknown>>;
  pagination: {
    hasMore: boolean;
    totalFetched: number;
    cursor: string | null;
  };
}

export const listCustomersTool = {
  name: 'list_customers',
  tool: createTool({
    description: `List customers for an organization with pagination support and field selection.
The organizationId will be automatically obtained from context.

AVAILABLE FIELDS:
You can select which fields to return to optimize data transfer and token usage.
System fields (always useful):
  - _id: Customer ID (string)
  - _creationTime: Creation timestamp (number)
  - organizationId: Organization ID (string)

Core customer fields:
  - name: Customer name (string, optional) - RECOMMENDED
  - email: Customer email (string, optional) - RECOMMENDED
  - phone: Customer phone number (string, optional)
  - externalId: External system ID (string or number, optional)
  - status: Customer status - 'active' | 'churned' | 'potential' (optional)
  - source: Data source - 'manual_import' | 'file_upload' | 'circuly' (string)
  - locale: Customer locale/language preference (string, optional)
  - tags: Customer tags (array of strings, optional)

Customer metrics:
  - totalSpent: Customer lifetime value (number, optional)
  - orderCount: Total number of orders (number, optional)
  - firstPurchaseAt: First purchase timestamp (number, optional)
  - lastPurchaseAt: Last purchase timestamp (number, optional)
  - churned_at: Churn timestamp (number, optional)

Additional fields:
  - notes: Notes and comments (string, optional)

Large/complex fields (use sparingly):
  - address: Customer address object (optional) - CAN BE LARGE
  - metadata: Additional metadata (object, optional) - CAN BE VERY LARGE

Parameters:
- fields (optional): Array of field names to return. If not specified, returns only essential fields: ['_id', 'name', 'email', 'phone', 'status', 'source', 'totalSpent', 'orderCount']
- cursor (optional): Pagination cursor from previous response. Use this to fetch the next page of results.
- numItems (optional): Number of items to fetch per page (default: 200). You can adjust this based on field selection:
  * Minimal fields (e.g., just _id, name, email): Can safely use 500-1000 items per page
  * Essential fields (default): 200-300 items per page is reasonable
  * Many fields or large fields (address, metadata): Use 50-100 items per page

Returns:
- customers: Array of customer objects with only the requested fields
- pagination: Object containing:
  - hasMore: Whether there are more customers to fetch
  - totalFetched: Total number of customers fetched in this response
  - cursor: Cursor to use for fetching the next page (null if no more pages)

IMPORTANT INSTRUCTIONS:
1. Choose fields based on your task - don't request fields you don't need
2. Avoid 'address' and 'metadata' unless specifically needed (they can be very large)
3. Adjust numItems based on how many fields you're requesting:
   - Fewer fields = can request more items per page
   - More fields = should request fewer items per page
4. If hasMore is true, you MUST call this tool again with the returned cursor to fetch all customers
5. Continue calling until hasMore is false to ensure you have retrieved all customers
6. Use the same 'fields' parameter across all pagination calls for consistency
7. There is NO maximum limit on total customers - keep paginating until hasMore is false`,
    args: z.object({
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Array of field names to return. Default: ['_id', 'name', 'email', 'phone', 'status', 'source', 'totalSpent', 'orderCount']",
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
    handler: async (ctx, args): Promise<PaginatedCustomerResult> => {
      const actionCtx = ctx as unknown as ActionCtx;

      // Get organizationId from context
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error(
          'organizationId is required in context for listing customers',
        );
      }

      const numItems = args.numItems ?? 200;
      const cursor = args.cursor ?? null;
      const fields = args.fields ?? [
        '_id',
        'name',
        'email',
        'phone',
        'status',
        'source',
        'totalSpent',
        'orderCount',
      ];

      const result = await actionCtx.runQuery(
        internal.customers.listByOrganization,
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
        customers: result.page,
        pagination: {
          hasMore: !result.isDone,
          totalFetched: result.page.length,
          cursor: result.continueCursor,
        },
      };
    },
  }),
} as const satisfies ToolDefinition;
