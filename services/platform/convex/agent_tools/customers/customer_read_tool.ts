/**
 * Convex Tool: Customer Read
 *
 * Unified read-only customer operations for agents.
 * Supports:
 * - operation = 'get_by_id': fetch a single customer by customerId
 * - operation = 'get_by_email': fetch a single customer by email within the organization
 * - operation = 'list': list customers for the current organization with pagination
 * - operation = 'count': count total customers for the organization
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import type {
  CustomerReadGetByIdResult,
  CustomerReadGetByEmailResult,
  CustomerReadListResult,
  CustomerReadCountResult,
} from './helpers/types';

import { countCustomers } from './helpers/count_customers';
import { readCustomerByEmail } from './helpers/read_customer_by_email';
import { readCustomerById } from './helpers/read_customer_by_id';
import { readCustomerList } from './helpers/read_customer_list';

// Use a flat object schema instead of discriminatedUnion to ensure OpenAI-compatible JSON Schema
// (discriminatedUnion produces anyOf/oneOf which some providers reject as "type: None")
const customerReadArgs = z.object({
  operation: z
    .enum(['get_by_id', 'get_by_email', 'list', 'count'])
    .describe(
      "Operation to perform: 'get_by_id' (fetch by ID), 'get_by_email' (fetch by email), 'list' (paginate all), or 'count' (count total customers)",
    ),
  // For get_by_id operation
  customerId: z
    .string()
    .optional()
    .describe(
      'Required for \'get_by_id\': Convex Id<"customers"> (string format) for the target customer',
    ),
  // For get_by_email operation
  email: z
    .string()
    .optional()
    .describe(
      "Required for 'get_by_email': Customer email address to search for",
    ),
  // Common fields for all operations
  fields: z
    .array(z.string())
    .optional()
    .describe(
      "Optional list of fields to return. Default: ['_id','name','email','status','source','locale']",
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

export const customerReadTool: ToolDefinition = {
  name: 'customer_read',
  tool: createTool({
    description: `Customer data read tool for retrieving customer information from the INTERNAL CRM database.

SCOPE LIMITATION:
This tool ONLY accesses the internal CRM customer database.
DO NOT use this tool for data from external systems - check [INTEGRATIONS] context and use integration_assistant instead.
Example: Hotel guests, e-commerce customers, external system records are NOT in this database.

OPERATIONS:
• 'get_by_id': Fetch a single customer by their Convex ID. Use when you have a specific customer ID.
• 'get_by_email': Fetch a single customer by their email address within the organization.
• 'list': Paginate through all customers for the organization. Use for browsing, searching, or bulk operations.
• 'count': Count total customers for the organization.
  NOTE: If data volume is too large (cannot be counted within 3 pagination requests), returns a message indicating the data is too large to count.

AVAILABLE FIELDS (select only what you need):
System fields:
• _id: Convex document ID (Id<"customers">)
• _creationTime: Document creation timestamp (number)
• organizationId: Organization ID (string)

Core customer fields:
• name: Customer name (string, optional) - RECOMMENDED
• email: Customer email (string, optional) - RECOMMENDED
• externalId: External system ID (string or number, optional)
• status: Customer status - 'active' | 'churned' | 'potential' (optional)
• source: Data source - 'manual_import' | 'file_upload' | 'circuly' (string)
• locale: Customer locale/language preference (string, optional)
• address: Customer address object with street, city, state, country, postalCode (optional)

Large/complex fields (use sparingly):
• metadata: Additional metadata (object, optional) - CAN BE VERY LARGE

BEST PRACTICES:
• Always specify 'fields' to minimize response size and improve performance.
• Avoid 'metadata' unless specifically needed - it can be very large.
• Use 'list' with pagination (cursor) for large customer bases instead of fetching all at once.
• Default numItems is 200; reduce if selecting many fields or heavy fields.
• If hasMore is true, continue calling with the returned cursor to fetch all customers.
• Use 'count' to get total customer count. If data is too large, the response will indicate this.
• If you need customer information not found in standard fields, check the 'metadata' field - it may contain additional custom attributes imported from external systems.`,
    args: customerReadArgs,
    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<
      | CustomerReadGetByIdResult
      | CustomerReadGetByEmailResult
      | CustomerReadListResult
      | CustomerReadCountResult
    > => {
      if (args.operation === 'get_by_id') {
        if (!args.customerId) {
          throw new Error(
            "Missing required 'customerId' for get_by_id operation",
          );
        }
        return readCustomerById(ctx, {
          customerId: args.customerId,
          fields: args.fields,
        });
      }

      if (args.operation === 'get_by_email') {
        if (!args.email) {
          throw new Error(
            "Missing required 'email' for get_by_email operation",
          );
        }
        return readCustomerByEmail(ctx, {
          email: args.email,
          fields: args.fields,
        });
      }

      if (args.operation === 'count') {
        return countCustomers(ctx);
      }

      // operation === 'list'
      return readCustomerList(ctx, {
        cursor: args.cursor,
        numItems: args.numItems,
      });
    },
  }),
} as const;
