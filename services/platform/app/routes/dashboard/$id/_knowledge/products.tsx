import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductsTable } from '@/app/features/products/components/products-table';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
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
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(
      context.queryClient,
      api.products.queries.approxCountProducts,
      {
        organizationId: params.id,
      },
    );
    // Prime the paginated list cache so the first page paints without a
    // skeleton flash on first nav. Args mirror useListProductsPaginated's base
    // args (no in-page filters — those resolve via the live subscription).
  },
  component: ProductsPage,
});

function ProductsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  return (
    <ProductsTable
      organizationId={organizationId}
      status={search.status}
      category={search.category}
    />
  );
}
