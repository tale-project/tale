import { v } from 'convex/values';

import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { queryWithRLS } from '../lib/rls';

export const hasVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await hasRecordsInOrg(ctx.db, 'vendors', args.organizationId);
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

export const listVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .paginate(args.paginationOpts);
  },
});
