/**
 * Vendors Mutations
 *
 * All mutation operations for vendors.
 * Business logic is in convex/models/vendors/
 */

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

import { v } from 'convex/values';
import { mutationWithRLS } from '../lib/rls';

import {
  vendorSourceValidator,
  vendorAddressValidator,
  vendorInputValidator,
  bulkCreateVendorsResponseValidator,
} from '../validators/vendors';

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
    metadata: v.optional(jsonRecordValidator),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { vendorId, ...updateData } = args;

    const existingVendor = await ctx.db.get(vendorId);
    if (!existingVendor) {
      throw new Error('Vendor not found');
    }

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
