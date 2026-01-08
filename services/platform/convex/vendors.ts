import { v } from 'convex/values';
import { mutationWithRLS, queryWithRLS } from './lib/rls';
import {
  paginateWithFilter,
  cursorPaginationOptsValidator,
  normalizePaginationOptions,
  calculatePaginationMeta,
} from './lib/pagination';
import type { Doc } from './_generated/dataModel';

// Import validators from model
import {
  sortOrderValidator,
  vendorSourceValidator,
  vendorAddressValidator,
  vendorInputValidator,
  vendorListResponseValidator,
  bulkCreateVendorsResponseValidator,
} from './model/vendors/validators';

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

    // Pre-compute filter sets for O(1) lookups
    const sourceSet =
      args.source && args.source.length > 0 ? new Set(args.source) : null;
    const localeSet =
      args.locale && args.locale.length > 0 ? new Set(args.locale) : null;
    const searchLower = args.searchTerm?.toLowerCase();

    // Create filter function
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
 * List vendors with offset-based pagination, search, and filtering
 *
 * Uses offset-based pagination for traditional page navigation with total counts.
 */
export const listVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
    currentPage: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    searchTerm: v.optional(v.string()),
    source: v.optional(v.array(v.string())),
    locale: v.optional(v.array(v.string())),
    sortField: v.optional(v.string()),
    sortOrder: v.optional(sortOrderValidator),
  },
  returns: vendorListResponseValidator,
  handler: async (ctx, args) => {
    const { page: currentPage, pageSize } = normalizePaginationOptions({
      page: args.currentPage,
      pageSize: args.pageSize,
    });

    const query = ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc');

    // Pre-compute filter sets for O(1) lookups
    const sourceSet =
      args.source && args.source.length > 0 ? new Set(args.source) : null;
    const localeSet =
      args.locale && args.locale.length > 0 ? new Set(args.locale) : null;
    const searchLower = args.searchTerm?.toLowerCase();

    // Collect all matching vendors
    const matchingVendors: Doc<'vendors'>[] = [];

    for await (const vendor of query) {
      if (sourceSet && (!vendor.source || !sourceSet.has(vendor.source))) {
        continue;
      }
      if (localeSet && (!vendor.locale || !localeSet.has(vendor.locale))) {
        continue;
      }
      if (searchLower) {
        const nameMatch = vendor.name?.toLowerCase().includes(searchLower);
        const emailMatch = vendor.email?.toLowerCase().includes(searchLower);
        const externalIdMatch = vendor.externalId
          ? String(vendor.externalId).toLowerCase().includes(searchLower)
          : false;
        if (!nameMatch && !emailMatch && !externalIdMatch) {
          continue;
        }
      }
      matchingVendors.push(vendor);
    }

    const total = matchingVendors.length;
    const { totalPages, hasNextPage, hasPreviousPage } = calculatePaginationMeta(
      total,
      currentPage,
      pageSize,
    );

    // Sort based on sortField and sortOrder
    const sortField = args.sortField || '_creationTime';
    const sortOrder = args.sortOrder || 'desc';
    matchingVendors.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortField];
      const bVal = (b as Record<string, unknown>)[sortField];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Paginate
    const startIndex = (currentPage - 1) * pageSize;
    const items = matchingVendors.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total,
      page: currentPage,
      pageSize,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };
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
 * Update an existing vendor
 */
export const updateVendor = mutationWithRLS({
  args: {
    vendorId: v.id('vendors'),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    externalId: v.optional(v.string()),
    source: v.optional(vendorSourceValidator),
    locale: v.optional(v.string()),
    address: v.optional(vendorAddressValidator),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(v.any()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { vendorId, ...updateData } = args;

    // Get the existing vendor to check organization
    const existingVendor = await ctx.db.get(vendorId);
    if (!existingVendor) {
      throw new Error('Vendor not found');
    }

    // Check for conflicts in parallel
    const checkEmailConflict =
      updateData.email && updateData.email !== existingVendor.email;
    const checkExternalIdConflict =
      updateData.externalId && updateData.externalId !== existingVendor.externalId;

    const [emailConflict, externalIdConflict] = await Promise.all([
      checkEmailConflict
        ? ctx.db
            .query('vendors')
            .withIndex('by_organizationId_and_email', (q) =>
              q
                .eq('organizationId', existingVendor.organizationId)
                .eq('email', updateData.email),
            )
            .first()
        : Promise.resolve(null),
      checkExternalIdConflict
        ? ctx.db
            .query('vendors')
            .withIndex('by_organizationId_and_externalId', (q) =>
              q
                .eq('organizationId', existingVendor.organizationId)
                .eq('externalId', updateData.externalId),
            )
            .first()
        : Promise.resolve(null),
    ]);

    if (emailConflict && emailConflict._id !== vendorId) {
      throw new Error(`Vendor with email ${updateData.email} already exists`);
    }

    if (externalIdConflict && externalIdConflict._id !== vendorId) {
      throw new Error(
        `Vendor with external ID ${updateData.externalId} already exists`,
      );
    }

    // Remove undefined values
    const cleanUpdateData = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined),
    );

    await ctx.db.patch(vendorId, cleanUpdateData);
    return await ctx.db.get(vendorId);
  },
});

/**
 * Delete a vendor
 */
export const deleteVendor = mutationWithRLS({
  args: {
    vendorId: v.id('vendors'),
  },
  handler: async (ctx, args) => {
    const vendor = await ctx.db.get(args.vendorId);
    if (!vendor) {
      throw new Error('Vendor not found');
    }

    await ctx.db.delete(args.vendorId);
    return { success: true };
  },
});

/**
 * Bulk create vendors
 */
export const bulkCreateVendors = mutationWithRLS({
  args: {
    organizationId: v.string(),
    vendors: v.array(vendorInputValidator),
  },
  returns: bulkCreateVendorsResponseValidator,
  handler: async (ctx, args) => {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ index: number; error: string; vendor: any }>,
    };

    for (let i = 0; i < args.vendors.length; i++) {
      const vendorData = args.vendors[i];

      try {
        // Check for duplicates
        if (vendorData.email) {
          const existing = await ctx.db
            .query('vendors')
            .withIndex('by_organizationId_and_email', (q) =>
              q
                .eq('organizationId', args.organizationId)
                .eq('email', vendorData.email!),
            )
            .first();

          if (existing) {
            throw new Error(
              `Vendor with email ${vendorData.email} already exists`,
            );
          }
        }

        if (vendorData.externalId) {
          const existing = await ctx.db
            .query('vendors')
            .withIndex('by_organizationId_and_externalId', (q) =>
              q
                .eq('organizationId', args.organizationId)
                .eq('externalId', vendorData.externalId!),
            )
            .first();

          if (existing) {
            throw new Error(
              `Vendor with external ID ${vendorData.externalId} already exists`,
            );
          }
        }

        await ctx.db.insert('vendors', {
          organizationId: args.organizationId,
          ...vendorData,
        });

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
          vendor: vendorData,
        });
      }
    }

    return results;
  },
});
