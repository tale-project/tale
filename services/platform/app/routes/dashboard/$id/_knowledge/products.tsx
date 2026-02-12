import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ProductTable } from '@/app/features/products/components/product-table';
import { ProductTableSkeleton } from '@/app/features/products/components/product-table-skeleton';
import { ProductsEmptyState } from '@/app/features/products/components/products-empty-state';
import { useProductCollection } from '@/app/features/products/hooks/collections';
import { useProducts } from '@/app/features/products/hooks/queries';

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
  const productCollection = useProductCollection(organizationId);
  const { products, isLoading } = useProducts(productCollection);

  if (isLoading) {
    return <ProductTableSkeleton organizationId={organizationId} />;
  }

  if (!products || products.length === 0) {
    return <ProductsEmptyState organizationId={organizationId} />;
  }

  return <ProductTable organizationId={organizationId} products={products} />;
}
