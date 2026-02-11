import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Product } from '@/lib/collections/entities/products';

import { createProductsCollection } from '@/lib/collections/entities/products';
import { useCollection } from '@/lib/collections/use-collection';

export function useProductCollection(organizationId: string) {
  return useCollection('products', createProductsCollection, organizationId);
}

export function useProducts(collection: Collection<Product, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ product: collection }).select(({ product }) => product),
  );

  return {
    products: data,
    isLoading,
  };
}
