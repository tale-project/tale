import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductsTable } from '@/app/features/products/components/products-table';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import {
  prefetchAdaptedPaginatedQuery,
  prefetchAdaptedQuery,
} from '@/app/lib/backend/prefetch';
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
      'products/queries:approxCountProducts',
      {
        organizationId: params.id,
      },
    );
    // Prime the first page of the list, under the key the table reads, so a
    // first visit paints its rows without skeleton rows. The tab strip preloads
    // this route as it renders, so the page is usually in the cache before the
    // tab is clicked. The args are useListProductsPaginated's on a visit with
    // no filter in the URL, which is how a tab opens.
    prefetchAdaptedPaginatedQuery(
      context.queryClient,
      'products/queries:listProductsPaginated',
      { organizationId: params.id },
      DEFAULT_TABLE_PAGE_SIZE,
    );
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
