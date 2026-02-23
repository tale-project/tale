import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductsTable } from '@/app/features/products/components/products-table';
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
  pendingComponent: () => null,
  pendingMs: 0,
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

  if (count === undefined) return null;

  return (
    <ProductsTable
      organizationId={organizationId}
      paginatedResult={paginatedResult}
      status={search.status}
    />
  );
}
