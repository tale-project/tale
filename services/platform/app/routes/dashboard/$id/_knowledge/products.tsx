import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductTable } from '@/app/features/products/components/product-table';
import { ProductTableSkeleton } from '@/app/features/products/components/product-table-skeleton';
import { ProductsEmptyState } from '@/app/features/products/components/products-empty-state';
import { api } from '@/convex/_generated/api';

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
  const { data: hasProducts, isLoading } = useQuery(
    convexQuery(api.products.queries.hasProducts, { organizationId }),
  );

  if (isLoading) {
    return <ProductTableSkeleton organizationId={organizationId} />;
  }

  if (!hasProducts) {
    return <ProductsEmptyState organizationId={organizationId} />;
  }

  return <ProductTable organizationId={organizationId} />;
}
