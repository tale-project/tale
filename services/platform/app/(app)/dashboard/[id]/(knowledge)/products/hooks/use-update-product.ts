import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateProduct() {
  const params = useParams();
  const searchParams = useSearchParams();

  // Build query params from URL to match the active query
  const queryParams = useMemo(() => {
    const organizationId = params.id as string;
    const currentPage = searchParams.get('page')
      ? Number.parseInt(searchParams.get('page')!)
      : 1;
    const pageSize = searchParams.get('size')
      ? Number.parseInt(searchParams.get('size')!)
      : 10;
    const searchQuery = searchParams.get('query')?.trim() || undefined;

    return {
      organizationId,
      currentPage,
      pageSize,
      searchQuery,
    };
  }, [params.id, searchParams]);

  return useMutation(api.products.updateProduct).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.products.getProducts, queryParams);

      if (current !== undefined) {
        type Product = (typeof current.products)[number];
        const updatedProducts = current.products.map((product: Product) =>
          product.id === args.productId
            ? {
                ...product,
                ...(args.name !== undefined && { name: args.name }),
                ...(args.description !== undefined && { description: args.description }),
                ...(args.imageUrl !== undefined && { imageUrl: args.imageUrl }),
                ...(args.stock !== undefined && { stock: args.stock }),
                ...(args.price !== undefined && { price: args.price }),
                ...(args.currency !== undefined && { currency: args.currency }),
                ...(args.category !== undefined && { category: args.category }),
                lastUpdated: Date.now(),
              }
            : product
        );
        localStore.setQuery(api.products.getProducts, queryParams, {
          ...current,
          products: updatedProducts,
        });
      }
    }
  );
}
