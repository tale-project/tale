import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Product } from '@/lib/collections/entities/products';

export function useProducts(collection: Collection<Product, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    products: data,
    isLoading,
  };
}
