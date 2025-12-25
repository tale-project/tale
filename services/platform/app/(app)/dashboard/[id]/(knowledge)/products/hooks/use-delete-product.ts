import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteProduct() {
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

  return useMutation(api.products.deleteProduct).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.products.getProducts, queryParams);

      if (current !== undefined) {
        type Product = (typeof current.products)[number];
        const updatedProducts = current.products.filter(
          (product: Product) => product.id !== args.productId
        );
        localStore.setQuery(api.products.getProducts, queryParams, {
          ...current,
          products: updatedProducts,
          total: current.total - 1,
        });
      }
    }
  );
}
