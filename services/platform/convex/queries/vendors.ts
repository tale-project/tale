/**
 * Vendors Queries
 *
 * All query operations for vendors.
 * Business logic is in convex/model/vendors/
 */

import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import {
  paginateWithFilter,
  cursorPaginationOptsValidator,
} from '../lib/pagination';
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
 * Get a paginated list of vendors for an organization
 */
export const getVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: cursorPaginationOptsValidator,
    source: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
    locale: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc');

    const sourceSet =
      args.source && args.source.length > 0 ? new Set(args.source) : null;
    const localeSet =
      args.locale && args.locale.length > 0 ? new Set(args.locale) : null;
    const searchLower = args.searchTerm?.toLowerCase();

    const filter = (vendor: Doc<'vendors'>): boolean => {
      if (sourceSet && (!vendor.source || !sourceSet.has(vendor.source))) {
        return false;
      }
      if (localeSet && (!vendor.locale || !localeSet.has(vendor.locale))) {
        return false;
      }
      if (searchLower) {
        const nameMatch = vendor.name?.toLowerCase().includes(searchLower);
        const emailMatch = vendor.email?.toLowerCase().includes(searchLower);
        const externalIdMatch = vendor.externalId
          ? String(vendor.externalId).toLowerCase().includes(searchLower)
          : false;
        if (!nameMatch && !emailMatch && !externalIdMatch) {
          return false;
        }
      }
      return true;
    };

    return paginateWithFilter(query, {
      numItems: args.paginationOpts.numItems,
      cursor: args.paginationOpts.cursor,
      filter,
    });
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
