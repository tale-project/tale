/**
 * Convex Tool: Vendor Write
 *
 * Lets an agent create and update vendors/suppliers. Org-scoped via
 * `vendors/internal_mutations.ts` (the `callerOrgId` guard closes cross-tenant
 * writes). Deletion is NOT exposed to agents (destructive).
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
const vendorFields = {
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  locale: z.string().optional(),
  address: ADDRESS,
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
} as const;

const vendorWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    ...vendorFields,
  }),
  z.object({
    operation: z.literal('update'),
    vendorId: z.string().describe('Convex Id<"vendors">'),
    ...vendorFields,
  }),
]);

export const vendorWriteTool: ToolDefinition = {
  name: 'vendor_write',
  availability: 'any',
  tool: createTool({
    description: `Create and update vendors/suppliers in the internal directory.

OPERATIONS:
• 'create': Add a new vendor.
• 'update': Patch an existing vendor's fields by id.

Use vendor_read first to find the vendor id. Deleting vendors is not available to agents.`,
    inputSchema: vendorWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'create') {
        const vendorId = await ctx.runMutation(
          internal.vendors.internal_mutations.createVendor,
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
        return { operation: 'create', vendorId };
      }

      // operation === 'update'
      await ctx.runMutation(internal.vendors.internal_mutations.updateVendor, {
        vendorId: toId<'vendors'>(args.vendorId),
        name: args.name,
        email: args.email,
        phone: args.phone,
        locale: args.locale,
        address: args.address,
        tags: args.tags,
        notes: args.notes,
        callerOrgId: organizationId,
      });
      return { operation: 'update', vendorId: args.vendorId };
    },
  }),
} as const;
