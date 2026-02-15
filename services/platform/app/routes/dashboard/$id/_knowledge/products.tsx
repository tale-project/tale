import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductTable } from '@/app/features/products/components/product-table';
import { ProductTableSkeleton } from '@/app/features/products/components/product-table-skeleton';
import { ProductsEmptyState } from '@/app/features/products/components/products-empty-state';
import { useListProductsPaginated } from '@/app/features/products/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/products')({
  head: () => ({
    meta: seo('products'),
  }),
  validateSearch: searchSchema,
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      convexQuery(api.products.queries.countProducts, {
        organizationId: params.id,
      }),
    );
  },
  component: ProductsPage,
});

function ProductsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const { data: count } = useConvexQuery(api.products.queries.countProducts, {
    organizationId,
  });

  const paginatedResult = useListProductsPaginated({
    organizationId,
    status: search.status,
    category: search.category,
    initialNumItems: 20,
  });

  if (count === 0) {
    return <ProductsEmptyState organizationId={organizationId} />;
  }

  const hasServerFilters = !!(search.status || search.category);

  const isInitialLoading =
    paginatedResult.status === 'LoadingFirstPage' && !hasServerFilters;

  if (isInitialLoading) {
    return (
      <ProductTableSkeleton
        organizationId={organizationId}
        rows={Math.min(count ?? 10, 10)}
      />
    );
  }

  return (
    <ProductTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      status={search.status}
    />
  );
}
