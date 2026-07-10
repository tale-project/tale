/**
 * Convex Tool: Contact Write
 *
 * Lets an agent create and update contacts in the internal CRM — the single
 * directory that replaced the former customers + vendors address books
 * (issue #2618). Org-scoped via `contacts/internal_mutations.ts` (the
 * `callerOrgId` guard closes cross-tenant writes). Deletion is intentionally
 * NOT exposed to agents (destructive).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const ADDRESS = z
  .object({
    street: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
  })
  .optional();

// Shared between create and update — both accept the same optional attributes.
const contactFields = {
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  locale: z.string().optional(),
  address: ADDRESS,
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
} as const;

const contactWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    ...contactFields,
  }),
  z.object({
    operation: z.literal('update'),
    contactId: z.string().describe('Convex Id<"contacts">'),
    ...contactFields,
  }),
]);

export const contactWriteTool: ToolDefinition = {
  name: 'contact_write',
  availability: 'any',
  tool: createTool({
    description: `Create and update contacts in the INTERNAL CRM (not external systems).

A contact is any person/organization you correspond with — customers, leads, vendors/suppliers, and other counterparts.

OPERATIONS:
• 'create': Add a new contact. At least a name or email is recommended.
• 'update': Patch an existing contact's fields by id.

Use contact_read first to find the contact id. Deleting contacts is not available to agents.`,
    inputSchema: contactWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'create') {
        const result = await ctx.runMutation(
          internal.contacts.internal_mutations.createContact,
          {
            organizationId,
            name: args.name,
            email: args.email,
            phone: args.phone,
            source: 'manual_import',
            locale: args.locale,
            address: args.address,
            tags: args.tags,
            notes: args.notes,
          },
        );
        return { operation: 'create', ...result };
      }

      // operation === 'update'
      const updated = await ctx.runMutation(
        internal.contacts.internal_mutations.updateContact,
        {
          contactId: toId<'contacts'>(args.contactId),
          name: args.name,
          email: args.email,
          phone: args.phone,
          locale: args.locale,
          address: args.address,
          tags: args.tags,
          notes: args.notes,
          callerOrgId: organizationId,
        },
      );
      return {
        operation: 'update',
        updated: updated !== null,
        contact: updated,
      };
    },
  }),
} as const;
