/**
 * Convex Tool: Vendor Read
 *
 * Read-only access to the internal vendor/supplier directory. Org-scoped via
 * `vendors/internal_queries.ts`.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const vendorReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_by_id'),
    vendorId: z.string().describe('Convex Id<"vendors">'),
  }),
  z.object({
    operation: z.literal('list'),
    cursor: z.string().nullable().optional(),
    numItems: z.number().optional().describe('Items per page (default 100)'),
  }),
]);

export const vendorReadTool: ToolDefinition = {
  name: 'vendor_read',
  tool: createTool({
    description: `Read vendors/suppliers from the internal directory.

OPERATIONS:
• 'get_by_id': Fetch one vendor by id.
• 'list': Paginate vendors for the organization (pass the returned cursor for the next page).`,
    inputSchema: vendorReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'get_by_id') {
        const vendor = await ctx.runQuery(
          internal.vendors.internal_queries.getVendor,
          {
            vendorId: toId<'vendors'>(args.vendorId),
            callerOrgId: organizationId,
          },
        );
        return { operation: 'get_by_id', vendor };
      }

      // operation === 'list'
      const result = await ctx.runQuery(
        internal.vendors.internal_queries.queryVendors,
        {
          organizationId,
          paginationOpts: {
            numItems: args.numItems ?? 100,
            cursor: args.cursor ?? null,
          },
        },
      );
      return { operation: 'list', ...result };
    },
  }),
} as const;
