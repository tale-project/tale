import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
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
  const hasProducts = useQuery(api.products.queries.hasProducts, {
    organizationId,
  });

  if (hasProducts === undefined) {
    return <ProductTableSkeleton organizationId={organizationId} />;
  }

  if (hasProducts === false) {
    return <ProductsEmptyState organizationId={organizationId} />;
  }

  return <ProductTable organizationId={organizationId} />;
}
