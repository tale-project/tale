/**
 * Convex Tool: Contact Read
 *
 * Unified read-only contact operations for agents. A contact is any
 * person/organization the org corresponds with — the single directory that
 * replaced the former customers + vendors address books (issue #2618).
 * Supports:
 * - operation = 'get_by_id': fetch a single contact by contactId
 * - operation = 'get_by_email': fetch a single contact by email within the organization
 * - operation = 'list': list contacts for the current organization with pagination
 * - operation = 'count': count total contacts for the organization
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import { countContacts } from './helpers/count_contacts';
import { readContactByEmail } from './helpers/read_contact_by_email';
import { readContactById } from './helpers/read_contact_by_id';
import { readContactList } from './helpers/read_contact_list';
import type {
  ContactReadGetByIdResult,
  ContactReadGetByEmailResult,
  ContactReadListResult,
  ContactReadCountResult,
} from './helpers/types';

const contactReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_by_id'),
    contactId: z
      .string()
      .describe('Convex Id<"contacts"> (string format) for the target contact'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to return. Default: ['_id','name','email','phone','source','locale']",
      ),
  }),
  z.object({
    operation: z.literal('get_by_email'),
    email: z.string().describe('Contact email address to search for'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to return. Default: ['_id','name','email','phone','source','locale']",
      ),
  }),
  z.object({
    operation: z.literal('list'),
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
      .describe(
        'Number of items per page (default: 200). Fewer fields = more items allowed.',
      ),
  }),
  z.object({
    operation: z.literal('count'),
  }),
]);

export const contactReadTool: ToolDefinition = {
  name: 'contact_read',
  availability: 'any',
  tool: createTool({
    description: `Contact data read tool for retrieving contact information from the INTERNAL CRM database.

Contacts are the people and organizations you correspond with — customers, leads, vendors/suppliers, and other counterparts — kept in one internal directory.

SCOPE LIMITATION:
This tool ONLY accesses the internal CRM contact database.
DO NOT use this tool for data from external systems - check [INTEGRATIONS] context and delegate to the integration agent instead.
Example: Hotel guests, e-commerce customers, external system records are NOT in this database.

OPERATIONS:
• 'get_by_id': Fetch a single contact by their Convex ID. Use when you have a specific contact ID.
• 'get_by_email': Fetch a single contact by their email address within the organization.
• 'list': Paginate through all contacts for the organization. Use for browsing, searching, or bulk operations.
• 'count': Count total contacts for the organization.
  NOTE: If data volume is too large (cannot be counted within 3 pagination requests), returns a message indicating the data is too large to count.

AVAILABLE FIELDS (select only what you need):
System fields:
• _id: Convex document ID (Id<"contacts">)
• _creationTime: Document creation timestamp (number)
• organizationId: Organization ID (string)

Core contact fields:
• name: Contact name (string, optional) - RECOMMENDED
• email: Contact email (string, optional) - RECOMMENDED
• phone: Contact phone number (string, optional)
• externalId: External system ID (string or number, optional)
• source: Data source - 'manual_import' | 'file_upload' | 'shopify' | ... (string)
• locale: Contact locale/language preference (string, optional)
• address: Contact address object with street, city, state, country, postalCode (optional)
• tags: Free-form labels for the contact (string[], optional)
• notes: Free-form notes about the contact (string, optional)

Large/complex fields (use sparingly):
• metadata: Additional metadata (object, optional) - CAN BE VERY LARGE

BEST PRACTICES:
• Always specify 'fields' to minimize response size and improve performance.
• Avoid 'metadata' unless specifically needed - it can be very large.
• Use 'list' with pagination (cursor) for large contact bases instead of fetching all at once.
• Default numItems is 200; reduce if selecting many fields or heavy fields.
• If hasMore is true, continue calling with the returned cursor to fetch all contacts.
• Use 'count' to get total contact count. If data is too large, the response will indicate this.
• If you need contact information not found in standard fields, check the 'metadata' field - it may contain additional custom attributes imported from external systems.`,
    inputSchema: contactReadArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<
      | ContactReadGetByIdResult
      | ContactReadGetByEmailResult
      | ContactReadListResult
      | ContactReadCountResult
    > => {
      if (args.operation === 'get_by_id') {
        return readContactById(ctx, {
          contactId: args.contactId,
          fields: args.fields,
        });
      }

      if (args.operation === 'get_by_email') {
        return readContactByEmail(ctx, {
          email: args.email,
          fields: args.fields,
        });
      }

      if (args.operation === 'count') {
        return countContacts(ctx);
      }

      // operation === 'list'
      return readContactList(ctx, {
        cursor: args.cursor,
        numItems: args.numItems,
      });
    },
  }),
} as const;
