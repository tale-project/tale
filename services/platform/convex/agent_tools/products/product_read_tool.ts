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
import type {
  ProductReadGetByIdResult,
  ProductReadListResult,
  ProductReadCountResult,
} from './helpers/types';

import { countProducts } from './helpers/count_products';
import { readProductsByIds } from './helpers/read_product_by_id';
import { readProductList } from './helpers/read_product_list';

// Use a flat object schema instead of discriminatedUnion to ensure OpenAI-compatible JSON Schema
// (discriminatedUnion produces anyOf/oneOf which some providers reject as "type: None")
const productReadArgs = z.object({
  operation: z
    .enum(['get_by_id', 'list', 'count'])
    .describe(
      "Operation to perform: 'get_by_id' (fetch by IDs), 'list' (browse catalog), or 'count' (count total products)",
    ),
  // For get_by_id operation
  productIds: z
    .array(z.string())
    .optional()
    .describe(
      'Required for \'get_by_id\': Array of Convex Id<"products"> strings. Can be single item or multiple.',
    ),
  // For get_by_id operation only
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "For 'get_by_id' only: Fields to return. Default: ['_id','name','description','price','currency','status','category','imageUrl','stock']. Ignored for 'list'.",
    ),
  // For list and count operations - filters
  status: z
    .enum(['active', 'inactive', 'draft', 'archived'])
    .optional()
    .describe("For 'list' and 'count': Filter by product status"),
  minStock: z
    .number()
    .optional()
    .describe(
      "For 'list' and 'count': Filter by minimum stock level. Only returns/counts products with stock >= minStock",
    ),
  // For list operation - pagination
  cursor: z
    .string()
    .nullable()
    .optional()
    .describe(
      "For 'list': Pagination cursor from previous response, or null/omitted for first page",
    ),
  numItems: z
    .number()
    .optional()
    .describe("For 'list': Number of items per page (default: 50)"),
});

export const productReadTool: ToolDefinition = {
  name: 'product_read',
  tool: createTool({
    description: `Product catalog read tool for retrieving product information from the INTERNAL product database.

SCOPE LIMITATION:
This tool ONLY accesses the internal product catalog.
DO NOT use this tool for products from external e-commerce systems - check [INTEGRATIONS] context and delegate to the integration agent instead.

OPERATIONS:
• 'list': Browse/search the catalog. Returns ONLY: _id, name, description, status, stock (fixed fields).
  Supports filters: status (active/inactive/draft/archived), minStock (minimum stock level).
  Use this to find products, then use 'get_by_id' to get full details.
• 'get_by_id': Fetch one or more products by ID. Supports batch queries (pass multiple IDs).
  Use 'fields' parameter to select which fields to return.
• 'count': Count total products. Supports filters: status, minStock.
  NOTE: If data volume is too large (cannot be counted within 3 pagination requests), returns a message indicating the data is too large to count.

WORKFLOW:
1. Use 'list' to browse/search products (returns: _id, name, description, status, stock)
2. Use 'get_by_id' with the IDs you need to fetch full product details
3. Use 'count' to get total product count (with optional filters)

AVAILABLE FIELDS FOR get_by_id (select only what you need):
• _id, name, description, price, currency, status, category, imageUrl, stock, tags, externalId, lastUpdated
• translations, metadata (HEAVY - avoid unless specifically needed)

BEST PRACTICES:
• Use 'list' for browsing, 'get_by_id' for details - this minimizes token usage
• Use status and minStock filters to narrow down results
• Batch multiple product IDs in a single 'get_by_id' call instead of multiple calls
• Specify 'fields' in get_by_id to minimize response size
• Use 'count' with filters to get counts for specific subsets of products`,
    args: productReadArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<
      ProductReadGetByIdResult | ProductReadListResult | ProductReadCountResult
    > => {
      if (args.operation === 'get_by_id') {
        if (!args.productIds || args.productIds.length === 0) {
          throw new Error(
            "Missing required 'productIds' for get_by_id operation",
          );
        }
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
