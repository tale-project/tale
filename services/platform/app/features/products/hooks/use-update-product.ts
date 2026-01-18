import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateProduct() {
  return useMutation(api.products.mutations.updateProduct);
}
