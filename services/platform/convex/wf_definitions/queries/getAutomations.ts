/**
 * Public queries for automations (workflow definitions)
 */

import { v } from 'convex/values';
import { queryWithRLS } from '../../lib/rls';
import type { Doc } from '../../_generated/dataModel';

type WorkflowDefinition = Doc<'wfDefinitions'>;

export const getAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
    searchTerm: v.optional(v.string()),
    status: v.optional(v.array(v.string())),
    paginationOpts: v.object({
      cursor: v.union(v.string(), v.null()),
      numItems: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    const allItems: WorkflowDefinition[] = [];
    for await (const item of query) {
      // Filter by status if provided
      if (args.status && args.status.length > 0) {
        if (!args.status.includes(item.status ?? 'active')) {
          continue;
        }
      }

      // Filter by search term if provided
      if (args.searchTerm) {
        const searchLower = args.searchTerm.toLowerCase();
        const matchesName = item.name?.toLowerCase().includes(searchLower);
        const matchesDescription = item.description?.toLowerCase().includes(searchLower);
        if (!matchesName && !matchesDescription) {
          continue;
        }
      }

      allItems.push(item);
    }

    return allItems;
  },
});

export const hasAutomations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const first = await ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    return first !== null;
  },
});
