import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import type { Doc } from '../_generated/dataModel';

export const hasVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const firstVendor = await ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return firstVendor !== null;
  },
});

export const getVendor = queryWithRLS({
  args: {
    vendorId: v.id('vendors'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.vendorId);
  },
});

export const getAllVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const vendors: Doc<'vendors'>[] = [];
    for await (const vendor of ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      vendors.push(vendor);
    }
    return vendors;
  },
});
