import { v } from 'convex/values';
import { mutationWithRLS, queryWithRLS } from './lib/rls';
import { paginationOptsValidator } from 'convex/server';

/**
 * Get a paginated list of vendors for an organization
 */
export const getVendors = queryWithRLS({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    source: v.optional(v.array(v.string())),
    searchTerm: v.optional(v.string()),
    locale: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Start with all vendors in the organization
    let vendors = await ctx.db
      .query('vendors')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();

    // Apply source filter if provided
    if (args.source && args.source.length > 0) {
      vendors = vendors.filter(
        (v) => v.source && args.source!.includes(v.source),
      );
    }

    // Apply locale filter if provided
    if (args.locale && args.locale.length > 0) {
      vendors = vendors.filter(
        (v) => v.locale && args.locale!.includes(v.locale),
      );
    }

    // Apply search filter if provided
    if (args.searchTerm) {
      const searchLower = args.searchTerm.toLowerCase();
      vendors = vendors.filter((vendor) => {
        const nameMatch = vendor.name?.toLowerCase().includes(searchLower);
        const emailMatch = vendor.email?.toLowerCase().includes(searchLower);
        const externalIdMatch = vendor.externalId
          ? String(vendor.externalId).toLowerCase().includes(searchLower)
          : false;
        return nameMatch || emailMatch || externalIdMatch;
      });
    }

    // Sort by creation time (newest first)
    vendors.sort((a, b) => b._creationTime - a._creationTime);

    // Apply pagination
    const startIndex = args.paginationOpts.cursor
      ? vendors.findIndex((v) => v._id === args.paginationOpts.cursor) + 1
      : 0;
    const endIndex = startIndex + args.paginationOpts.numItems;
    const paginatedVendors = vendors.slice(startIndex, endIndex);

    return {
      page: paginatedVendors,
      isDone: endIndex >= vendors.length,
      continueCursor:
        paginatedVendors.length > 0
          ? paginatedVendors[paginatedVendors.length - 1]._id
          : undefined,
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
    source: v.optional(
      v.union(
        v.literal('manual_import'),
        v.literal('file_upload'),
        v.literal('circuly'),
      ),
    ),
    locale: v.optional(v.string()),
    address: v.optional(
      v.object({
        street: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        postalCode: v.optional(v.string()),
      }),
    ),
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

    // Check if email is being updated and doesn't conflict
    if (updateData.email && updateData.email !== existingVendor.email) {
      const conflictingVendor = await ctx.db
        .query('vendors')
        .withIndex('by_organizationId_and_email', (q) =>
          q
            .eq('organizationId', existingVendor.organizationId)
            .eq('email', updateData.email),
        )
        .first();

      if (conflictingVendor && conflictingVendor._id !== vendorId) {
        throw new Error(`Vendor with email ${updateData.email} already exists`);
      }
    }

    // Check if external ID is being updated and doesn't conflict
    if (
      updateData.externalId &&
      updateData.externalId !== existingVendor.externalId
    ) {
      const conflictingVendor = await ctx.db
        .query('vendors')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q
            .eq('organizationId', existingVendor.organizationId)
            .eq('externalId', updateData.externalId),
        )
        .first();

      if (conflictingVendor && conflictingVendor._id !== vendorId) {
        throw new Error(
          `Vendor with external ID ${updateData.externalId} already exists`,
        );
      }
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
    vendors: v.array(
      v.object({
        name: v.optional(v.string()),
        email: v.string(),
        phone: v.optional(v.string()),
        externalId: v.optional(v.string()),
        source: v.union(
          v.literal('manual_import'),
          v.literal('file_upload'),
          v.literal('circuly'),
        ),
        locale: v.optional(v.string()),
        address: v.optional(
          v.object({
            street: v.optional(v.string()),
            city: v.optional(v.string()),
            state: v.optional(v.string()),
            country: v.optional(v.string()),
            postalCode: v.optional(v.string()),
          }),
        ),
        tags: v.optional(v.array(v.string())),
        metadata: v.optional(v.any()),
        notes: v.optional(v.string()),
      }),
    ),
  },
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
