/**
 * Vendors Queries
 *
 * All query operations for vendors.
 * Business logic is in convex/model/vendors/
 */

import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import type { Doc } from '../_generated/dataModel';

/**
 * Check if organization has any vendors (fast count query for empty state detection)
 */
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

/**
 * Get a single vendor by ID
 */
export const getVendor = queryWithRLS({
  args: {
    vendorId: v.id('vendors'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.vendorId);
  },
});

/**
 * Get all vendors for an organization without pagination or filtering.
 * Filtering, sorting, and pagination are performed client-side using TanStack DB Collections.
 */
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
