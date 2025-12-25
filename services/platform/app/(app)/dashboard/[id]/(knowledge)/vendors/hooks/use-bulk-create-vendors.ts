import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Hook for bulk creating vendors.
 * No optimistic update as bulk operations create multiple items
 * and the server handles validation/deduplication.
 */
export function useBulkCreateVendors() {
  return useMutation(api.vendors.bulkCreateVendors);
}
