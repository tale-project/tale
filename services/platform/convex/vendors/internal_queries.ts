import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { listVendorsPaginated } from './list_vendors_paginated';
import { vendorSourceValidator } from './validators';

export const getVendor = internalQuery({
  args: {
    vendorId: v.id('vendors'),
  },
  handler: async (ctx, args): Promise<Doc<'vendors'> | null> => {
    return await ctx.db.get(args.vendorId);
  },
});

export const queryVendors = internalQuery({
  args: {
    organizationId: v.string(),
    source: v.optional(vendorSourceValidator),
    locale: v.optional(v.string()),
    paginationOpts: cursorPaginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listVendorsPaginated(ctx, {
      organizationId: args.organizationId,
      source: args.source,
      locale: args.locale,
      paginationOpts: {
        numItems: args.paginationOpts.numItems,
        cursor: args.paginationOpts.cursor,
      },
    });
  },
});
