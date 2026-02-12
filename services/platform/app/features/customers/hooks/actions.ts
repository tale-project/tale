import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * No optimistic update as bulk operations create multiple items
 * and the server handles validation/deduplication.
 */
export function useBulkCreateCustomers() {
  return useConvexAction(api.customers.actions.bulkCreateCustomers);
}
