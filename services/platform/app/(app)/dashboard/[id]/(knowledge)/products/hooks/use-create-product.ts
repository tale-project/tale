import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Hook for creating a product.
 * No optimistic update as this is typically used in bulk import
 * where multiple products are created and proper validation is needed.
 */
export function useCreateProduct() {
  return useMutation(api.products.createProductPublic);
}
