import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Updates nested metadata - uses preloaded query with complex filters
export function useRemoveRecommendedProduct() {
  return useMutation(api.mutations.approvals.removeRecommendedProduct);
}
