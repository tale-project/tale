import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

/**
 * Hook for bulk creating customers.
 * No optimistic update as bulk operations create multiple items
 * and the server handles validation/deduplication.
 */
export function useBulkCreateCustomers() {
  return useMutation(api.customers.bulkCreateCustomers);
}
