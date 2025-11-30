/**
 * Update products with flexible filtering and updates (internal operation)
 */

import { MutationCtx } from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';
import { set, merge } from 'lodash';

import { UpdateProductsResult, ProductStatus } from './types';

export interface UpdateProductsArgs {
  // Option 1: Update by product ID (safest, most common)
  productId?: Id<'products'>;

  // Option 2: Update by filters (for batch updates)
  organizationId?: string;
  externalId?: string | number | Array<string | number>;
  status?: ProductStatus;
  category?: string;

  // Updates to apply
  updates: {
    name?: string;
    description?: string;
    imageUrl?: string;
    stock?: number;
    price?: number;
    currency?: string;
    category?: string;
    tags?: Array<string>;
    status?: ProductStatus;
    externalId?: string | number;
    metadata?: Record<string, unknown>;
  };
}

export async function updateProducts(
  ctx: MutationCtx,
  args: UpdateProductsArgs,
): Promise<UpdateProductsResult> {
  // Validate: must provide either productId or organizationId
  if (!args.productId && !args.organizationId) {
    throw new Error(
      'Must provide either productId or organizationId for safety',
    );
  }

  // Find products to update
  let productsToUpdate: Array<Doc<'products'>> = [];

  if (args.productId) {
    // Update by ID (most common case)
    const product = await ctx.db.get(args.productId);
    if (!product) {
      throw new Error(`Product not found: ${args.productId}`);
    }
    productsToUpdate = [product];
  } else if (args.organizationId) {
    // Update by filters (batch update)
    let products: Array<Doc<'products'>>;

    if (args.externalId !== undefined) {
      if (Array.isArray(args.externalId)) {
        // For array of externalIds, execute multiple targeted queries
        const externalIdArray = args.externalId as Array<string | number>;
        const productPromises = externalIdArray.map((externalId) =>
          ctx.db
            .query('products')
            .withIndex('by_organizationId_and_externalId', (q) =>
              q
                .eq('organizationId', args.organizationId!)
                .eq('externalId', externalId),
            )
            .collect(),
        );

        // Execute all queries in parallel and flatten results
        const productArrays = await Promise.all(productPromises);
        products = productArrays.flat();

        // Remove duplicates (in case same product has multiple matching externalIds)
        const seenIds = new Set<string>();
        products = products.filter((product) => {
          if (seenIds.has(product._id)) {
            return false;
          }
          seenIds.add(product._id);
          return true;
        });
      } else {
        // Single externalId - use the specific index
        const singleExternalId = args.externalId as string | number;
        products = await ctx.db
          .query('products')
          .withIndex('by_organizationId_and_externalId', (q) =>
            q
              .eq('organizationId', args.organizationId!)
              .eq('externalId', singleExternalId),
          )
          .collect();
      }
    } else if (args.status !== undefined) {
      products = await ctx.db
        .query('products')
        .withIndex('by_organizationId_and_status', (q) =>
          q
            .eq('organizationId', args.organizationId!)
            .eq('status', args.status!),
        )
        .collect();
    } else if (args.category !== undefined) {
      products = await ctx.db
        .query('products')
        .withIndex('by_organizationId_and_category', (q) =>
          q
            .eq('organizationId', args.organizationId!)
            .eq('category', args.category!),
        )
        .collect();
    } else {
      products = await ctx.db
        .query('products')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId!),
        )
        .collect();
    }

    // Apply additional filters
    productsToUpdate = products.filter((product) => {
      if (args.status && product.status !== args.status) {
        return false;
      }
      if (args.category && product.category !== args.category) {
        return false;
      }
      if (args.externalId) {
        if (Array.isArray(args.externalId)) {
          // For array, check if product's externalId is in the array
          if (
            product.externalId === undefined ||
            !args.externalId.includes(product.externalId)
          ) {
            return false;
          }
        } else {
          // For single value, check exact match
          if (product.externalId !== args.externalId) {
            return false;
          }
        }
      }

      return true;
    });
  }

  // Apply updates to each product
  const updatedIds: Array<Id<'products'>> = [];

  for (const product of productsToUpdate) {
    // Build the patch object
    const patch: Record<string, unknown> = {};

    // Copy direct field updates
    if (args.updates.name !== undefined) patch.name = args.updates.name;
    if (args.updates.description !== undefined)
      patch.description = args.updates.description;
    if (args.updates.imageUrl !== undefined)
      patch.imageUrl = args.updates.imageUrl;
    if (args.updates.stock !== undefined) patch.stock = args.updates.stock;
    if (args.updates.price !== undefined) patch.price = args.updates.price;
    if (args.updates.currency !== undefined)
      patch.currency = args.updates.currency;
    if (args.updates.category !== undefined)
      patch.category = args.updates.category;
    if (args.updates.tags !== undefined) patch.tags = args.updates.tags;
    if (args.updates.status !== undefined) patch.status = args.updates.status;
    if (args.updates.externalId !== undefined)
      patch.externalId = args.updates.externalId;

    // Handle metadata updates with lodash
    if (args.updates.metadata) {
      const existingMetadata =
        (product.metadata as Record<string, unknown>) ?? {};
      const updatedMetadata: Record<string, unknown> = {
        ...existingMetadata,
      };

      for (const [key, value] of Object.entries(args.updates.metadata)) {
        if (key.includes('.')) {
          // Use lodash.set for dot-notation keys
          set(updatedMetadata, key, value);
        } else {
          // For top-level keys, use merge for objects
          if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            typeof updatedMetadata[key] === 'object' &&
            updatedMetadata[key] !== null &&
            !Array.isArray(updatedMetadata[key])
          ) {
            updatedMetadata[key] = merge(
              {},
              updatedMetadata[key] as Record<string, unknown>,
              value as Record<string, unknown>,
            );
          } else {
            updatedMetadata[key] = value;
          }
        }
      }

      patch.metadata = updatedMetadata;
    }

    // Apply the patch
    await ctx.db.patch(product._id, patch);
    updatedIds.push(product._id);
  }

  return {
    success: true,
    updatedCount: updatedIds.length,
    updatedIds,
  };
}
