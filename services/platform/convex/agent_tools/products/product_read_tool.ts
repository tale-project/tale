/**
 * Convex Tool: Product Read
 *
 * Unified read-only product operations for agents.
 * Supports:
 * - operation = 'get_by_id': fetch a single product by productId
 * - operation = 'list': list products for the current organization with pagination
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';

import type {
  ProductReadGetByIdResult,
  ProductReadListResult,
} from './helpers/types';
import { readProductById } from './helpers/read_product_by_id';
import { readProductList } from './helpers/read_product_list';

// Use a flat object schema instead of discriminatedUnion to ensure OpenAI-compatible JSON Schema
// (discriminatedUnion produces anyOf/oneOf which some providers reject as "type: None")
const productReadArgs = z.object({
  operation: z
    .enum(['get_by_id', 'list'])
    .describe(
      "Operation to perform: 'get_by_id' (fetch by ID) or 'list' (paginate all)",
    ),
  // For get_by_id operation
  productId: z
    .string()
    .optional()
    .describe(
      'Required for \'get_by_id\': Convex Id<"products"> (string format) for the target product',
    ),
  // Common fields for all operations
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of fields to return. Default: ['_id','name','description','price','currency','status','category','imageUrl','stock']",
    ),
  // For list operation
  cursor: z
    .string()
    .nullable()
    .optional()
    .describe(
      "For 'list' operation: Pagination cursor from previous response, or null/omitted for first page",
    ),
  numItems: z
    .number()
    .optional()
    .describe(
      "For 'list' operation: Number of items per page (default: 200). Fewer fields = more items allowed.",
    ),
});

export const productReadTool: ToolDefinition = {
  name: 'product_read',
  tool: createTool({
    description: `Product catalog read tool for retrieving product information.

OPERATIONS:
• 'get_by_id': Fetch a single product by its Convex ID. Use when you have a specific product ID.
• 'list': Paginate through all products for the organization. Use for browsing, searching, or bulk operations.

AVAILABLE FIELDS (select only what you need):
• _id: Convex document ID (Id<"products">)
• _creationTime: Document creation timestamp (number)
• name: Product name (string, required)
• description: Product description (string, optional)
• price: Product price (number, optional)
• currency: Currency code e.g. 'USD', 'EUR' (string, optional)
• status: 'active' | 'inactive' | 'draft' | 'archived' (optional)
• category: Product category (string, optional)
• imageUrl: Product image URL (string, optional)
• stock: Available stock quantity (number, optional)
• tags: Array of tags for categorization (string[], optional)
• externalId: External system ID for integrations (string | number, optional)
• lastUpdated: Last modification timestamp (number)
• translations: Localized product data (array, HEAVY - avoid unless needed)
• metadata: Flexible additional data (object, HEAVY - avoid unless needed)

BEST PRACTICES:
• Always specify 'fields' to minimize response size and improve performance.
• Avoid 'translations' and 'metadata' unless specifically required - they can be large.
• Use 'list' with pagination (cursor) for large catalogs instead of fetching all at once.
• Default numItems is 200; reduce if selecting many fields or heavy fields.
• If you need product information not found in standard fields, check the 'metadata' field - it may contain additional custom attributes imported from external systems.`,
    args: productReadArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<ProductReadGetByIdResult | ProductReadListResult> => {
      if (args.operation === 'get_by_id') {
        if (!args.productId) {
          throw new Error(
            "Missing required 'productId' for get_by_id operation",
          );
        }
        return readProductById(ctx, {
          productId: args.productId,
          fields: args.fields,
        });
      }

      // operation === 'list'
      return readProductList(ctx, {
        cursor: args.cursor,
        numItems: args.numItems,
      });
    },
  }),
} as const;
