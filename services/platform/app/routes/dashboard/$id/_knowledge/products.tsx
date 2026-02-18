import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductTable } from '@/app/features/products/components/product-table';
import { ProductsEmptyState } from '@/app/features/products/components/products-empty-state';
import {
  useApproxProductCount,
  useListProductsPaginated,
} from '@/app/features/products/hooks/queries';
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
    void context.queryClient.prefetchQuery(
      convexQuery(api.products.queries.listProducts, {
        organizationId: params.id,
      }),
    );
    await context.queryClient.ensureQueryData(
      convexQuery(api.products.queries.approxCountProducts, {
        organizationId: params.id,
      }),
    );
  },
  component: ProductsPage,
});

function ProductsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const { data: count } = useApproxProductCount(organizationId);

  const paginatedResult = useListProductsPaginated({
    organizationId,
    status: search.status,
    category: search.category,
    initialNumItems: 10,
  });

  if (count === 0) {
    return <ProductsEmptyState organizationId={organizationId} />;
  }

  return (
    <ProductTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      status={search.status}
    />
  );
}
