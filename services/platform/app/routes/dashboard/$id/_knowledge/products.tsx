import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductTable } from '@/app/features/products/components/product-table';
import { ProductTableSkeleton } from '@/app/features/products/components/product-table-skeleton';
import { ProductsEmptyState } from '@/app/features/products/components/products-empty-state';
import { useListProductsPaginated } from '@/app/features/products/hooks/queries';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/_knowledge/products')({
  validateSearch: searchSchema,
  component: ProductsPage,
});

function ProductsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();

  const paginatedResult = useListProductsPaginated({
    organizationId,
    status: search.status,
    category: search.category,
    initialNumItems: 20,
  });

  if (paginatedResult.status === 'LoadingFirstPage') {
    return <ProductTableSkeleton organizationId={organizationId} />;
  }

  if (
    paginatedResult.status === 'Exhausted' &&
    paginatedResult.results.length === 0
  ) {
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
