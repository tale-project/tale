import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteProduct() {
  return useMutation(api.products.mutations.deleteProduct);
}
