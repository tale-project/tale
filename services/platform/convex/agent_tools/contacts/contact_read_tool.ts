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
    description: `Read contacts from the INTERNAL CRM database (people/organizations you correspond with: customers, leads, vendors).

INTERNAL ONLY: external-system records (hotel guests, e-commerce customers, …) are NOT here — check [INTEGRATIONS] context and delegate to the integration agent instead.

OPERATIONS:
• 'get_by_id' (Convex ID) · 'get_by_email' · 'list' (paginated browse/search) · 'count' (may report "too large" past 3 pages).

FIELDS (pass 'fields' — select only what you need): _id, _creationTime, organizationId, name (recommended), email (recommended), phone, externalId, source, locale, address {street, city, state, country, postalCode}, tags, notes, metadata (CAN BE VERY LARGE — avoid unless needed; may hold custom attributes imported from external systems).

USAGE: default numItems 200 (reduce for many/heavy fields); while hasMore, continue with the returned cursor.`,
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
