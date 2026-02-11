import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Product } from '@/lib/collections/entities/products';

import { toId } from '@/lib/utils/type-guards';

export function useCreateProduct(collection: Collection<Product, string>) {
  return useCallback(
    async (args: {
      organizationId: string;
      name: string;
      description?: string;
      imageUrl?: string;
      stock?: number;
      price?: number;
      currency?: string;
      category?: string;
      tags?: string[];
      status?: 'active' | 'inactive' | 'draft' | 'archived';
      metadata?: Record<string, unknown>;
    }) => {
      const tx = collection.insert(
        {
          _id: toId<'products'>(`temp-${crypto.randomUUID()}`),
          _creationTime: 0,
          organizationId: args.organizationId,
          name: args.name,
          description: args.description,
          imageUrl: args.imageUrl,
          stock: args.stock,
          price: args.price,
          currency: args.currency,
          category: args.category,
          tags: args.tags,
          status: args.status,
          metadata: args.metadata,
        },
        { optimistic: false },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useDeleteProduct(collection: Collection<Product, string>) {
  return useCallback(
    async (args: { productId: string }) => {
      const tx = collection.delete(args.productId);
      await tx.isPersisted.promise;
    },
    [collection],
  );
}

export function useUpdateProduct(collection: Collection<Product, string>) {
  return useCallback(
    async (args: {
      productId: string;
      name?: string;
      description?: string;
      imageUrl?: string;
      stock?: number;
      price?: number;
      currency?: string;
      category?: string;
      tags?: string[];
      status?: 'active' | 'inactive' | 'draft' | 'archived';
      metadata?: Record<string, unknown>;
    }) => {
      const tx = collection.update(args.productId, (draft) => {
        if (args.name !== undefined) draft.name = args.name;
        if (args.description !== undefined)
          draft.description = args.description;
        if (args.imageUrl !== undefined) draft.imageUrl = args.imageUrl;
        if (args.stock !== undefined) draft.stock = args.stock;
        if (args.price !== undefined) draft.price = args.price;
        if (args.currency !== undefined) draft.currency = args.currency;
        if (args.category !== undefined) draft.category = args.category;
        if (args.tags !== undefined) draft.tags = args.tags;
        if (args.status !== undefined) draft.status = args.status;
        if (args.metadata !== undefined) draft.metadata = args.metadata;
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
