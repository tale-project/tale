import { createProductsCollection } from '@/lib/collections/entities/products';
import { useCollection } from '@/lib/collections/use-collection';

export function useProductCollection(organizationId: string) {
  return useCollection('products', createProductsCollection, organizationId);
}
