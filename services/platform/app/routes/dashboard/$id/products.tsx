import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '@/convex/_generated/api';
import { ProductTable } from '@/app/features/products/components/product-table';
import { ProductTableSkeleton } from '@/app/features/products/components/product-table-skeleton';
import { ProductsEmptyState } from '@/app/features/products/components/products-empty-state';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  category: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/products')({
  validateSearch: searchSchema,
  component: ProductsPage,
});

function ProductsPage() {
  const { id: organizationId } = Route.useParams();
  const hasProducts = useQuery(api.products.hasProducts, { organizationId });

  if (hasProducts === undefined) {
    return <ProductTableSkeleton organizationId={organizationId} />;
  }

  if (!hasProducts) {
    return <ProductsEmptyState organizationId={organizationId} />;
  }

  return (
    <Suspense fallback={<ProductTableSkeleton organizationId={organizationId} />}>
      <ProductTable organizationId={organizationId} />
    </Suspense>
  );
}
